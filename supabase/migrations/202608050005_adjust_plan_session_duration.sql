create or replace function public.adjust_plan_session_duration(payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  requested_session public.plan_sessions%rowtype;
  requested_plan public.plans%rowtype;
  next_minutes smallint := (payload ->> 'estimatedMinutes')::smallint;
  next_amount_label text;
begin
  if current_user_id is null then
    raise exception 'Authentication is required.';
  end if;

  if next_minutes < 5 or next_minutes > 90 then
    raise exception 'The requested session length is outside the allowed range.';
  end if;

  select *
  into requested_session
  from public.plan_sessions
  where id = (payload ->> 'planSessionId')::uuid
    and user_id = current_user_id
  for update;

  if not found then
    raise exception 'The requested session was not found.';
  end if;

  if requested_session.status not in ('ready', 'upcoming') then
    raise exception 'A finished session cannot be changed.';
  end if;

  select *
  into requested_plan
  from public.plans
  where id = requested_session.plan_id
    and user_id = current_user_id;

  if not found or requested_plan.status <> 'active' then
    raise exception 'Only a session in an active plan can be changed.';
  end if;

  next_amount_label := coalesce(
    nullif(split_part(requested_session.step_data ->> 'amountLabel', ' · about', 1), ''),
    'Focused work'
  ) || ' · about ' || next_minutes || ' min';

  update public.plan_sessions
  set estimated_minutes = next_minutes,
      step_data = jsonb_set(
        coalesce(step_data, '{}'::jsonb) - 'generatedSession',
        '{amountLabel}',
        to_jsonb(next_amount_label),
        true
      )
  where id = requested_session.id
    and user_id = current_user_id;

  insert into public.learning_events (
    user_id,
    learning_item_id,
    plan_session_id,
    event_type,
    event_data,
    occurred_at
  ) values (
    current_user_id,
    requested_plan.learning_item_id,
    requested_session.id,
    'session_duration_adjusted',
    jsonb_build_object(
      'previousEstimatedMinutes', requested_session.estimated_minutes,
      'estimatedMinutes', next_minutes,
      'source', 'tutor_approval'
    ),
    now()
  );

  return jsonb_build_object(
    'planId', requested_plan.id,
    'planSessionId', requested_session.id,
    'estimatedMinutes', next_minutes,
    'amountLabel', next_amount_label
  );
end;
$$;

revoke all on function public.adjust_plan_session_duration(jsonb) from public;
grant execute on function public.adjust_plan_session_duration(jsonb) to authenticated;
