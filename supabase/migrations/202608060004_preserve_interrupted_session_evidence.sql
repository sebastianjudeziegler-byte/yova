create or replace function public.record_session_interruption(payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  interrupted_session public.plan_sessions%rowtype;
  declared_started_at timestamptz;
  declared_interrupted_at timestamptz;
  declared_planned_minutes smallint;
  declared_actual_minutes smallint;
  declared_completed_steps smallint;
  declared_total_steps smallint;
  declared_resume_step smallint;
  declared_evidence jsonb := coalesce(payload -> 'evidence', '{}'::jsonb);
  declared_pending_repair jsonb := payload -> 'pendingRepair';
  evidence_correct_answers smallint;
  evidence_total_answers smallint;
  evidence_completed_repairs smallint;
  attempt_inserted integer := 0;
begin
  if current_user_id is null then
    raise exception 'Authentication is required.';
  end if;

  if coalesce(payload ->> 'attemptId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(payload ->> 'planSessionId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'Session identifiers are not valid.';
  end if;

  begin
    declared_started_at := (payload ->> 'startedAt')::timestamptz;
    declared_interrupted_at := (payload ->> 'interruptedAt')::timestamptz;
    declared_planned_minutes := (payload ->> 'plannedMinutes')::smallint;
    declared_actual_minutes := (payload ->> 'actualMinutes')::smallint;
    declared_completed_steps := (payload ->> 'completedSteps')::smallint;
    declared_total_steps := (payload ->> 'totalSteps')::smallint;
    declared_resume_step := coalesce((payload ->> 'resumeStep')::smallint, declared_completed_steps);
    evidence_correct_answers := coalesce((declared_evidence ->> 'correctAnswers')::smallint, 0);
    evidence_total_answers := coalesce((declared_evidence ->> 'totalAnswers')::smallint, 0);
    evidence_completed_repairs := coalesce((declared_evidence ->> 'completedImmediateRepairs')::smallint, 0);
  exception when others then
    raise exception 'Session interruption data is not valid.';
  end;

  if declared_started_at > declared_interrupted_at
    or declared_interrupted_at - declared_started_at > interval '12 hours'
    or declared_interrupted_at > now() + interval '5 minutes' then
    raise exception 'Session interruption timing is not valid.';
  end if;

  if declared_planned_minutes not between 5 and 180
    or declared_actual_minutes not between 1 and 360 then
    raise exception 'Session duration is not valid.';
  end if;

  if declared_total_steps not between 1 and 24
    or declared_completed_steps < 0
    or declared_completed_steps >= declared_total_steps
    or declared_resume_step < 0
    or declared_resume_step >= declared_total_steps then
    raise exception 'Session progress is not valid.';
  end if;

  if jsonb_typeof(declared_evidence) <> 'object'
    or evidence_correct_answers not between 0 and 24
    or evidence_total_answers not between 0 and 24
    or evidence_correct_answers > evidence_total_answers
    or evidence_completed_repairs not between 0 and 4
    or jsonb_typeof(coalesce(declared_evidence -> 'conceptEvidence', '[]'::jsonb)) <> 'array'
    or jsonb_array_length(coalesce(declared_evidence -> 'conceptEvidence', '[]'::jsonb)) > 24
    or jsonb_typeof(coalesce(declared_evidence -> 'confidenceEvidence', '[]'::jsonb)) <> 'array'
    or jsonb_array_length(coalesce(declared_evidence -> 'confidenceEvidence', '[]'::jsonb)) > 24
    or length(coalesce(declared_evidence ->> 'observedGap', '')) > 1000
    or octet_length(declared_evidence::text) > 20000 then
    raise exception 'Interrupted-session evidence is not valid.';
  end if;

  if declared_pending_repair is not null
    and jsonb_typeof(declared_pending_repair) <> 'null'
    and (
      jsonb_typeof(declared_pending_repair) <> 'object'
      or length(coalesce(declared_pending_repair ->> 'concept', '')) not between 2 and 120
      or length(coalesce(declared_pending_repair ->> 'title', '')) not between 3 and 180
      or length(coalesce(declared_pending_repair ->> 'body', '')) not between 10 and 700
      or length(coalesce(declared_pending_repair ->> 'correctAnswer', '')) not between 1 and 700
      or length(coalesce(declared_pending_repair ->> 'feedback', '')) > 900
    ) then
    raise exception 'Pending repair data is not valid.';
  end if;

  select *
  into interrupted_session
  from public.plan_sessions
  where id = (payload ->> 'planSessionId')::uuid
    and user_id = current_user_id
    and status = 'ready';

  if not found then
    raise exception 'The active session was not found.';
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
    interrupted_session.id,
    declared_started_at,
    null,
    declared_actual_minutes,
    null,
    null,
    null,
    jsonb_build_object(
      'status', 'interrupted',
      'interruptedAt', declared_interrupted_at,
      'plannedMinutes', declared_planned_minutes,
      'completedSteps', declared_completed_steps,
      'totalSteps', declared_total_steps,
      'resumeStep', declared_resume_step,
      'evidence', declared_evidence,
      'pendingRepair', declared_pending_repair
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
      interrupted_session.id,
      'session_interrupted',
      jsonb_build_object(
        'attemptId', payload ->> 'attemptId',
        'startedAt', declared_started_at,
        'plannedMinutes', declared_planned_minutes,
        'actualMinutes', declared_actual_minutes,
        'completedSteps', declared_completed_steps,
        'totalSteps', declared_total_steps,
        'resumeStep', declared_resume_step,
        'evidence', declared_evidence,
        'pendingRepair', declared_pending_repair
      ),
      declared_interrupted_at
    from public.plans
    where plans.id = interrupted_session.plan_id
      and plans.user_id = current_user_id;
  end if;

  return interrupted_session.plan_id;
end;
$$;

revoke all on function public.record_session_interruption(jsonb) from public;
grant execute on function public.record_session_interruption(jsonb) to authenticated;
