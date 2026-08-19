-- An unguided method workpad can advance plan progress, but the learner's
-- self-check is not teaching or knowledge evidence. Keep that distinction in
-- the durable attempt so every map refresh can enforce it.

create or replace function public.refresh_plan_knowledge_map_topic_statuses(
  requested_plan_id uuid,
  requested_user_id uuid
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_map jsonb;
  refreshed_topics jsonb;
begin
  select knowledge_map
  into current_map
  from public.plans
  where id = requested_plan_id
    and user_id = requested_user_id
  for update;

  if not found or jsonb_typeof(current_map -> 'topics') <> 'array' then
    return;
  end if;

  select coalesce(jsonb_agg(
    topic.value || jsonb_build_object(
      'status', case
        when coalesce(topic.value ->> 'status', 'not_started') = 'secure' then 'secure'
        when evidence.secure_count >= 2 and evidence.latest_outcome = 'secure' then 'secure'
        when coalesce(topic.value ->> 'status', 'not_started') = 'evidenced' then 'evidenced'
        when evidence.evidence_count > 0 then 'evidenced'
        when coalesce(topic.value ->> 'status', 'not_started') = 'taught' then 'taught'
        when completion.was_taught then 'taught'
        else 'not_started'
      end
    )
    order by topic.ordinality
  ), '[]'::jsonb)
  into refreshed_topics
  from jsonb_array_elements(current_map -> 'topics') with ordinality as topic(value, ordinality)
  left join lateral (
    select exists (
      select 1
      from public.plan_sessions as session
      where session.plan_id = requested_plan_id
        and session.user_id = requested_user_id
        and session.status = 'complete'
        and coalesce(session.step_data -> 'topicIds', '[]'::jsonb) ? (topic.value ->> 'id')
        and exists (
          select 1
          from public.session_attempts as teaching_attempt
          where teaching_attempt.plan_session_id = session.id
            and teaching_attempt.user_id = requested_user_id
            and teaching_attempt.id::text is distinct from nullif(
              current_setting('yova.unguided_attempt_id', true),
              ''
            )
            and coalesce(
              teaching_attempt.result_data ->> 'completionMode',
              'guided'
            ) <> 'unguided_practice'
        )
    ) as was_taught
  ) as completion on true
  left join lateral (
    select
      count(*)::integer as evidence_count,
      count(*) filter (where item.value ->> 'outcome' = 'secure')::integer as secure_count,
      (
        array_agg(
          item.value ->> 'outcome'
          order by attempt.completed_at desc, item.ordinality desc
        )
      )[1] as latest_outcome
    from public.session_attempts as attempt
    join public.plan_sessions as session
      on session.id = attempt.plan_session_id
      and session.plan_id = requested_plan_id
      and session.user_id = requested_user_id
    cross join lateral jsonb_array_elements(
      coalesce(attempt.result_data -> 'conceptEvidence', '[]'::jsonb)
    ) with ordinality as item(value, ordinality)
    where item.value ->> 'topicId' = topic.value ->> 'id'
      and attempt.id::text is distinct from nullif(
        current_setting('yova.unguided_attempt_id', true),
        ''
      )
      and coalesce(attempt.result_data ->> 'completionMode', 'guided') <> 'unguided_practice'
  ) as evidence on true;

  update public.plans
  set knowledge_map = jsonb_set(current_map, '{topics}', refreshed_topics, false)
  where id = requested_plan_id
    and user_id = requested_user_id;
end;
$$;

-- Keep the existing, mature completion transaction for plan progression, but
-- force all knowledge-bearing fields empty and stamp durable provenance before
-- the transaction commits. The result-data update fires the existing map
-- refresh trigger a second time, after provenance is present.
create or replace function public.complete_unguided_plan_session(payload jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  requested_attempt_id uuid := nullif(payload ->> 'attemptId', '')::uuid;
  requested_session_id uuid := nullif(payload ->> 'planSessionId', '')::uuid;
  existing_attempt public.session_attempts%rowtype;
  completed_plan_id uuid;
  sanitized_payload jsonb;
begin
  if current_user_id is null then
    raise exception 'Authentication is required.';
  end if;

  if requested_attempt_id is null or requested_session_id is null then
    raise exception 'Unguided completion identity is not valid.';
  end if;

  select *
  into existing_attempt
  from public.session_attempts
  where id = requested_attempt_id
    and user_id = current_user_id;

  if found and (
    existing_attempt.plan_session_id <> requested_session_id
    or coalesce(existing_attempt.result_data ->> 'completionMode', 'guided') <> 'unguided_practice'
  ) then
    raise exception 'Unguided completion identity conflicts with an existing attempt.';
  end if;

  sanitized_payload := payload || jsonb_build_object(
    'completionMode', 'unguided_practice',
    'correctAnswers', 0,
    'totalAnswers', 0,
    'observedGap', 'Unguided practice completed; no topic evidence was recorded.',
    'conceptEvidence', '[]'::jsonb,
    'confidenceEvidence', '[]'::jsonb,
    'nextSessionAdjustment', null,
    'followUpSession', null
  );

  -- complete_plan_session inserts the attempt before this wrapper can stamp
  -- durable provenance. Its existing AFTER INSERT trigger consults this
  -- transaction-local id so the interim row is never treated as guided.
  perform set_config(
    'yova.unguided_attempt_id',
    requested_attempt_id::text,
    true
  );

  completed_plan_id := public.complete_plan_session(sanitized_payload);

  update public.session_attempts
  set result_data = coalesce(result_data, '{}'::jsonb) || jsonb_build_object(
    'completionMode', 'unguided_practice',
    'observedGap', 'Unguided practice completed; no topic evidence was recorded.',
    'conceptEvidence', '[]'::jsonb,
    'confidenceEvidence', '[]'::jsonb
  )
  where id = requested_attempt_id
    and user_id = current_user_id
    and plan_session_id = requested_session_id;

  if not found then
    raise exception 'Unguided completion could not be recorded.';
  end if;

  update public.learning_events
  set event_data = event_data || jsonb_build_object(
    'completionMode', 'unguided_practice',
    'conceptEvidenceCount', 0,
    'confidenceEvidenceCount', 0,
    'nextSessionAdjusted', false,
    'delayedVerificationScheduled', false
  )
  where user_id = current_user_id
    and plan_session_id = requested_session_id
    and event_type = 'session_completed'
    and event_data ->> 'attemptId' = requested_attempt_id::text;

  perform public.refresh_plan_knowledge_map_topic_statuses(
    completed_plan_id,
    current_user_id
  );

  return completed_plan_id;
end;
$$;

-- Existing rows have no completionMode and remain guided by default. This
-- refresh also makes the new derivation authoritative before new writes land.
do $$
declare
  owned_plan record;
begin
  for owned_plan in select id, user_id from public.plans loop
    perform public.refresh_plan_knowledge_map_topic_statuses(owned_plan.id, owned_plan.user_id);
  end loop;
end;
$$;

revoke all on function public.refresh_plan_knowledge_map_topic_statuses(uuid, uuid)
  from public, anon;
revoke all on function public.complete_unguided_plan_session(jsonb) from public, anon;
-- Both the security-invoker completion wrapper and the existing attempt
-- trigger call this helper as the learner, so authenticated execution must
-- remain available even though anonymous RPC access is denied explicitly.
grant execute on function public.refresh_plan_knowledge_map_topic_statuses(uuid, uuid)
  to authenticated;
grant execute on function public.complete_unguided_plan_session(jsonb) to authenticated;
