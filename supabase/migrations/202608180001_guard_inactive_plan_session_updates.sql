-- Keep archived, completed, and draft plans inert even when an older browser
-- finishes an RPC after the plan has stopped being active. The parent-row lock
-- makes the status check serialize with both RPC-backed and direct plan status
-- updates.

create or replace function public.guard_inactive_plan_session_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  parent_status text;
  cleanup_only boolean := false;
begin
  -- Sessions are created inside one owned plan and have no legitimate
  -- reparenting path. Rejecting association changes also prevents an active
  -- source plan from being used to bypass the inactive destination guard.
  if new.plan_id is distinct from old.plan_id
    or new.user_id is distinct from old.user_id then
    raise exception using
      errcode = '55000',
      message = 'plan_session_reparent_forbidden';
  end if;

  -- The outer UPDATE already owns the session-row lock. Some existing RPCs
  -- deliberately use the opposite order (plan first, then session), so waiting
  -- here could form a plan/session deadlock. Fail with a bounded retryable
  -- conflict instead; whichever transaction owns the parent lock establishes
  -- the authoritative ordering.
  begin
    select plans.status
    into parent_status
    from public.plans as plans
    where plans.id = old.plan_id
      and plans.user_id = old.user_id
    for no key update nowait;
  exception
    when lock_not_available then
      raise exception using
        errcode = '40001',
        message = 'plan_session_parent_state_conflict';
  end;

  if not found then
    raise exception using
      errcode = '23503',
      message = 'plan_session_parent_missing';
  end if;

  if parent_status = 'active' then
    return new;
  end if;

  -- Cache invalidation and recovery cleanup remain safe after a plan becomes
  -- inactive. Compare the complete row as jsonb so any column added by a future
  -- migration is protected automatically; updated_at is omitted because its
  -- existing BEFORE UPDATE trigger owns that bookkeeping field.
  cleanup_only :=
    jsonb_typeof(old.step_data) = 'object'
    and jsonb_typeof(new.step_data) = 'object'
    and (
      (
        old.step_data ? 'generatedSession'
        and new.step_data is not distinct from old.step_data - 'generatedSession'
      )
      or (
        old.step_data ? 'activeSessionCheckpoint'
        and new.step_data is not distinct from old.step_data - 'activeSessionCheckpoint'
      )
      or (
        (old.step_data ? 'generatedSession' or old.step_data ? 'activeSessionCheckpoint')
        and new.step_data is not distinct from
          old.step_data - 'generatedSession' - 'activeSessionCheckpoint'
      )
    )
    and (
      to_jsonb(new) - 'step_data' - 'updated_at'
    ) is not distinct from (
      to_jsonb(old) - 'step_data' - 'updated_at'
    );

  if cleanup_only then
    return new;
  end if;

  raise exception using
    errcode = '55000',
    message = 'plan_session_parent_inactive';
end;
$$;

-- PostgreSQL runs same-event triggers in name order. This guard deliberately
-- follows plan_sessions_clear_invalid_active_session_checkpoint so a generated
-- lesson invalidation may atomically clear its now-stale recovery checkpoint,
-- and precedes plan_sessions_set_updated_at.
drop trigger if exists plan_sessions_guard_inactive_parent_update
on public.plan_sessions;
create trigger plan_sessions_guard_inactive_parent_update
before update on public.plan_sessions
for each row execute function public.guard_inactive_plan_session_update();

revoke all on function public.guard_inactive_plan_session_update()
from public, anon, authenticated;
