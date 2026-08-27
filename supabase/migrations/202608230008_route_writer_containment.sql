-- Make the route-aware RPC layer the only authenticated write boundary for
-- plan sessions. RLS still scopes reads, while table privileges can no longer
-- be used to insert, delete, or rewrite route-owned scalar state directly.
-- Security-definer business RPCs continue to run as the migration owner; the
-- authenticated account is still recovered from auth.uid() inside each RPC.

revoke insert, delete, update on table public.plan_sessions
from public, anon, authenticated;

-- 202608210005 intentionally retained these column-level grants after
-- revoking table-level UPDATE. PostgreSQL tracks column grants separately, so
-- revoke them explicitly as part of the route boundary cutover.
revoke update (
  sequence,
  title,
  objective,
  method,
  method_rationale,
  estimated_minutes,
  status,
  step_data
) on table public.plan_sessions
from public, anon, authenticated;

-- These supported entry points were intentionally SECURITY INVOKER before
-- direct table writes were closed. Each already uses an empty search_path and
-- validates auth.uid() ownership. Elevate only the established function body
-- so it can keep using the now-private table operations.
alter function public.save_generated_plan_with_routes(jsonb) security definer;
alter function public.cache_generated_session(jsonb) security definer;
alter function public.save_learner_profile(jsonb) security definer;
alter function public.delete_active_session_checkpoint(uuid, uuid) security definer;

revoke all on function public.save_generated_plan(jsonb)
from public, anon, authenticated;

revoke all on function public.save_generated_plan_with_routes(jsonb)
from public, anon, authenticated;
grant execute on function public.save_generated_plan_with_routes(jsonb)
to authenticated;

revoke all on function public.cache_generated_session(jsonb)
from public, anon, authenticated;
grant execute on function public.cache_generated_session(jsonb)
to authenticated;

revoke all on function public.save_learner_profile(jsonb)
from public, anon, authenticated;
grant execute on function public.save_learner_profile(jsonb)
to authenticated;

revoke all on function public.delete_active_session_checkpoint(uuid, uuid)
from public, anon, authenticated;
grant execute on function public.delete_active_session_checkpoint(uuid, uuid)
to authenticated;

-- Duration changes alter the deterministic session contract. Keep the mature
-- implementation for null-pointer legacy sessions, but put a binding lock in
-- front of it so a routed session must use the route-aware plan-adjustment RPC.
alter function public.adjust_plan_session_duration(jsonb)
rename to adjust_plan_session_duration_without_study_routes;

revoke all on function public.adjust_plan_session_duration_without_study_routes(jsonb)
from public, anon, authenticated;

create or replace function public.adjust_plan_session_duration(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_session_id uuid;
begin
  if auth.uid() is null then
    raise exception using
      errcode = '28000',
      message = 'session_duration_authentication_required';
  end if;

  begin
    requested_session_id := (payload ->> 'planSessionId')::uuid;
  exception when others then
    raise exception using
      errcode = '22023',
      message = 'session_duration_invalid_session_id';
  end;

  if requested_session_id is null then
    raise exception using
      errcode = '22023',
      message = 'session_duration_invalid_session_id';
  end if;

  perform public.lock_study_route_binding_v2(
    requested_session_id,
    null,
    false
  );

  return public.adjust_plan_session_duration_without_study_routes(payload);
end;
$$;

revoke all on function public.adjust_plan_session_duration(jsonb)
from public, anon, authenticated;
grant execute on function public.adjust_plan_session_duration(jsonb)
to authenticated;

-- Learning mode is also route-owned. Preserve the old endpoint for legacy
-- rows only; routed rows need a new committed revision through the canonical
-- adjustment transaction instead of an in-place step_data rewrite.
alter function public.set_plan_session_learning_mode(uuid, text)
rename to set_plan_session_learning_mode_without_study_routes;

revoke all on function public.set_plan_session_learning_mode_without_study_routes(uuid, text)
from public, anon, authenticated;

create or replace function public.set_plan_session_learning_mode(
  requested_session_id uuid,
  requested_learning_mode text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception using
      errcode = '28000',
      message = 'learning_mode_authentication_required';
  end if;

  perform public.lock_study_route_binding_v2(
    requested_session_id,
    null,
    false
  );

  perform public.set_plan_session_learning_mode_without_study_routes(
    requested_session_id,
    requested_learning_mode
  );
end;
$$;

revoke all on function public.set_plan_session_learning_mode(uuid, text)
from public, anon, authenticated;
grant execute on function public.set_plan_session_learning_mode(uuid, text)
to authenticated;

-- Attaching a new source changes the knowledge map and source requirements for
-- every unfinished session. Until that workflow can create successor routes
-- atomically, fail closed for any routed plan and retain the mature behavior
-- for a wholly legacy plan.
alter function public.attach_materials_to_plan(jsonb)
rename to attach_materials_to_plan_without_study_routes;

revoke all on function public.attach_materials_to_plan_without_study_routes(jsonb)
from public, anon, authenticated;

create or replace function public.attach_materials_to_plan(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  requested_plan_id uuid;
  routed_session_count integer;
begin
  if current_user_id is null then
    raise exception using
      errcode = '28000',
      message = 'material_attachment_authentication_required';
  end if;

  begin
    requested_plan_id := (payload ->> 'planId')::uuid;
  exception when others then
    raise exception using
      errcode = '22023',
      message = 'material_attachment_invalid_plan_id';
  end;

  if requested_plan_id is null then
    raise exception using
      errcode = '22023',
      message = 'material_attachment_invalid_plan_id';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('yova_learning_data'),
    pg_catalog.hashtext(current_user_id::text)
  );

  perform plan.id
  from public.plans as plan
  where plan.id = requested_plan_id
    and plan.user_id = current_user_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'material_attachment_plan_not_found';
  end if;

  perform session.id
  from public.plan_sessions as session
  where session.plan_id = requested_plan_id
    and session.user_id = current_user_id
  order by session.sequence, session.id
  for update;

  select pg_catalog.count(*)::integer
  into routed_session_count
  from public.plan_sessions as session
  where session.plan_id = requested_plan_id
    and session.user_id = current_user_id
    and session.committed_route_revision_id is not null;

  if routed_session_count > 0 then
    raise exception using
      errcode = '55000',
      message = 'material_attachment_route_update_required';
  end if;

  return public.attach_materials_to_plan_without_study_routes(payload);
end;
$$;

revoke all on function public.attach_materials_to_plan(jsonb)
from public, anon, authenticated;
grant execute on function public.attach_materials_to_plan(jsonb)
to authenticated;

comment on function public.adjust_plan_session_duration(jsonb) is
  'Legacy-only duration adjustment. Routed sessions must use adjust_learning_plan_with_routes.';
comment on function public.set_plan_session_learning_mode(uuid, text) is
  'Legacy-only learning-mode adjustment. Routed sessions require a successor StudyRoute.';
comment on function public.attach_materials_to_plan(jsonb) is
  'Legacy-only material attachment until routed source changes can commit successor StudyRoutes atomically.';
