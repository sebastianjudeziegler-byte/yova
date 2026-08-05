create or replace function public.adjust_learning_plan(payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  requested_plan public.plans%rowtype;
  next_deadline timestamptz := nullif(payload ->> 'deadline', '')::timestamptz;
  next_study_mode text := payload ->> 'studyMode';
  next_minutes smallint := (payload ->> 'futureSessionMinutes')::smallint;
  updated_sessions jsonb;
begin
  if current_user_id is null then
    raise exception 'Authentication is required.';
  end if;

  if next_study_mode not in ('inside_yova', 'outside_yova') then
    raise exception 'The requested study mode is not supported.';
  end if;

  if next_minutes < 10 or next_minutes > 90 then
    raise exception 'The requested session length is outside the allowed range.';
  end if;

  if next_deadline is not null
    and (next_deadline < now() - interval '1 hour'
      or next_deadline > now() + interval '5 years') then
    raise exception 'The requested deadline is outside the allowed range.';
  end if;

  select *
  into requested_plan
  from public.plans
  where id = (payload ->> 'planId')::uuid
    and user_id = current_user_id
  for update;

  if not found then
    raise exception 'The requested plan was not found.';
  end if;

  if requested_plan.status <> 'active' then
    raise exception 'Only an active plan can be adjusted.';
  end if;

  update public.learning_items
  set deadline = next_deadline,
      study_mode = next_study_mode
  where id = requested_plan.learning_item_id
    and user_id = current_user_id;

  update public.plan_sessions
  set estimated_minutes = next_minutes,
      step_data = jsonb_set(
        coalesce(step_data, '{}'::jsonb) - 'generatedSession',
        '{amountLabel}',
        to_jsonb(
          coalesce(
            nullif(split_part(step_data ->> 'amountLabel', ' · about', 1), ''),
            'Focused work'
          ) || ' · about ' || next_minutes || ' min'
        ),
        true
      )
  where plan_id = requested_plan.id
    and user_id = current_user_id
    and status in ('ready', 'upcoming');

  update public.plans
  set generation_inputs = jsonb_set(
    coalesce(generation_inputs, '{}'::jsonb),
    '{lastAdjustment}',
    jsonb_build_object(
      'deadline', next_deadline,
      'studyMode', next_study_mode,
      'futureSessionMinutes', next_minutes,
      'adjustedAt', now()
    ),
    true
  )
  where id = requested_plan.id
    and user_id = current_user_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id,
    'estimatedMinutes', estimated_minutes,
    'amountLabel', step_data ->> 'amountLabel'
  ) order by sequence), '[]'::jsonb)
  into updated_sessions
  from public.plan_sessions
  where plan_id = requested_plan.id
    and user_id = current_user_id
    and status in ('ready', 'upcoming');

  insert into public.learning_events (
    user_id,
    learning_item_id,
    event_type,
    event_data,
    occurred_at
  ) values (
    current_user_id,
    requested_plan.learning_item_id,
    'plan_adjusted',
    jsonb_build_object(
      'planId', requested_plan.id,
      'deadline', next_deadline,
      'studyMode', next_study_mode,
      'futureSessionMinutes', next_minutes
    ),
    now()
  );

  return jsonb_build_object(
    'planId', requested_plan.id,
    'deadline', next_deadline,
    'studyMode', next_study_mode,
    'sessions', updated_sessions
  );
end;
$$;

revoke all on function public.adjust_learning_plan(jsonb) from public;
grant execute on function public.adjust_learning_plan(jsonb) to authenticated;
