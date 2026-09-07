-- Browsers can submit answers to YOVA's server, but cannot assert topic evidence.
-- Keep the mature bounded writer private and expose an exact-map, server-only
-- entry point. The original ownership and write-quota checks still run.
revoke all on function public.update_plan_diagnostic_knowledge_map_v1(uuid, jsonb)
from public, anon, authenticated, service_role;

-- Retire the temporary direct-column compatibility path as well as the old
-- RPC. All legitimate map changes now use bounded SECURITY DEFINER writers.
revoke update (knowledge_map) on table public.plans from public, anon, authenticated;
drop policy if exists "plans_owner_knowledge_map_update" on public.plans;

create or replace function public.save_server_scored_plan_diagnostic_v1(
  requested_plan_id uuid,
  requested_user_id uuid,
  expected_knowledge_map jsonb,
  requested_knowledge_map jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  stored_map jsonb;
  previous_sub text := pg_catalog.current_setting('request.jwt.claim.sub', true);
  previous_role text := pg_catalog.current_setting('request.jwt.claim.role', true);
  saved boolean;
begin
  if auth.role() is distinct from 'service_role' or requested_user_id is null then
    raise exception using errcode = '42501', message = 'server_scored_placement_required';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('yova_learning_data'), pg_catalog.hashtext(requested_user_id::text)
  );
  select plan.knowledge_map into stored_map from public.plans as plan
  where plan.id = requested_plan_id and plan.user_id = requested_user_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'plan_diagnostic_plan_not_found';
  end if;
  if stored_map is distinct from expected_knowledge_map then
    raise exception using errcode = '40001', message = 'plan_diagnostic_map_changed';
  end if;
  if (requested_knowledge_map - 'topics' - 'placementCheck')
      is distinct from (stored_map - 'topics' - 'placementCheck')
    or pg_catalog.jsonb_typeof(requested_knowledge_map -> 'topics') is distinct from 'array'
    or (select pg_catalog.jsonb_agg(topic.value - 'status' - 'initialEvidence' order by topic.ordinality)
      from pg_catalog.jsonb_array_elements(requested_knowledge_map -> 'topics') with ordinality as topic(value, ordinality))
      is distinct from (select pg_catalog.jsonb_agg(topic.value - 'status' - 'initialEvidence' order by topic.ordinality)
      from pg_catalog.jsonb_array_elements(stored_map -> 'topics') with ordinality as topic(value, ordinality)) then
    raise exception using errcode = '22023', message = 'placement_cannot_change_topic_scope';
  end if;
  perform pg_catalog.set_config('request.jwt.claim.sub', requested_user_id::text, true);
  perform pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
  saved := public.update_plan_diagnostic_knowledge_map_v1(requested_plan_id, requested_knowledge_map);
  perform pg_catalog.set_config('request.jwt.claim.sub', coalesce(previous_sub, ''), true);
  perform pg_catalog.set_config('request.jwt.claim.role', coalesce(previous_role, ''), true);
  return saved;
end;
$$;

revoke all on function public.save_server_scored_plan_diagnostic_v1(uuid, uuid, jsonb, jsonb)
from public, anon, authenticated, service_role;
grant execute on function public.save_server_scored_plan_diagnostic_v1(uuid, uuid, jsonb, jsonb)
to service_role;
