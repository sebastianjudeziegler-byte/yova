-- Replace the authoritative guided-continuation boundary without rewriting the
-- already-applied 202608210009 migration. The cached generated session decides
-- which exact stored targets were deferred. Both the deployed positional client
-- and the new non-positional client are accepted during the DB-first rollout.
-- Legacy input keeps its already-safe narrow row until the new runtime is live;
-- new input is canonicalized to the full topic superset and synthesized checks.

-- A generated session's nested topicIds are the exact topics that appeared in
-- that time-bounded resource. The plan-session topicIds remain the wider
-- curriculum contract. Recompute taught status from the nested scope whenever
-- it is a valid ordered subset, and fall back only for legacy/un-cached work.
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
        when completion.was_taught then 'taught'
        else 'not_started'
      end
    )
    order by topic.ordinality
  ), '[]'::jsonb)
  into refreshed_topics
  from jsonb_array_elements(current_map -> 'topics')
    with ordinality as topic(value, ordinality)
  left join lateral (
    select exists (
      select 1
      from public.plan_sessions as session
      where session.plan_id = requested_plan_id
        and session.user_id = requested_user_id
        and session.status = 'complete'
        and (
          case
            when jsonb_typeof(session.step_data #> '{generatedSession,topicIds}') = 'array'
              then case
                when jsonb_array_length(session.step_data #> '{generatedSession,topicIds}') between 1 and 6
                  and jsonb_typeof(session.step_data -> 'topicIds') = 'array'
                  and session.step_data -> 'topicIds'
                    @> session.step_data #> '{generatedSession,topicIds}'
                  and not exists (
                    select 1
                    from jsonb_array_elements(
                      session.step_data #> '{generatedSession,topicIds}'
                    ) as generated_topic(value)
                    where jsonb_typeof(generated_topic.value) <> 'string'
                      or (generated_topic.value #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
                  )
                  then session.step_data #> '{generatedSession,topicIds}'
                else coalesce(session.step_data -> 'topicIds', '[]'::jsonb)
              end
            else coalesce(session.step_data -> 'topicIds', '[]'::jsonb)
          end
        ) ? (topic.value ->> 'id')
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

-- Re-evaluate existing derived statuses so a previously completed shortened
-- lesson cannot leave a deferred-only topic monotonically stuck at taught.
do $$
declare
  owned_plan record;
begin
  for owned_plan in select id, user_id from public.plans loop
    perform public.refresh_plan_knowledge_map_topic_statuses(
      owned_plan.id,
      owned_plan.user_id
    );
  end loop;
end;
$$;

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
  requested_continuation jsonb := payload -> 'continuationSession';
  continuation jsonb := requested_continuation;
  continuation_id uuid := nullif(requested_continuation ->> 'id', '')::uuid;
  declared_completed_at timestamptz := nullif(payload ->> 'completedAt', '')::timestamptz;
  declared_planned_minutes integer := nullif(payload ->> 'plannedMinutes', '')::integer;
  requested_plan_id uuid;
  requested_plan public.plans%rowtype;
  completed_session public.plan_sessions%rowtype;
  next_session public.plan_sessions%rowtype;
  existing_attempt public.session_attempts%rowtype;
  existing_attempt_found boolean := false;
  preserved_original_scope jsonb;
  original_topic_ids jsonb;
  original_content_targets jsonb;
  original_completion_evidence jsonb;
  cached_deferred_labels jsonb;
  cached_deferred_contract_available boolean := false;
  cached_active_topic_ids jsonb;
  completed_active_topic_ids jsonb;
  requested_topic_ids jsonb;
  requested_completion_evidence jsonb;
  legacy_topic_ids jsonb;
  legacy_completion_evidence jsonb;
  existing_continuation jsonb;
  canonical_existing_continuation jsonb;
  existing_continuation_needs_canonicalization boolean := false;
  expected_topic_ids jsonb;
  expected_content_targets jsonb;
  expected_completion_evidence jsonb;
  legacy_client_topic_subset boolean := false;
  persisted_topic_ids jsonb;
  persisted_completion_evidence jsonb;
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

  preserved_original_scope := case
    when jsonb_typeof(completed_session.step_data -> 'guidedContinuationOriginalScope') = 'object'
      then completed_session.step_data -> 'guidedContinuationOriginalScope'
    else null
  end;
  original_topic_ids := case
    when jsonb_typeof(preserved_original_scope -> 'topicIds') = 'array'
      then preserved_original_scope -> 'topicIds'
    when jsonb_typeof(completed_session.step_data -> 'topicIds') = 'array'
      then completed_session.step_data -> 'topicIds'
    else '[]'::jsonb
  end;
  original_content_targets := case
    when jsonb_typeof(preserved_original_scope -> 'contentTargets') = 'array'
      then preserved_original_scope -> 'contentTargets'
    when jsonb_typeof(completed_session.step_data -> 'contentTargets') = 'array'
      then completed_session.step_data -> 'contentTargets'
    else '[]'::jsonb
  end;
  original_completion_evidence := case
    when jsonb_typeof(preserved_original_scope -> 'completionEvidence') = 'array'
      then preserved_original_scope -> 'completionEvidence'
    when jsonb_typeof(completed_session.step_data -> 'completionEvidence') = 'array'
      then completed_session.step_data -> 'completionEvidence'
    else '[]'::jsonb
  end;
  cached_deferred_labels := case
    when jsonb_typeof(
      completed_session.step_data #> '{generatedSession,coverage,deferredContent}'
    ) = 'array'
      then completed_session.step_data #> '{generatedSession,coverage,deferredContent}'
    else '[]'::jsonb
  end;

  -- Read a prior completion receipt before deriving the legacy no-cache
  -- compatibility scope. A replay must be bound to the continuation that the
  -- first request durably recorded, never to a replacement subset supplied by
  -- a later request using the same attempt id.
  select *
  into existing_attempt
  from public.session_attempts as attempt
  where attempt.id = requested_attempt_id
    and attempt.user_id = current_user_id
  for update;
  existing_attempt_found := found;

  if coalesce(completed_session.step_data ->> 'reviewType', '') <> '' then
    raise exception 'A protected review cannot create a deferred continuation.';
  end if;
  if jsonb_array_length(original_topic_ids) not between 1 and 6
    or jsonb_array_length(original_content_targets) not between 1 and 6
    or jsonb_array_length(original_completion_evidence) not between 1 and 4
    or exists (
      select 1
      from jsonb_array_elements(original_topic_ids) as item(value)
      where jsonb_typeof(item.value) <> 'string'
        or (item.value #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    )
    or exists (
      select 1
      from jsonb_array_elements(original_content_targets) as item(value)
      where jsonb_typeof(item.value) <> 'string'
        or length(btrim(item.value #>> '{}')) not between 5 and 180
    )
    or exists (
      select 1
      from jsonb_array_elements(original_completion_evidence) as item(value)
      where jsonb_typeof(item.value) <> 'string'
        or length(btrim(item.value #>> '{}')) not between 8 and 220
    ) then
    raise exception 'The stored continuation contract is not valid.';
  end if;
  if jsonb_array_length(cached_deferred_labels) > 4
    or exists (
      select 1
      from jsonb_array_elements(cached_deferred_labels) as item(value)
      where jsonb_typeof(item.value) <> 'string'
        or length(btrim(item.value #>> '{}')) not between 5 and 180
    ) then
    raise exception 'The cached generated session has an invalid deferred target contract.';
  end if;
  cached_deferred_contract_available := jsonb_array_length(cached_deferred_labels) between 1 and 4;
  cached_active_topic_ids := case
    when jsonb_typeof(completed_session.step_data #> '{generatedSession,topicIds}') = 'array'
      then completed_session.step_data #> '{generatedSession,topicIds}'
    else '[]'::jsonb
  end;

  if coalesce(jsonb_typeof(requested_continuation), 'null') <> 'object'
    or coalesce(jsonb_typeof(requested_continuation -> 'topicIds'), 'null') <> 'array'
    or coalesce(jsonb_typeof(requested_continuation -> 'contentTargets'), 'null') <> 'array'
    or coalesce(jsonb_typeof(requested_continuation -> 'completionEvidence'), 'null') <> 'array'
    or jsonb_array_length(requested_continuation -> 'topicIds') not between 1 and 6
    or jsonb_array_length(requested_continuation -> 'contentTargets') not between 1 and 4
    or jsonb_array_length(requested_continuation -> 'completionEvidence') not between 1 and 4
    or jsonb_array_length(original_content_targets)
      <= jsonb_array_length(requested_continuation -> 'contentTargets')
    or exists (
      select 1
      from jsonb_array_elements(requested_continuation -> 'topicIds') as item(value)
      where jsonb_typeof(item.value) <> 'string'
        or (item.value #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    )
    or exists (
      select 1
      from jsonb_array_elements(requested_continuation -> 'contentTargets') as item(value)
      where jsonb_typeof(item.value) <> 'string'
        or length(btrim(item.value #>> '{}')) not between 5 and 180
    )
    or exists (
      select 1
      from jsonb_array_elements(requested_continuation -> 'completionEvidence') as item(value)
      where jsonb_typeof(item.value) <> 'string'
        or length(btrim(item.value #>> '{}')) not between 8 and 220
    ) then
    raise exception 'The deferred continuation scope is not valid.';
  end if;

  -- New authenticated generation persists the cached deferred labels before
  -- opening a split lesson. A lesson already open under the deployed browser-
  -- persistence fallback has no database cache, so retain the prior 210009
  -- ordered-subset boundary for that narrow compatibility case.
  select coalesce(jsonb_agg(
    to_jsonb(btrim(target.value #>> '{}'))
    order by target.ordinality
  ), '[]'::jsonb)
  into expected_content_targets
  from jsonb_array_elements(original_content_targets)
    with ordinality as target(value, ordinality)
  where exists (
    select 1
    from jsonb_array_elements(
      case
        when cached_deferred_contract_available then cached_deferred_labels
        when existing_attempt_found
          and jsonb_typeof(
            existing_attempt.result_data #> '{continuationSession,contentTargets}'
          ) = 'array'
          then existing_attempt.result_data #> '{continuationSession,contentTargets}'
        when existing_attempt_found then '[]'::jsonb
        else requested_continuation -> 'contentTargets'
      end
    ) as deferred(value)
    where lower(regexp_replace(btrim(deferred.value #>> '{}'), '[[:space:]]+', ' ', 'g'))
      = lower(regexp_replace(btrim(target.value #>> '{}'), '[[:space:]]+', ' ', 'g'))
  );
  if jsonb_array_length(expected_content_targets) < 1
    or jsonb_array_length(expected_content_targets) >= jsonb_array_length(original_content_targets)
    or expected_content_targets is distinct from requested_continuation -> 'contentTargets' then
    raise exception 'The deferred continuation changed the cached target scope.';
  end if;

  -- Topic ids, targets, and checks are independent contracts. The authoritative
  -- continuation retains the complete stored topic superset. During DB-first
  -- rollout an ordered legacy subset is accepted as input only; it is never
  -- used to infer or write the canonical topic scope.
  expected_topic_ids := original_topic_ids;
  requested_topic_ids := requested_continuation -> 'topicIds';
  if jsonb_array_length(original_topic_ids) = jsonb_array_length(original_content_targets) then
    select coalesce(jsonb_agg(topic.value order by topic.ordinality), '[]'::jsonb)
    into legacy_topic_ids
    from jsonb_array_elements(original_topic_ids)
      with ordinality as topic(value, ordinality)
    where topic.ordinality in (
      select target.ordinality
      from jsonb_array_elements(original_content_targets)
        with ordinality as target(value, ordinality)
      where exists (
        select 1
        from jsonb_array_elements(expected_content_targets) as deferred(value)
        where lower(regexp_replace(btrim(deferred.value #>> '{}'), '[[:space:]]+', ' ', 'g'))
          = lower(regexp_replace(btrim(target.value #>> '{}'), '[[:space:]]+', ' ', 'g'))
      )
    );
  elsif jsonb_array_length(original_topic_ids) = 1 then
    legacy_topic_ids := original_topic_ids;
  else
    legacy_topic_ids := '[]'::jsonb;
  end if;
  if requested_topic_ids is distinct from expected_topic_ids
    and requested_topic_ids is distinct from legacy_topic_ids then
    raise exception 'The deferred continuation changed the stored topic scope.';
  end if;
  legacy_client_topic_subset := requested_topic_ids is distinct from expected_topic_ids;

  -- Completing the first time-bounded resource may teach only a subset of the
  -- original topics. Narrow the completed row before complete_plan_session so
  -- its attempt trigger cannot mark deferred-only topics as taught. The full
  -- original contract is retained separately for replay and continuation.
  if cached_deferred_contract_available then
    if jsonb_array_length(cached_active_topic_ids) not between 1 and 6
      or exists (
        select 1
        from jsonb_array_elements(cached_active_topic_ids) as item(value)
        where jsonb_typeof(item.value) <> 'string'
          or not (original_topic_ids @> jsonb_build_array(item.value))
      ) then
      raise exception 'The cached generated session has an invalid active topic contract.';
    end if;
    select coalesce(jsonb_agg(topic.value order by topic.ordinality), '[]'::jsonb)
    into completed_active_topic_ids
    from jsonb_array_elements(original_topic_ids)
      with ordinality as topic(value, ordinality)
    where cached_active_topic_ids @> jsonb_build_array(topic.value);
    if completed_active_topic_ids is distinct from cached_active_topic_ids then
      raise exception 'The cached generated session changed active topic order.';
    end if;
  elsif jsonb_array_length(original_topic_ids) = jsonb_array_length(original_content_targets) then
    select coalesce(jsonb_agg(topic.value order by topic.ordinality), '[]'::jsonb)
    into completed_active_topic_ids
    from jsonb_array_elements(original_topic_ids)
      with ordinality as topic(value, ordinality)
    where not (legacy_topic_ids @> jsonb_build_array(topic.value));
  elsif jsonb_array_length(original_topic_ids) = 1 then
    completed_active_topic_ids := original_topic_ids;
  else
    raise exception 'The stored topic scope cannot identify completed legacy work safely.';
  end if;
  if jsonb_array_length(completed_active_topic_ids) < 1 then
    raise exception 'The completed lesson must retain at least one taught topic.';
  end if;

  select coalesce(jsonb_agg(
    to_jsonb(left(
      'Explain or apply this remaining saved target independently: ' || (target.value #>> '{}'),
      220
    ))
    order by target.ordinality
  ), '[]'::jsonb)
  into expected_completion_evidence
  from jsonb_array_elements(expected_content_targets)
    with ordinality as target(value, ordinality);

  requested_completion_evidence := requested_continuation -> 'completionEvidence';
  if jsonb_array_length(original_completion_evidence) = jsonb_array_length(original_content_targets) then
    select coalesce(jsonb_agg(
      to_jsonb(btrim(evidence.value #>> '{}')) order by evidence.ordinality
    ), '[]'::jsonb)
    into legacy_completion_evidence
    from jsonb_array_elements(original_completion_evidence)
      with ordinality as evidence(value, ordinality)
    where evidence.ordinality in (
      select target.ordinality
      from jsonb_array_elements(original_content_targets)
        with ordinality as target(value, ordinality)
      where exists (
        select 1
        from jsonb_array_elements(expected_content_targets) as deferred(value)
        where lower(regexp_replace(btrim(deferred.value #>> '{}'), '[[:space:]]+', ' ', 'g'))
          = lower(regexp_replace(btrim(target.value #>> '{}'), '[[:space:]]+', ' ', 'g'))
      )
    );
  else
    legacy_completion_evidence := expected_completion_evidence;
  end if;
  if jsonb_array_length(requested_completion_evidence)
      <> jsonb_array_length(expected_content_targets)
    or (
      requested_completion_evidence is distinct from expected_completion_evidence
      and requested_completion_evidence is distinct from legacy_completion_evidence
    ) then
    raise exception 'The deferred continuation changed the stored evidence scope.';
  end if;

  -- The request-derived branch exists only for a lesson already opened under
  -- the deployed browser-persistence behavior. Such a first completion must
  -- match 202608210009's exact positional topic/evidence contract. New code
  -- never creates another browser-only split lesson.
  if not cached_deferred_contract_available
    and not existing_attempt_found
    and (
      requested_topic_ids is distinct from legacy_topic_ids
      or requested_completion_evidence is distinct from legacy_completion_evidence
    ) then
    raise exception 'The deferred continuation requires its persisted generated-session contract.';
  end if;

  -- Applying this migration before the app must not expand an old client's
  -- narrow continuation underneath the old runtime. Preserve a validated
  -- ordered topic subset for that caller. The new client proves itself by
  -- sending the complete topic superset and receives the canonical contract.
  persisted_topic_ids := case
    when legacy_client_topic_subset then requested_topic_ids
    else expected_topic_ids
  end;
  persisted_completion_evidence := case
    when legacy_client_topic_subset then requested_completion_evidence
    else expected_completion_evidence
  end;
  continuation := requested_continuation || jsonb_build_object(
    'topicIds', persisted_topic_ids,
    'contentTargets', expected_content_targets,
    'completionEvidence', persisted_completion_evidence
  );

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

  if existing_attempt_found then
    existing_continuation := existing_attempt.result_data -> 'continuationSession';
    canonical_existing_continuation := case
      when legacy_client_topic_subset then existing_continuation
      else existing_continuation || jsonb_build_object(
        'topicIds', expected_topic_ids,
        'contentTargets', expected_content_targets,
        'completionEvidence', expected_completion_evidence
      )
    end;
    existing_continuation_needs_canonicalization :=
      existing_continuation -> 'topicIds' is distinct from expected_topic_ids
      or existing_continuation -> 'contentTargets' is distinct from expected_content_targets
      or existing_continuation -> 'completionEvidence' is distinct from expected_completion_evidence;
    if existing_attempt.plan_session_id is distinct from requested_session_id
      or coalesce(existing_attempt.result_data ->> 'completionMode', 'guided') <> 'guided'
      or coalesce(jsonb_typeof(existing_continuation), 'null') <> 'object'
      or canonical_existing_continuation is distinct from continuation
      or not exists (
        select 1
        from public.plan_sessions as saved_continuation
        where saved_continuation.id = continuation_id
          and saved_continuation.plan_id = requested_plan.id
          and saved_continuation.user_id = current_user_id
          and saved_continuation.step_data -> 'topicIds'
            = existing_continuation -> 'topicIds'
          and saved_continuation.step_data -> 'contentTargets'
            = existing_continuation -> 'contentTargets'
          and saved_continuation.step_data -> 'completionEvidence'
            = existing_continuation -> 'completionEvidence'
      ) then
      raise exception 'Guided continuation identity conflicts with an existing attempt.';
    end if;

    -- A new-runtime replay can safely repair a lost response from 202608210009
    -- to the canonical shape. An old-runtime replay retains its narrow row
    -- until that runtime has drained.
    if not legacy_client_topic_subset and existing_continuation_needs_canonicalization then
      update public.plan_sessions
      set step_data = jsonb_set(
        jsonb_set(
          jsonb_set(step_data - 'generatedSession', '{topicIds}', expected_topic_ids, true),
          '{contentTargets}', expected_content_targets, true
        ),
        '{completionEvidence}', expected_completion_evidence, true
      )
      where id = continuation_id
        and plan_id = requested_plan.id
        and user_id = current_user_id;
      if not found then
        raise exception 'Guided continuation identity conflicts with an existing attempt.';
      end if;
    end if;

    update public.session_attempts
    set result_data = jsonb_set(
      result_data,
      '{continuationSession}',
      continuation,
      true
    )
    where id = requested_attempt_id
      and user_id = current_user_id
      and plan_session_id = requested_session_id;
    return requested_plan.id;
  end if;

  if completed_session.status is distinct from 'ready' then
    raise exception 'The requested session is not ready for a new attempt.';
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
      'topicIds', continuation -> 'topicIds',
      'contentTargets', expected_content_targets,
      'completionEvidence', continuation -> 'completionEvidence'
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
  update public.plan_sessions
  set step_data = jsonb_set(
    jsonb_set(
      step_data,
      '{guidedContinuationOriginalScope}',
      jsonb_build_object(
        'topicIds', original_topic_ids,
        'contentTargets', original_content_targets,
        'completionEvidence', original_completion_evidence
      ),
      true
    ),
    '{topicIds}',
    completed_active_topic_ids,
    true
  )
  where id = requested_session_id
    and plan_id = requested_plan.id
    and user_id = current_user_id
    and status = 'ready';
  if not found then
    raise exception 'The completed lesson scope could not be narrowed safely.';
  end if;
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
