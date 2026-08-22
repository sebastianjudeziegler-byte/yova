-- Move one or many unfinished plan sessions through one authoritative
-- transaction. The plan row is the lifecycle/version lock; every unfinished
-- session is then locked before the proposed schedule is validated and written.

create or replace function public.reschedule_plan_sessions(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  requested_plan_id uuid;
  requested_plan public.plans%rowtype;
  schedule_updates jsonb := payload -> 'updates';
  operation_kind text := coalesce(payload ->> 'operationKind', 'manual');
  update_count integer;
  unfinished_count integer;
  plan_deadline timestamptz;
  authoritative_sessions jsonb := '[]'::jsonb;
begin
  if current_user_id is null then
    raise exception using errcode = '28000', message = 'schedule_authentication_required';
  end if;

  if coalesce(jsonb_typeof(schedule_updates), 'null') <> 'array' then
    raise exception using errcode = '22023', message = 'schedule_invalid_payload';
  end if;
  update_count := jsonb_array_length(schedule_updates);
  if update_count < 1 or update_count > 28 then
    raise exception using errcode = '22023', message = 'schedule_invalid_update_count';
  end if;
  if operation_kind not in ('manual', 'advance_now') then
    raise exception using errcode = '22023', message = 'schedule_invalid_operation_kind';
  end if;

  begin
    requested_plan_id := (payload ->> 'planId')::uuid;
    perform
      (candidate.value ->> 'planSessionId')::uuid,
      (candidate.value ->> 'scheduledFor')::timestamptz
    from jsonb_array_elements(schedule_updates) as candidate(value)
    where jsonb_typeof(candidate.value) = 'object'
      and jsonb_typeof(candidate.value -> 'planSessionId') = 'string'
      and jsonb_typeof(candidate.value -> 'scheduledFor') = 'string';
  exception when others then
    raise exception using errcode = '22023', message = 'schedule_invalid_payload';
  end;

  if requested_plan_id is null
    or exists (
    select 1
    from jsonb_array_elements(schedule_updates) as candidate(value)
    where jsonb_typeof(candidate.value) is distinct from 'object'
      or jsonb_typeof(candidate.value -> 'planSessionId') is distinct from 'string'
      or jsonb_typeof(candidate.value -> 'scheduledFor') is distinct from 'string'
    ) then
    raise exception using errcode = '22023', message = 'schedule_invalid_payload';
  end if;

  if (
    select count(distinct (candidate.value ->> 'planSessionId')::uuid)
    from jsonb_array_elements(schedule_updates) as candidate(value)
  ) <> update_count then
    raise exception using errcode = '22023', message = 'schedule_duplicate_session';
  end if;

  if operation_kind = 'manual' and exists (
    select 1
    from jsonb_array_elements(schedule_updates) as candidate(value)
    where (candidate.value ->> 'scheduledFor')::timestamptz <= now()
  ) then
    raise exception using errcode = '22023', message = 'schedule_time_in_past';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(schedule_updates) as candidate(value)
    where (
        operation_kind = 'advance_now'
        and (candidate.value ->> 'scheduledFor')::timestamptz < now() - interval '5 minutes'
      )
      or (candidate.value ->> 'scheduledFor')::timestamptz > now() + interval '366 days'
  ) then
    raise exception using errcode = '22023', message = 'schedule_time_out_of_range';
  end if;

  -- Serialize against account reset, self-deletion and plan deletion before
  -- taking row locks. Those destructive workflows use this same user key.
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
    raise exception using errcode = 'P0002', message = 'schedule_plan_not_found';
  end if;
  if requested_plan.status <> 'active' then
    raise exception using errcode = '55000', message = 'schedule_plan_inactive';
  end if;

  -- Lock the complete invariant set, not just the rows named by this request.
  -- This makes a single-session move and a plan-wide shift obey the same order.
  perform session.id
  from public.plan_sessions as session
  where session.plan_id = requested_plan.id
    and session.user_id = current_user_id
    and session.status in ('ready', 'upcoming')
  order by session.sequence
  for update;

  get diagnostics unfinished_count = row_count;
  if unfinished_count < 1 or unfinished_count > 28 then
    raise exception using errcode = '55000', message = 'schedule_unfinished_set_invalid';
  end if;

  if (
    select count(*)
    from jsonb_to_recordset(schedule_updates) as requested(
      "planSessionId" uuid,
      "scheduledFor" timestamptz
    )
    join public.plan_sessions as session
      on session.id = requested."planSessionId"
      and session.plan_id = requested_plan.id
      and session.user_id = current_user_id
      and session.status in ('ready', 'upcoming')
  ) <> update_count then
    raise exception using errcode = '55000', message = 'schedule_session_unavailable';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(schedule_updates) as requested(
      "planSessionId" uuid,
      "scheduledFor" timestamptz
    )
    join public.plan_sessions as session
      on session.id = requested."planSessionId"
      and session.plan_id = requested_plan.id
      and session.user_id = current_user_id
      and session.status in ('ready', 'upcoming')
    where requested."scheduledFor" is not distinct from session.scheduled_for
  ) then
    raise exception using errcode = '55000', message = 'schedule_unchanged';
  end if;

  -- Plan adjustment uses the order plan -> unfinished sessions -> learning item.
  -- Match that order so deadline changes and schedule changes cannot deadlock.
  select item.deadline
  into plan_deadline
  from public.learning_items as item
  where item.id = requested_plan.learning_item_id
    and item.user_id = current_user_id
  for no key update;

  if not found then
    raise exception using errcode = 'P0002', message = 'schedule_learning_item_not_found';
  end if;

  if exists (
    with requested as (
      select *
      from jsonb_to_recordset(schedule_updates) as change(
        "planSessionId" uuid,
        "scheduledFor" timestamptz
      )
    ), proposed as (
      select
        session.sequence,
        coalesce(requested."scheduledFor", session.scheduled_for) as scheduled_for,
        session.estimated_minutes
      from public.plan_sessions as session
      left join requested on requested."planSessionId" = session.id
      where session.plan_id = requested_plan.id
        and session.user_id = current_user_id
        and session.status in ('ready', 'upcoming')
    ), ordered as (
      select
        scheduled_for,
        lag(
          scheduled_for + estimated_minutes * interval '1 minute'
        ) over (order by sequence) as previous_ends_at
      from proposed
    )
    select 1
    from ordered
    where scheduled_for is null
      or (previous_ends_at is not null and scheduled_for < previous_ends_at)
  ) then
    raise exception using errcode = '55000', message = 'schedule_sequence_conflict';
  end if;

  if plan_deadline is not null and exists (
    with requested as (
      select *
      from jsonb_to_recordset(schedule_updates) as change(
        "planSessionId" uuid,
        "scheduledFor" timestamptz
      )
    )
    select 1
    from public.plan_sessions as session
    left join requested on requested."planSessionId" = session.id
    where session.plan_id = requested_plan.id
      and session.user_id = current_user_id
      and session.status in ('ready', 'upcoming')
      and coalesce(requested."scheduledFor", session.scheduled_for)
        + session.estimated_minutes * interval '1 minute' > plan_deadline
  ) then
    raise exception using errcode = '55000', message = 'schedule_deadline_conflict';
  end if;

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
    requested_plan.learning_item_id,
    session.id,
    'session_rescheduled',
    jsonb_build_object(
      'previousScheduledFor', session.scheduled_for,
      'scheduledFor', requested."scheduledFor",
      'batchSize', update_count
    ),
    now()
  from jsonb_to_recordset(schedule_updates) as requested(
    "planSessionId" uuid,
    "scheduledFor" timestamptz
  )
  join public.plan_sessions as session
    on session.id = requested."planSessionId"
    and session.plan_id = requested_plan.id
    and session.user_id = current_user_id
  where session.scheduled_for is distinct from requested."scheduledFor";

  update public.plan_sessions as session
  set scheduled_for = requested."scheduledFor"
  from jsonb_to_recordset(schedule_updates) as requested(
    "planSessionId" uuid,
    "scheduledFor" timestamptz
  )
  where session.id = requested."planSessionId"
    and session.plan_id = requested_plan.id
    and session.user_id = current_user_id
    and session.status in ('ready', 'upcoming')
    and session.scheduled_for is distinct from requested."scheduledFor";

  select jsonb_agg(
    jsonb_build_object(
      'planSessionId', session.id,
      'scheduledFor', session.scheduled_for
    )
    order by session.sequence
  )
  into authoritative_sessions
  from public.plan_sessions as session
  where session.plan_id = requested_plan.id
    and session.user_id = current_user_id
    and session.status in ('ready', 'upcoming');

  if coalesce(jsonb_array_length(authoritative_sessions), 0) <> unfinished_count then
    raise exception using errcode = '55000', message = 'schedule_authoritative_read_failed';
  end if;

  return jsonb_build_object(
    'planId', requested_plan.id,
    'sessions', authoritative_sessions
  );
