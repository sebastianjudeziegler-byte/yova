create or replace function public.reschedule_plan_session(payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  requested_session public.plan_sessions%rowtype;
  next_time timestamptz := (payload ->> 'scheduledFor')::timestamptz;
  learning_item_id uuid;
begin
  if current_user_id is null then
    raise exception 'Authentication is required.';
  end if;

  if next_time < now() - interval '5 minutes'
    or next_time > now() + interval '366 days' then
    raise exception 'The requested time is outside the allowed range.';
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

  if requested_session.status in ('complete', 'skipped') then
    raise exception 'A finished session cannot be rescheduled.';
  end if;

  update public.plan_sessions
  set scheduled_for = next_time
  where id = requested_session.id
    and user_id = current_user_id;

  select plans.learning_item_id
  into learning_item_id
  from public.plans
  where plans.id = requested_session.plan_id
    and plans.user_id = current_user_id;

  insert into public.learning_events (
    user_id,
    learning_item_id,
    plan_session_id,
    event_type,
    event_data,
    occurred_at
  ) values (
    current_user_id,
    learning_item_id,
    requested_session.id,
    'session_rescheduled',
    jsonb_build_object(
      'previousScheduledFor', requested_session.scheduled_for,
      'scheduledFor', next_time
    ),
    now()
  );

  return jsonb_build_object(
    'planSessionId', requested_session.id,
    'scheduledFor', next_time
  );
end;
$$;

revoke all on function public.reschedule_plan_session(jsonb) from public;
grant execute on function public.reschedule_plan_session(jsonb) to authenticated;
