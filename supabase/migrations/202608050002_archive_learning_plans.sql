create or replace function public.set_learning_plan_archive_state(payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  requested_plan public.plans%rowtype;
  restored_status text;
  requested_action text := payload ->> 'action';
begin
  if current_user_id is null then
    raise exception 'Authentication is required.';
  end if;

  if requested_action not in ('archive', 'restore') then
    raise exception 'The requested action is not supported.';
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

  if requested_action = 'archive' then
    update public.plans
    set status = 'archived'
    where id = requested_plan.id
      and user_id = current_user_id;

    update public.learning_items
    set status = 'archived'
    where id = requested_plan.learning_item_id
      and user_id = current_user_id;

    restored_status := 'archived';
  else
    if exists (
      select 1
      from public.plan_sessions
      where plan_id = requested_plan.id
        and user_id = current_user_id
        and status in ('ready', 'upcoming')
    ) then
      restored_status := 'active';
    else
      restored_status := 'completed';
    end if;

    update public.plans
    set status = restored_status
    where id = requested_plan.id
      and user_id = current_user_id;

    update public.learning_items
    set status = restored_status
    where id = requested_plan.learning_item_id
      and user_id = current_user_id;
  end if;

  insert into public.learning_events (
    user_id,
    learning_item_id,
    event_type,
    event_data,
    occurred_at
  ) values (
    current_user_id,
    requested_plan.learning_item_id,
    case when requested_action = 'archive' then 'plan_archived' else 'plan_restored' end,
    jsonb_build_object(
      'planId', requested_plan.id,
      'previousStatus', requested_plan.status,
      'status', restored_status
    ),
    now()
  );

  return jsonb_build_object(
    'planId', requested_plan.id,
    'status', restored_status
  );
end;
$$;

revoke all on function public.set_learning_plan_archive_state(jsonb) from public;
grant execute on function public.set_learning_plan_archive_state(jsonb) to authenticated;