end;
$$;

revoke all on function public.reschedule_plan_sessions(jsonb)
from public, anon, authenticated;
grant execute on function public.reschedule_plan_sessions(jsonb) to authenticated;

-- Authenticated PostgREST callers may still use every established unfinished
-- session writer, but scheduled_for is writable only through the checked
-- security-definer RPC above. RLS alone limits ownership; it does not enforce
-- chronology, deadline or audit invariants for direct column updates.
revoke update on table public.plan_sessions from public, anon, authenticated;
grant update (
  sequence,
  title,
  objective,
  method,
  method_rationale,
  estimated_minutes,
  status,
  step_data
) on table public.plan_sessions to authenticated;

-- Preserve compatibility for an already-open browser using the old one-row
-- request while making that request pass through the same transactional core.
create or replace function public.reschedule_plan_session(payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  requested_session_id uuid;
  requested_plan_id uuid;
  batch_result jsonb;
  authoritative_time text;
begin
  if current_user_id is null then
    raise exception using errcode = '28000', message = 'schedule_authentication_required';
  end if;

  begin
    requested_session_id := (payload ->> 'planSessionId')::uuid;
  exception when others then
    raise exception using errcode = '22023', message = 'schedule_invalid_payload';
  end;

  select session.plan_id
  into requested_plan_id
  from public.plan_sessions as session
  where session.id = requested_session_id
    and session.user_id = current_user_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'schedule_session_unavailable';
  end if;

  batch_result := public.reschedule_plan_sessions(jsonb_build_object(
    'planId', requested_plan_id,
    'operationKind', 'manual',
    'updates', jsonb_build_array(jsonb_build_object(
      'planSessionId', requested_session_id,
      'scheduledFor', payload ->> 'scheduledFor'
    ))
  ));

  select candidate.value ->> 'scheduledFor'
  into authoritative_time
  from jsonb_array_elements(batch_result -> 'sessions') as candidate(value)
  where candidate.value ->> 'planSessionId' = requested_session_id::text;

  if authoritative_time is null then
    raise exception using errcode = '55000', message = 'schedule_authoritative_read_failed';
  end if;

  return jsonb_build_object(
    'planSessionId', requested_session_id,
    'scheduledFor', authoritative_time
  );
end;
$$;

revoke all on function public.reschedule_plan_session(jsonb)
from public, anon, authenticated;
grant execute on function public.reschedule_plan_session(jsonb) to authenticated;
