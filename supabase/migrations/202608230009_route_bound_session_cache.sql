-- Bind every generated-session cache write to the exact StudyRoute revision
-- that was read before generation. This closes the race where a successor
-- route could commit while an older model request was still in flight.

create or replace function public.cache_generated_session(payload jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  requested_session_id uuid;
  requested_plan_id uuid;
  requested_learning_item_id uuid;
  requested_route_revision_id uuid;
  stored_route_revision_id uuid;
  stored_knowledge_map jsonb;
  stored_source_mode text;
  stored_plan_updated_at timestamptz;
  stored_session_updated_at timestamptz;
  stored_learning_item_updated_at timestamptz;
  stored_generated_session jsonb;
  requested_generated_session jsonb := payload -> 'generatedSession';
  generated_route_revision_id uuid;
  generated_context_route_revision_id uuid;
  has_expected_context boolean := payload ? 'expectedKnowledgeMap';
begin
  if current_user_id is null then
    raise exception using
      errcode = '28000',
      message = 'session_cache_authentication_required';
  end if;

  begin
    requested_session_id := (payload ->> 'planSessionId')::uuid;
    requested_route_revision_id := nullif(
      payload ->> 'expectedRouteRevisionId',
      ''
    )::uuid;
    generated_route_revision_id := nullif(
      requested_generated_session ->> 'routeRevisionId',
      ''
    )::uuid;
    generated_context_route_revision_id := nullif(
      requested_generated_session #>> '{cacheContext,routeRevisionId}',
      ''
    )::uuid;
  exception when others then
    raise exception using
      errcode = '22023',
      message = 'session_cache_invalid_route_binding';
  end;

  if requested_session_id is null
    or not (payload ? 'expectedRouteRevisionId')
    or pg_catalog.jsonb_typeof(requested_generated_session) is distinct from 'object' then
    raise exception using
      errcode = '40001',
      message = 'session_generation_context_changed';
  end if;

  if has_expected_context <> (payload ? 'expectedSourceMode')
    or has_expected_context <> (payload ? 'expectedPlanUpdatedAt')
    or has_expected_context <> (payload ? 'expectedSessionUpdatedAt')
    or has_expected_context <> (payload ? 'expectedLearningItemUpdatedAt') then
    raise exception using
      errcode = '40001',
      message = 'session_generation_context_changed';
  end if;

  -- Keep lock order aligned with material attachment and route commits:
  -- account advisory lock, plan, learning item, then session.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('yova_learning_data'),
    pg_catalog.hashtext(current_user_id::text)
  );

  select session.plan_id into requested_plan_id
  from public.plan_sessions as session
  where session.id = requested_session_id
    and session.user_id = current_user_id;
  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'session_cache_session_not_found';
  end if;

  select plan.knowledge_map, plan.updated_at, plan.learning_item_id
  into stored_knowledge_map, stored_plan_updated_at, requested_learning_item_id
  from public.plans as plan
  where plan.id = requested_plan_id
    and plan.user_id = current_user_id
  for share;
  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'session_cache_session_not_found';
  end if;

  select item.source_mode, item.updated_at
  into stored_source_mode, stored_learning_item_updated_at
  from public.learning_items as item
  where item.id = requested_learning_item_id
    and item.user_id = current_user_id
  for share;
  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'session_cache_session_not_found';
  end if;

  select
    session.updated_at,
    session.step_data -> 'generatedSession',
    session.committed_route_revision_id
  into
    stored_session_updated_at,
    stored_generated_session,
    stored_route_revision_id
  from public.plan_sessions as session
  where session.id = requested_session_id
    and session.plan_id = requested_plan_id
    and session.user_id = current_user_id
  for update;
  if not found then
    raise exception using
      errcode = '40001',
      message = 'session_generation_context_changed';
  end if;

  if stored_route_revision_id is distinct from requested_route_revision_id
    or generated_route_revision_id is distinct from stored_route_revision_id
    or generated_context_route_revision_id is distinct from stored_route_revision_id then
    raise exception using
      errcode = '40001',
      message = 'session_generation_context_changed';
  end if;

  -- A lost RPC response may retry the exact route-bound cache payload after
  -- updated_at advanced. Route parity is checked first; only then is the
  -- identical write accepted as idempotent.
  if pg_catalog.jsonb_typeof(stored_generated_session) = 'object'
    and stored_generated_session is not distinct from requested_generated_session then
    return;
  end if;

  if stored_source_mode = 'user_materials' and not has_expected_context then
    raise exception using
      errcode = '40001',
      message = 'session_generation_context_changed';
  end if;
  if has_expected_context and (
    stored_knowledge_map is distinct from payload -> 'expectedKnowledgeMap'
    or stored_source_mode is distinct from payload ->> 'expectedSourceMode'
    or stored_plan_updated_at is distinct from (payload ->> 'expectedPlanUpdatedAt')::timestamptz
    or stored_session_updated_at is distinct from (payload ->> 'expectedSessionUpdatedAt')::timestamptz
    or stored_learning_item_updated_at is distinct from (payload ->> 'expectedLearningItemUpdatedAt')::timestamptz
  ) then
    raise exception using
      errcode = '40001',
      message = 'session_generation_context_changed';
  end if;

  update public.plan_sessions
  set step_data = coalesce(step_data, '{}'::jsonb)
    || pg_catalog.jsonb_build_object(
      'generatedSession',
      requested_generated_session
    )
  where id = requested_session_id
    and plan_id = requested_plan_id
    and user_id = current_user_id
    and updated_at = stored_session_updated_at
    and committed_route_revision_id is not distinct from stored_route_revision_id;

  if not found then
    raise exception using
      errcode = '40001',
      message = 'session_generation_context_changed';
  end if;
end;
$$;

revoke all on function public.cache_generated_session(jsonb)
from public, anon, authenticated;
grant execute on function public.cache_generated_session(jsonb)
to authenticated;

comment on function public.cache_generated_session(jsonb) is
  'Caches a generated session only when its request and both cache receipts match the currently committed StudyRoute revision.';
