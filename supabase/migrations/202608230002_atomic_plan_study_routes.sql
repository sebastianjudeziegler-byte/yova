-- Save a generated plan and its first committed StudyRoute revisions through
-- one database call. This deliberately delegates plan/material persistence to
-- the currently deployed save_generated_plan(jsonb) function so its staged
-- material expiry and learner-lifecycle guards remain the source of truth.
-- PostgreSQL executes the nested calls in the wrapper's transaction: any route
-- rejection rolls the delegated plan write back with it.

create or replace function public.save_generated_plan_with_routes(payload jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  requested_plan_id uuid;
  saved_plan_id uuid;
  session_count integer;
  route_count integer;
  session_payload jsonb;
  route_payload jsonb;
  route_identity jsonb;
  requested_session_id uuid;
  routed_session_id uuid;
  routed_plan_id uuid;
  requested_route_revision_id uuid;
  committed_route_revision_id uuid;
  seen_session_ids uuid[] := array[]::uuid[];
  seen_route_revision_ids uuid[] := array[]::uuid[];
begin
  if current_user_id is null then
    raise exception using
      errcode = '28000',
      message = 'plan_route_authentication_required';
  end if;

  if jsonb_typeof(payload) is distinct from 'object'
    or jsonb_typeof(payload -> 'sessions') is distinct from 'array' then
    raise exception using
      errcode = '22023',
      message = 'plan_route_invalid_payload';
  end if;

  begin
    requested_plan_id := (payload ->> 'id')::uuid;
  exception when others then
    raise exception using
      errcode = '22023',
      message = 'plan_route_invalid_plan_id';
  end;

  select
    pg_catalog.count(*)::integer,
    pg_catalog.count(*) filter (where candidate.value ? 'studyRoute')::integer
  into session_count, route_count
  from pg_catalog.jsonb_array_elements(payload -> 'sessions') as candidate(value);

  -- A legacy payload may have no canonical routes. Once a caller supplies one
  -- route, every session must have one so activation can never persist a plan
  -- whose route coverage is only partially authoritative.
  if route_count <> 0 and route_count <> session_count then
    raise exception using
      errcode = '22023',
      message = 'plan_route_incomplete_coverage';
  end if;

  for session_payload in
    select candidate.value
    from pg_catalog.jsonb_array_elements(payload -> 'sessions') as candidate(value)
  loop
    if jsonb_typeof(session_payload) is distinct from 'object' then
      raise exception using
        errcode = '22023',
        message = 'plan_route_invalid_session';
    end if;

    begin
      requested_session_id := (session_payload ->> 'id')::uuid;
    exception when others then
      raise exception using
        errcode = '22023',
        message = 'plan_route_invalid_session_id';
    end;

    if requested_session_id = any(seen_session_ids) then
      raise exception using
        errcode = '22023',
        message = 'plan_route_duplicate_session_id';
    end if;
    seen_session_ids := pg_catalog.array_append(seen_session_ids, requested_session_id);

    if route_count = 0 then
      continue;
    end if;

    route_payload := session_payload -> 'studyRoute';
    route_identity := route_payload -> 'identity';
    if jsonb_typeof(route_payload) is distinct from 'object'
      or jsonb_typeof(route_identity) is distinct from 'object'
      or route_identity ->> 'lifecycleStatus' is distinct from 'committed' then
      raise exception using
        errcode = '22023',
        message = 'plan_route_invalid_committed_route';
    end if;

    begin
      routed_plan_id := (route_identity ->> 'planId')::uuid;
      routed_session_id := (route_identity ->> 'sessionId')::uuid;
      requested_route_revision_id := (route_identity ->> 'routeRevisionId')::uuid;
    exception when others then
      raise exception using
        errcode = '22023',
        message = 'plan_route_invalid_route_identity';
    end;

    if routed_plan_id is distinct from requested_plan_id
      or routed_session_id is distinct from requested_session_id then
      raise exception using
        errcode = '22023',
        message = 'plan_route_identity_mismatch';
    end if;

    if requested_route_revision_id = any(seen_route_revision_ids) then
      raise exception using
        errcode = '22023',
        message = 'plan_route_duplicate_revision_id';
    end if;
    seen_route_revision_ids := pg_catalog.array_append(
      seen_route_revision_ids,
      requested_route_revision_id
    );
  end loop;

  -- Do not inline or recreate this function here. Later lifecycle migrations
  -- hardened its deployed body in place, and this call preserves those fences.
  saved_plan_id := public.save_generated_plan(payload);

  if saved_plan_id is distinct from requested_plan_id then
    raise exception using
      errcode = '55000',
      message = 'plan_route_saved_plan_mismatch';
  end if;

  if route_count = 0 then
    return saved_plan_id;
  end if;

  for session_payload in
    select candidate.value
    from pg_catalog.jsonb_array_elements(payload -> 'sessions') as candidate(value)
    order by (candidate.value ->> 'sequence')::integer
  loop
    route_payload := session_payload -> 'studyRoute';
    route_identity := route_payload -> 'identity';
    requested_session_id := (session_payload ->> 'id')::uuid;
    requested_route_revision_id := (route_identity ->> 'routeRevisionId')::uuid;

    perform public.commit_study_route_revision(route_payload);

    select session.committed_route_revision_id
    into committed_route_revision_id
    from public.plan_sessions as session
    where session.id = requested_session_id
      and session.plan_id = requested_plan_id
      and session.user_id = current_user_id;

    if not found
      or committed_route_revision_id is distinct from requested_route_revision_id then
      raise exception using
        errcode = '55000',
        message = 'plan_route_pointer_mismatch';
    end if;
  end loop;

  return saved_plan_id;
end;
$$;

revoke all on function public.save_generated_plan_with_routes(jsonb)
from public, anon, authenticated;
grant execute on function public.save_generated_plan_with_routes(jsonb)
to authenticated;
