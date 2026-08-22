-- A generated lesson may deliberately narrow a stored session to the learner's
-- current time window. Completing that bounded lesson must not mark the omitted
-- stored targets complete. Insert one exact continuation atomically, without
-- moving the timestamps or identities of later curriculum and protected reviews.

create or replace function public.complete_guided_plan_session_with_continuation(payload jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  requested_attempt_id uuid := nullif(payload ->> 'attemptId', '')::uuid;
  requested_session_id uuid := nullif(payload ->> 'planSessionId', '')::uuid;
  continuation jsonb := payload -> 'continuationSession';
  continuation_id uuid := nullif(continuation ->> 'id', '')::uuid;
  declared_completed_at timestamptz := nullif(payload ->> 'completedAt', '')::timestamptz;
  declared_planned_minutes integer := nullif(payload ->> 'plannedMinutes', '')::integer;
  requested_plan_id uuid;
  requested_plan public.plans%rowtype;
  completed_session public.plan_sessions%rowtype;
  next_session public.plan_sessions%rowtype;
  existing_attempt public.session_attempts%rowtype;
  original_topic_ids jsonb;
  original_content_targets jsonb;
  original_completion_evidence jsonb;
  expected_topic_ids jsonb;
  expected_content_targets jsonb;
  expected_completion_evidence jsonb;
  plan_deadline timestamptz;
  current_session_count integer;
  maximum_sequence integer;
  shifted_session record;
  completed_plan_id uuid;
  sanitized_payload jsonb;
begin
  if current_user_id is null then
    raise exception 'Authentication is required.';
  end if;
  if requested_attempt_id is null
    or requested_session_id is null
    or continuation_id is null
    or declared_completed_at is null
    or declared_planned_minutes is null then
    raise exception 'Guided continuation identity is not valid.';
  end if;
  if coalesce(payload ->> 'completionMode', 'guided') <> 'guided'
    or coalesce(jsonb_typeof(payload -> 'nextSessionAdjustment'), 'null') <> 'null'
    or coalesce(jsonb_typeof(payload -> 'followUpSession'), 'null') <> 'null' then
    raise exception 'A guided continuation cannot be combined with another session rewrite.';
  end if;

  select session.plan_id
  into requested_plan_id
  from public.plan_sessions as session
  where session.id = requested_session_id
    and session.user_id = current_user_id;
  if not found then
    raise exception 'The requested session was not found.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('yova_learning_data'),
    pg_catalog.hashtext(current_user_id::text)
  );

  select *
  into requested_plan
  from public.plans as plan
  where plan.id = requested_plan_id
    and plan.user_id = current_user_id
  for update;
  if not found then
    raise exception 'The requested plan was not found.';
  end if;

  perform session.id
  from public.plan_sessions as session
  where session.plan_id = requested_plan.id
    and session.user_id = current_user_id
  order by session.sequence
  for update;

  select *
  into completed_session
  from public.plan_sessions as session
  where session.id = requested_session_id
    and session.plan_id = requested_plan.id
    and session.user_id = current_user_id;
  if not found then
    raise exception 'The requested session was not found.';
  end if;

  select item.deadline
  into plan_deadline
  from public.learning_items as item
  where item.id = requested_plan.learning_item_id
    and item.user_id = current_user_id
  for no key update;
  if not found then
    raise exception 'The requested learning item was not found.';
  end if;

  select *
  into existing_attempt
  from public.session_attempts as attempt
  where attempt.id = requested_attempt_id
    and attempt.user_id = current_user_id
  for update;
  if found then
    if existing_attempt.plan_session_id is distinct from requested_session_id
      or coalesce(existing_attempt.result_data ->> 'completionMode', 'guided') <> 'guided'
      or coalesce(jsonb_typeof(existing_attempt.result_data -> 'continuationSession'), 'null') <> 'object'
      or existing_attempt.result_data -> 'continuationSession' is distinct from continuation
      or not exists (
        select 1
        from public.plan_sessions as saved_continuation
        where saved_continuation.id = continuation_id
          and saved_continuation.plan_id = requested_plan.id
          and saved_continuation.user_id = current_user_id
          and saved_continuation.step_data -> 'topicIds' = continuation -> 'topicIds'
          and saved_continuation.step_data -> 'contentTargets' = continuation -> 'contentTargets'
          and saved_continuation.step_data -> 'completionEvidence' = continuation -> 'completionEvidence'
      ) then
      raise exception 'Guided continuation identity conflicts with an existing attempt.';
    end if;
    return requested_plan.id;
  end if;

  if completed_session.status is distinct from 'ready' then
    raise exception 'The requested session is not ready for a new attempt.';
  end if;
  if coalesce(completed_session.step_data ->> 'reviewType', '') <> '' then
    raise exception 'A protected review cannot create a deferred continuation.';
  end if;

  original_topic_ids := case
    when jsonb_typeof(completed_session.step_data -> 'topicIds') = 'array'
      then completed_session.step_data -> 'topicIds'
    else '[]'::jsonb
  end;
  original_content_targets := case
    when jsonb_typeof(completed_session.step_data -> 'contentTargets') = 'array'
      then completed_session.step_data -> 'contentTargets'
    else '[]'::jsonb
  end;
  original_completion_evidence := case
    when jsonb_typeof(completed_session.step_data -> 'completionEvidence') = 'array'
      then completed_session.step_data -> 'completionEvidence'
    else '[]'::jsonb
  end;

  if coalesce(jsonb_typeof(continuation), 'null') <> 'object'
    or coalesce(jsonb_typeof(continuation -> 'topicIds'), 'null') <> 'array'
    or coalesce(jsonb_typeof(continuation -> 'contentTargets'), 'null') <> 'array'
    or coalesce(jsonb_typeof(continuation -> 'completionEvidence'), 'null') <> 'array'
    or jsonb_array_length(continuation -> 'topicIds') not between 1 and 6
    or jsonb_array_length(continuation -> 'contentTargets') not between 1 and 4
    or jsonb_array_length(continuation -> 'completionEvidence') not between 1 and 4
    or jsonb_array_length(original_content_targets) <= jsonb_array_length(continuation -> 'contentTargets') then
    raise exception 'The deferred continuation scope is not valid.';
  end if;

  select coalesce(jsonb_agg(target.value order by target.ordinality), '[]'::jsonb)
  into expected_content_targets
  from jsonb_array_elements(original_content_targets) with ordinality as target(value, ordinality)
  where exists (
    select 1
    from jsonb_array_elements(continuation -> 'contentTargets') as requested(value)
    where requested.value = target.value
  );
  if expected_content_targets is distinct from continuation -> 'contentTargets' then
    raise exception 'The deferred continuation changed the stored target scope.';
  end if;

  if jsonb_array_length(original_topic_ids) = jsonb_array_length(original_content_targets) then
    select coalesce(jsonb_agg(topic.value order by topic.ordinality), '[]'::jsonb)
    into expected_topic_ids
    from jsonb_array_elements(original_topic_ids) with ordinality as topic(value, ordinality)
    where topic.ordinality in (
      select target.ordinality
      from jsonb_array_elements(original_content_targets) with ordinality as target(value, ordinality)
      where exists (
        select 1
        from jsonb_array_elements(expected_content_targets) as deferred(value)
        where deferred.value = target.value
      )
    );
  elsif jsonb_array_length(original_topic_ids) = 1 then
    expected_topic_ids := original_topic_ids;
  else
    raise exception 'The stored topic scope cannot be mapped safely to deferred targets.';
  end if;

  if jsonb_array_length(original_completion_evidence) = jsonb_array_length(original_content_targets) then
    select coalesce(jsonb_agg(evidence.value order by evidence.ordinality), '[]'::jsonb)
    into expected_completion_evidence
    from jsonb_array_elements(original_completion_evidence) with ordinality as evidence(value, ordinality)
    where evidence.ordinality in (
      select target.ordinality
      from jsonb_array_elements(original_content_targets) with ordinality as target(value, ordinality)
      where exists (
        select 1
        from jsonb_array_elements(expected_content_targets) as deferred(value)
        where deferred.value = target.value
      )
    );
  else
    select coalesce(jsonb_agg(
      to_jsonb(left(
        'Explain or apply this remaining saved target independently: ' || (target.value #>> '{}'),
        220
      ))
      order by target.ordinality
    ), '[]'::jsonb)
    into expected_completion_evidence
    from jsonb_array_elements(expected_content_targets) with ordinality as target(value, ordinality);
  end if;

  if continuation -> 'topicIds' is distinct from expected_topic_ids
    or continuation -> 'completionEvidence' is distinct from expected_completion_evidence
    or exists (
      select 1
      from jsonb_array_elements(expected_topic_ids) as item(value)
      where jsonb_typeof(item.value) <> 'string'
        or (item.value #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    ) then
    raise exception 'The deferred continuation changed the stored evidence scope.';
  end if;

  if nullif(continuation ->> 'sequence', '') is null
    or nullif(continuation ->> 'sequence', '')::integer <> completed_session.sequence + 1
    or length(btrim(coalesce(continuation ->> 'title', ''))) not between 3 and 180
    or length(btrim(coalesce(continuation ->> 'objective', ''))) not between 10 and 900
    or continuation ->> 'method' is distinct from completed_session.method
    or length(btrim(coalesce(continuation ->> 'methodReason', ''))) not between 10 and 900
    or length(btrim(coalesce(continuation ->> 'amountLabel', ''))) not between 3 and 180
    or coalesce(continuation ->> 'learningMode', '')
      <> coalesce(nullif(completed_session.step_data ->> 'learningMode', ''), 'study')
    or nullif(continuation ->> 'estimatedMinutes', '') is null
    or nullif(continuation ->> 'estimatedMinutes', '')::integer not between 10 and 180
    or nullif(continuation ->> 'estimatedMinutes', '')::integer > greatest(10, declared_planned_minutes)
    or nullif(continuation ->> 'scheduledFor', '') is null
    or nullif(continuation ->> 'scheduledFor', '')::timestamptz is distinct from declared_completed_at then
    raise exception 'The deferred continuation schedule is not valid.';
  end if;

  select *
  into next_session
  from public.plan_sessions as session
  where session.plan_id = completed_session.plan_id
    and session.user_id = current_user_id
    and session.sequence > completed_session.sequence
    and session.status in ('ready', 'upcoming')
  order by session.sequence
  limit 1;

  if found and (
    next_session.scheduled_for is null
    or declared_completed_at
      + (continuation ->> 'estimatedMinutes')::integer * interval '1 minute'
      > next_session.scheduled_for
  ) then
    raise exception 'The deferred continuation does not fit before the next scheduled session or protected review.';
  end if;
  if plan_deadline is not null
    and declared_completed_at
      + (continuation ->> 'estimatedMinutes')::integer * interval '1 minute'
      > plan_deadline then
    raise exception 'The deferred continuation does not fit before the learning goal deadline.';
  end if;

  select count(*)::integer, max(sequence)::integer
  into current_session_count, maximum_sequence
  from public.plan_sessions
  where plan_id = completed_session.plan_id
    and user_id = current_user_id;
  if current_session_count >= 28 then
    raise exception 'This plan has no safe room for another continuation session.';
  end if;
  if maximum_sequence >= 32767 then
    raise exception 'This plan cannot shift another session safely.';
  end if;
  if exists (select 1 from public.plan_sessions where id = continuation_id) then
    raise exception 'The continuation identity is already in use.';
  end if;

  for shifted_session in
    select id, sequence
    from public.plan_sessions
    where plan_id = completed_session.plan_id
      and user_id = current_user_id
      and sequence > completed_session.sequence
    order by sequence desc
  loop
    update public.plan_sessions
    set sequence = shifted_session.sequence + 1
    where id = shifted_session.id
      and user_id = current_user_id;
  end loop;

  insert into public.plan_sessions (
    id,
    user_id,
    plan_id,
    sequence,
    title,
    objective,
    method,
    method_rationale,
    scheduled_for,
    estimated_minutes,
    status,
    step_data
  ) values (
    continuation_id,
    current_user_id,
    completed_session.plan_id,
    (continuation ->> 'sequence')::smallint,
    continuation ->> 'title',
    continuation ->> 'objective',
    completed_session.method,
    continuation ->> 'methodReason',
    (continuation ->> 'scheduledFor')::timestamptz,
    (continuation ->> 'estimatedMinutes')::smallint,
    'upcoming',
    jsonb_build_object(
      'amountLabel', continuation ->> 'amountLabel',
      'learningMode', continuation ->> 'learningMode',
      'topicIds', expected_topic_ids,
      'contentTargets', expected_content_targets,
      'completionEvidence', expected_completion_evidence
    )
  );

  -- Insert as upcoming first. The mature completion transaction promotes only
  -- sequence current+1, so the continuation becomes the sole ready row while
  -- every later session remains upcoming with its original timestamp and id.
  sanitized_payload := (payload - 'continuationSession') || jsonb_build_object(
    'completionMode', 'guided',
    'nextSessionAdjustment', null,
    'followUpSession', null
  );
  completed_plan_id := public.complete_plan_session(sanitized_payload);

  if (
    select count(*)
    from public.plan_sessions as session
    where session.plan_id = completed_session.plan_id
      and session.user_id = current_user_id
      and session.status = 'ready'
  ) <> 1 then
    raise exception 'The guided continuation did not preserve one authoritative ready session.';
  end if;

  update public.plans
  set status = 'active'
  where id = completed_session.plan_id
    and user_id = current_user_id;
  update public.learning_items
  set status = 'active'
  where id = requested_plan.learning_item_id
    and user_id = current_user_id;

  update public.session_attempts
  set result_data = coalesce(result_data, '{}'::jsonb) || jsonb_build_object(
    'completionMode', 'guided',
    'continuationSession', continuation
  )
  where id = requested_attempt_id
    and user_id = current_user_id
    and plan_session_id = requested_session_id;
  if not found then
    raise exception 'The guided continuation completion could not be recorded.';
  end if;

  update public.learning_events
  set event_data = event_data || jsonb_build_object(
    'completionMode', 'guided',
    'deferredContinuationScheduled', true,
    'continuationSessionId', continuation_id
  )
  where user_id = current_user_id
    and plan_session_id = requested_session_id
    and event_type = 'session_completed'
    and event_data ->> 'attemptId' = requested_attempt_id::text;

  return completed_plan_id;
end;
$$;

revoke all on function public.complete_guided_plan_session_with_continuation(jsonb)
from public, anon, authenticated;
grant execute on function public.complete_guided_plan_session_with_continuation(jsonb)
to authenticated;
