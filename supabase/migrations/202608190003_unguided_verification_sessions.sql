-- Ungraded method work advances plan progress but cannot establish knowledge.
-- Insert one replay-stable guided verification immediately afterwards and
-- shift later curriculum without changing its ids, targets, or schedules.

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
  verification jsonb := payload -> 'followUpSession';
  verification_id uuid := nullif(verification ->> 'id', '')::uuid;
  declared_completed_at timestamptz := nullif(payload ->> 'completedAt', '')::timestamptz;
  existing_attempt public.session_attempts%rowtype;
  completed_session public.plan_sessions%rowtype;
  completed_plan_id uuid;
  expected_topic_ids jsonb;
  expected_content_targets jsonb;
  expected_completion_evidence jsonb;
  current_session_count integer;
  maximum_sequence integer;
  shifted_session record;
  sanitized_payload jsonb;
begin
  if current_user_id is null then
    raise exception 'Authentication is required.';
  end if;

  if requested_attempt_id is null or requested_session_id is null then
    raise exception 'Unguided completion identity is not valid.';
  end if;

  -- Serialize every completion attempt for this owned session before checking
  -- replay state. A concurrent identical retry can then observe the first
  -- transaction's attempt and return idempotently after the lock is released.
  select *
  into completed_session
  from public.plan_sessions
  where id = requested_session_id
    and user_id = current_user_id
  for update;

  if not found then
    raise exception 'The requested session was not found.';
  end if;

  select *
  into existing_attempt
  from public.session_attempts
  where id = requested_attempt_id
    and user_id = current_user_id
  for update;

  if found then
    if existing_attempt.plan_session_id is distinct from requested_session_id
      or coalesce(existing_attempt.result_data ->> 'completionMode', 'guided') <> 'unguided_practice'
      or coalesce(jsonb_typeof(existing_attempt.result_data -> 'followUpSession'), 'null') <> 'object'
      or existing_attempt.result_data -> 'followUpSession' ->> 'id'
        is distinct from verification_id::text
      or existing_attempt.result_data -> 'followUpSession' is distinct from verification then
      raise exception 'Unguided completion identity conflicts with an existing attempt.';
    end if;

    completed_plan_id := completed_session.plan_id;

    if not exists (
      select 1
      from public.plan_sessions as scheduled_verification
      where scheduled_verification.id = verification_id
        and scheduled_verification.plan_id = completed_plan_id
        and scheduled_verification.user_id = current_user_id
        and coalesce(scheduled_verification.step_data ->> 'reviewType', '') = 'verify'
    ) then
      raise exception 'The required guided verification was not preserved.';
    end if;

    return completed_plan_id;
  end if;

  if completed_session.status is distinct from 'ready' then
    raise exception 'The requested session is not ready for a new attempt.';
  end if;

  if coalesce(completed_session.step_data ->> 'reviewType', '') <> '' then
    raise exception 'A required verification cannot be completed as ungraded practice.';
  end if;

  -- Lock the whole ordered curriculum before shifting it so concurrent writes
  -- cannot claim the same sequence. Descending row updates avoid collisions
  -- with the non-deferrable unique(plan_id, sequence) constraint.
  perform session.id
  from public.plan_sessions as session
  where session.plan_id = completed_session.plan_id
    and session.user_id = current_user_id
  order by session.sequence
  for update;

  expected_topic_ids := case
    when jsonb_typeof(completed_session.step_data -> 'topicIds') = 'array'
      then completed_session.step_data -> 'topicIds'
    else '[]'::jsonb
  end;
  expected_content_targets := case
    when jsonb_typeof(completed_session.step_data -> 'contentTargets') = 'array'
      then completed_session.step_data -> 'contentTargets'
    else '[]'::jsonb
  end;
  expected_completion_evidence := case
    when jsonb_typeof(completed_session.step_data -> 'completionEvidence') = 'array'
      then completed_session.step_data -> 'completionEvidence'
    else '[]'::jsonb
  end;

  if coalesce(jsonb_typeof(verification), 'null') <> 'object'
    or verification_id is null
    or verification_id <> requested_attempt_id
    or nullif(verification ->> 'sequence', '')::integer <> completed_session.sequence + 1
    or length(btrim(coalesce(verification ->> 'title', ''))) not between 3 and 180
    or length(btrim(coalesce(verification ->> 'objective', ''))) not between 10 and 900
    or coalesce(verification ->> 'method', '') <> 'Independent retrieval verification'
    or length(btrim(coalesce(verification ->> 'methodReason', ''))) not between 10 and 900
    or coalesce(verification ->> 'amountLabel', '') <> 'Required guided verification · about 10 min'
    or coalesce(verification ->> 'learningMode', '') <> 'study'
    or coalesce(verification ->> 'reviewType', '') <> 'verify'
    or length(btrim(coalesce(verification ->> 'reviewConcept', ''))) not between 2 and 120
    or nullif(verification ->> 'estimatedMinutes', '')::integer <> 10
    or nullif(verification ->> 'scheduledFor', '')::timestamptz
      is distinct from declared_completed_at + interval '1 day'
    or coalesce(jsonb_typeof(verification -> 'topicIds'), 'null') <> 'array'
    or jsonb_array_length(verification -> 'topicIds') not between 1 and 6
    or coalesce(jsonb_typeof(verification -> 'contentTargets'), 'null') <> 'array'
    or jsonb_array_length(verification -> 'contentTargets') not between 1 and 6
    or coalesce(jsonb_typeof(verification -> 'completionEvidence'), 'null') <> 'array'
    or jsonb_array_length(verification -> 'completionEvidence') not between 1 and 4
    or verification -> 'topicIds' <> expected_topic_ids
    or verification -> 'contentTargets' <> expected_content_targets
    or verification -> 'completionEvidence' <> expected_completion_evidence
    or exists (
      select 1
      from jsonb_array_elements(verification -> 'topicIds') as item(value)
      where jsonb_typeof(item.value) <> 'string'
        or (item.value #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    )
    or exists (
      select 1
      from jsonb_array_elements(verification -> 'contentTargets') as item(value)
      where jsonb_typeof(item.value) <> 'string'
        or length(btrim(item.value #>> '{}')) not between 5 and 180
    )
    or exists (
      select 1
      from jsonb_array_elements(verification -> 'completionEvidence') as item(value)
      where jsonb_typeof(item.value) <> 'string'
        or length(btrim(item.value #>> '{}')) not between 8 and 220
    ) then
    raise exception 'The required guided verification is not valid.';
  end if;

  select count(*)::integer, max(sequence)::integer
  into current_session_count, maximum_sequence
  from public.plan_sessions
  where plan_id = completed_session.plan_id
    and user_id = current_user_id;

  if current_session_count >= 28 then
    raise exception 'This plan has no safe room for another verification session.';
  end if;

  if maximum_sequence >= 32767 then
    raise exception 'This plan cannot shift another session safely.';
  end if;

  if exists (
    select 1
    from public.plan_sessions
    where id = verification_id
  ) then
    raise exception 'The verification identity is already in use.';
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

  -- The mature completion transaction inserts the attempt before this wrapper
  -- can stamp durable provenance. Exclude its id during that interim refresh.
  perform set_config('yova.unguided_attempt_id', requested_attempt_id::text, true);
  completed_plan_id := public.complete_plan_session(sanitized_payload);

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
    verification_id,
    current_user_id,
    completed_session.plan_id,
    (verification ->> 'sequence')::smallint,
    verification ->> 'title',
    verification ->> 'objective',
    verification ->> 'method',
    verification ->> 'methodReason',
    (verification ->> 'scheduledFor')::timestamptz,
    (verification ->> 'estimatedMinutes')::smallint,
    'ready',
    jsonb_build_object(
      'amountLabel', verification ->> 'amountLabel',
      'learningMode', 'study',
      'adaptationExplanation', coalesce(nullif(verification ->> 'explanation', ''), verification ->> 'methodReason'),
      'adaptedAt', payload ->> 'completedAt',
      'topicIds', expected_topic_ids,
      'contentTargets', expected_content_targets,
      'completionEvidence', expected_completion_evidence,
      'reviewConcept', verification ->> 'reviewConcept',
      'reviewType', 'verify'
    )
  );

  update public.session_attempts
  set result_data = coalesce(result_data, '{}'::jsonb) || jsonb_build_object(
    'completionMode', 'unguided_practice',
    'observedGap', 'Unguided practice completed; no topic evidence was recorded.',
    'conceptEvidence', '[]'::jsonb,
    'confidenceEvidence', '[]'::jsonb,
    'nextSessionAdjustment', null,
    'followUpSession', verification
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
    'delayedVerificationScheduled', true,
    'verificationSessionId', verification_id
  )
  where user_id = current_user_id
    and plan_session_id = requested_session_id
    and event_type = 'session_completed'
    and event_data ->> 'attemptId' = requested_attempt_id::text;

  update public.plans
  set status = 'active'
  where id = completed_session.plan_id
    and user_id = current_user_id;

  update public.learning_items
  set status = 'active'
  where id = (
    select learning_item_id
    from public.plans
    where id = completed_session.plan_id
      and user_id = current_user_id
  )
    and user_id = current_user_id;

  perform public.refresh_plan_knowledge_map_topic_statuses(
    completed_plan_id,
    current_user_id
  );

  return completed_plan_id;
end;
$$;

revoke all on function public.complete_unguided_plan_session(jsonb) from public, anon;
grant execute on function public.complete_unguided_plan_session(jsonb) to authenticated;
