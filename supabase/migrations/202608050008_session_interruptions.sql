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
    or declared_completed_steps >= declared_total_steps then
    raise exception 'Session progress is not valid.';
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
      'totalSteps', declared_total_steps
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
        'totalSteps', declared_total_steps
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
