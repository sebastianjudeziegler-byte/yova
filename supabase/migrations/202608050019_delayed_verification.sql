-- Keep one-off learning goals open when evidence needs a delayed verification.
-- The follow-up is inserted in the same transaction as session completion so
-- cloud state cannot say "complete" while silently losing a scheduled review.

create or replace function public.complete_plan_session(payload jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  completed_session public.plan_sessions%rowtype;
  attempt_inserted integer := 0;
  adjustment jsonb := payload -> 'nextSessionAdjustment';
  follow_up jsonb := payload -> 'followUpSession';
  concept_evidence jsonb := coalesce(payload -> 'conceptEvidence', '[]'::jsonb);
  confidence_evidence jsonb := coalesce(payload -> 'confidenceEvidence', '[]'::jsonb);
  declared_started_at timestamptz := nullif(payload ->> 'startedAt', '')::timestamptz;
  declared_completed_at timestamptz := nullif(payload ->> 'completedAt', '')::timestamptz;
  declared_actual_minutes integer := nullif(payload ->> 'actualMinutes', '')::integer;
  declared_planned_minutes integer := nullif(payload ->> 'plannedMinutes', '')::integer;
begin
  if current_user_id is null then
    raise exception 'Authentication is required.';
  end if;

  if declared_started_at is null
    or declared_completed_at is null
    or declared_started_at > declared_completed_at
    or declared_started_at < declared_completed_at - interval '12 hours' then
    raise exception 'Session timing is not valid.';
  end if;

  if declared_actual_minutes is null
    or declared_actual_minutes not between 1 and 360 then
    raise exception 'Actual session duration is not valid.';
  end if;

  if declared_planned_minutes is null
    or declared_planned_minutes not between 5 and 180 then
    raise exception 'Planned session duration is not valid.';
  end if;

  if jsonb_typeof(concept_evidence) <> 'array'
    or jsonb_array_length(concept_evidence) > 24 then
    raise exception 'Concept evidence is not valid.';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(concept_evidence) as evidence
    where jsonb_typeof(evidence) <> 'object'
      or length(btrim(coalesce(evidence ->> 'concept', ''))) not between 2 and 120
      or coalesce(evidence ->> 'outcome', '') not in ('secure', 'needs_review')
      or coalesce(evidence ->> 'activityType', '') not in ('multiple_choice', 'free_response')
  ) then
    raise exception 'Concept evidence contains an invalid entry.';
  end if;

  if jsonb_typeof(confidence_evidence) <> 'array'
    or jsonb_array_length(confidence_evidence) > 24 then
    raise exception 'Confidence evidence is not valid.';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(confidence_evidence) as evidence
    where jsonb_typeof(evidence) <> 'object'
      or length(btrim(coalesce(evidence ->> 'concept', ''))) not between 2 and 120
      or coalesce(evidence ->> 'confidence', '') not in ('guessing', 'somewhat_sure', 'very_sure')
      or jsonb_typeof(evidence -> 'correct') <> 'boolean'
      or coalesce(evidence ->> 'activityType', '') not in ('multiple_choice', 'free_response')
  ) then
    raise exception 'Confidence evidence contains an invalid entry.';
  end if;

  if jsonb_typeof(adjustment) = 'object'
    and coalesce(adjustment ->> 'learningMode', '') not in ('learn', 'study') then
    raise exception 'The next session learning mode is not valid.';
  end if;

  if jsonb_typeof(follow_up) = 'object' and (
    length(btrim(coalesce(follow_up ->> 'title', ''))) not between 1 and 180
    or length(btrim(coalesce(follow_up ->> 'objective', ''))) not between 1 and 900
    or length(btrim(coalesce(follow_up ->> 'method', ''))) not between 1 and 180
    or length(btrim(coalesce(follow_up ->> 'methodReason', ''))) not between 1 and 900
    or length(btrim(coalesce(follow_up ->> 'amountLabel', ''))) not between 1 and 180
    or coalesce(follow_up ->> 'learningMode', '') not in ('learn', 'study')
    or nullif(follow_up ->> 'estimatedMinutes', '')::integer not between 5 and 180
    or nullif(follow_up ->> 'scheduledFor', '')::timestamptz is null
  ) then
    raise exception 'The delayed verification session is not valid.';
  end if;

  select *
  into completed_session
  from public.plan_sessions
  where id = (payload ->> 'planSessionId')::uuid
    and user_id = current_user_id
  for update;

  if not found then
    raise exception 'The requested session was not found.';
  end if;

  if jsonb_typeof(follow_up) = 'object' then
    if nullif(follow_up ->> 'sequence', '')::integer <> completed_session.sequence + 1 then
      raise exception 'The delayed verification sequence is not valid.';
    end if;

    if exists (
      select 1
      from public.plan_sessions
      where plan_id = completed_session.plan_id
        and user_id = current_user_id
        and sequence = completed_session.sequence + 1
        and id <> (follow_up ->> 'id')::uuid
    ) then
      raise exception 'A next session already exists.';
    end if;
  end if;

  update public.plan_sessions
  set status = 'complete'
  where id = completed_session.id
    and user_id = current_user_id;

  if jsonb_typeof(adjustment) = 'object' then
    update public.plan_sessions
    set
      title = left(coalesce(nullif(adjustment ->> 'title', ''), title), 180),
      objective = left(coalesce(nullif(adjustment ->> 'objective', ''), objective), 900),
      method = left(coalesce(nullif(adjustment ->> 'method', ''), method), 180),
      method_rationale = left(coalesce(nullif(adjustment ->> 'methodReason', ''), method_rationale), 900),
      estimated_minutes = greatest(5, least(180, coalesce(nullif(adjustment ->> 'estimatedMinutes', '')::smallint, estimated_minutes))),
      step_data = (
        case when jsonb_typeof(step_data) = 'object' then step_data else '{}'::jsonb end
        - 'generatedSession'
      ) || jsonb_build_object(
        'amountLabel', coalesce(nullif(adjustment ->> 'amountLabel', ''), step_data ->> 'amountLabel'),
        'learningMode', adjustment ->> 'learningMode',
        'adaptationExplanation', adjustment ->> 'explanation',
        'adaptedAt', payload ->> 'completedAt'
      )
    where id = (adjustment ->> 'planSessionId')::uuid
      and plan_id = completed_session.plan_id
      and user_id = current_user_id
      and sequence = completed_session.sequence + 1
      and status = 'upcoming';
  end if;

  update public.plan_sessions
  set status = 'ready'
  where plan_id = completed_session.plan_id
    and user_id = current_user_id
    and sequence = completed_session.sequence + 1
    and status = 'upcoming';

  if jsonb_typeof(follow_up) = 'object' then
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
      (follow_up ->> 'id')::uuid,
      current_user_id,
      completed_session.plan_id,
      (follow_up ->> 'sequence')::smallint,
      follow_up ->> 'title',
      follow_up ->> 'objective',
      follow_up ->> 'method',
      follow_up ->> 'methodReason',
      (follow_up ->> 'scheduledFor')::timestamptz,
      (follow_up ->> 'estimatedMinutes')::smallint,
      'ready',
      jsonb_build_object(
        'amountLabel', follow_up ->> 'amountLabel',
        'learningMode', follow_up ->> 'learningMode',
        'adaptationExplanation', coalesce(nullif(follow_up ->> 'explanation', ''), follow_up ->> 'methodReason'),
        'adaptedAt', payload ->> 'completedAt'
      )
    )
    on conflict (plan_id, sequence) do nothing;

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
  end if;

  insert into public.session_attempts (
    id,
    user_id,
    plan_session_id,
    started_at,
    completed_at,
    actual_minutes,
    correct_answers,
    total_answers,
    user_feedback,
    result_data
  ) values (
    (payload ->> 'attemptId')::uuid,
    current_user_id,
    completed_session.id,
    declared_started_at,
    declared_completed_at,
    declared_actual_minutes,
    (payload ->> 'correctAnswers')::smallint,
    (payload ->> 'totalAnswers')::smallint,
    payload ->> 'feedback',
    jsonb_build_object(
      'observedGap', payload ->> 'observedGap',
      'conceptEvidence', concept_evidence,
      'confidenceEvidence', confidence_evidence,
      'plannedMinutes', declared_planned_minutes,
      'nextSessionAdjustment', adjustment,
      'followUpSession', follow_up
    )
  )
  on conflict (id) do nothing;

  get diagnostics attempt_inserted = row_count;

  if attempt_inserted > 0 then
    insert into public.learning_events (
      user_id,
      learning_item_id,
      plan_session_id,
      event_type,
      event_data,
      occurred_at
    )
    select
      current_user_id,
      plans.learning_item_id,
      completed_session.id,
      'session_completed',
      jsonb_build_object(
        'attemptId', payload ->> 'attemptId',
        'plannedMinutes', declared_planned_minutes,
        'actualMinutes', declared_actual_minutes,
        'correctAnswers', (payload ->> 'correctAnswers')::smallint,
        'totalAnswers', (payload ->> 'totalAnswers')::smallint,
        'feedback', payload ->> 'feedback',
        'conceptEvidenceCount', jsonb_array_length(concept_evidence),
        'confidenceEvidenceCount', jsonb_array_length(confidence_evidence),
        'nextSessionAdjusted', jsonb_typeof(adjustment) = 'object',
        'delayedVerificationScheduled', jsonb_typeof(follow_up) = 'object'
      ),
      declared_completed_at
    from public.plans
    where plans.id = completed_session.plan_id
      and plans.user_id = current_user_id;
  end if;

  if not exists (
    select 1
    from public.plan_sessions
    where plan_id = completed_session.plan_id
      and user_id = current_user_id
      and status in ('ready', 'upcoming')
  ) then
    update public.plans
    set status = 'completed'
    where id = completed_session.plan_id
      and user_id = current_user_id;

    update public.learning_items
    set status = 'completed'
    where id = (
      select learning_item_id
      from public.plans
      where id = completed_session.plan_id
        and user_id = current_user_id
    )
      and user_id = current_user_id;
  end if;

  return completed_session.plan_id;
end;
$$;

revoke all on function public.complete_plan_session(jsonb) from public;
grant execute on function public.complete_plan_session(jsonb) to authenticated;
