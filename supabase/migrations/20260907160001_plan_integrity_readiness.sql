-- Older clients keep the v3 probe. This release must not report ready against
-- a database that still accepts client placement or invents a completion rating.
create or replace function public.signed_in_generation_readiness_v4()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  base_readiness jsonb;
  placement_ready boolean;
  unanswered_ready boolean;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode='42501', message='signed_in_generation_readiness_service_role_required';
  end if;
  base_readiness := public.signed_in_generation_readiness_v3();
  placement_ready :=
    pg_catalog.to_regprocedure('public.save_server_scored_plan_diagnostic_v1(uuid,uuid,jsonb,jsonb)') is not null
    and pg_catalog.to_regprocedure('public.claim_placement_scoring_v1(uuid,text,text,timestamptz)') is not null
    and pg_catalog.to_regclass('private.placement_scoring_receipts') is not null
    and not pg_catalog.has_any_column_privilege('authenticated','public.plans','update')
    and not pg_catalog.has_function_privilege('authenticated','public.update_plan_diagnostic_knowledge_map_v1(uuid,jsonb)','execute')
    and not pg_catalog.has_function_privilege('authenticated','public.save_server_scored_plan_diagnostic_v1(uuid,uuid,jsonb,jsonb)','execute')
    and not pg_catalog.has_function_privilege('authenticated','public.claim_placement_scoring_v1(uuid,text,text,timestamptz)','execute')
    and position('plan_revision_cannot_change_evidence' in pg_catalog.pg_get_functiondef('public.adjust_learning_plan_with_routes(jsonb)'::regprocedure)) > 0;
  unanswered_ready := position(
    'jsonb_typeof(payload -> ''completionFeedback'') not in (''string'', ''null'')'
    in pg_catalog.pg_get_functiondef('public.save_active_session_checkpoint(jsonb)'::regprocedure)
  ) > 0;
  return base_readiness || jsonb_build_object(
    'contractVersion','20260907160001',
    'ready',coalesce((base_readiness ->> 'ready')::boolean,false) and placement_ready and unanswered_ready,
    'placementEvidenceBoundary',placement_ready,
    'unansweredCompletionFeedback',unanswered_ready
  );
end;
$$;
revoke all on function public.signed_in_generation_readiness_v4() from public, anon, authenticated, service_role;
grant execute on function public.signed_in_generation_readiness_v4() to service_role;

-- The public-launch quota probe must recognize that the temporary client
-- placement exception has been replaced by server scoring. Preserve every
-- other quota and permission check in the installed probe.
do $migration$
declare
  definition text := pg_catalog.pg_get_functiondef('public.public_launch_abuse_readiness_v1()'::regprocedure);
  old_rpc text := $old$    and coalesce(pg_catalog.has_function_privilege(
      'authenticated',
      'public.update_plan_diagnostic_knowledge_map_v1(uuid,jsonb)',
      'execute'
    ), false)$old$;
  old_column text := $old$    and coalesce(pg_catalog.has_column_privilege(
      'authenticated', 'public.plans', 'knowledge_map', 'update'
    ), false)$old$;
begin
  if position(old_rpc in definition)=0 or position(old_column in definition)=0 then
    raise exception 'placement readiness compatibility patch did not match';
  end if;
  definition := replace(definition,old_rpc,$new$    and not coalesce(pg_catalog.has_function_privilege(
      'authenticated', 'public.update_plan_diagnostic_knowledge_map_v1(uuid,jsonb)', 'execute'
    ),false)
    and coalesce(pg_catalog.has_function_privilege(
      'service_role', 'public.save_server_scored_plan_diagnostic_v1(uuid,uuid,jsonb,jsonb)', 'execute'
    ),false)
    and not coalesce(pg_catalog.has_function_privilege(
      'authenticated', 'public.save_server_scored_plan_diagnostic_v1(uuid,uuid,jsonb,jsonb)', 'execute'
    ),false)$new$);
  execute replace(definition,old_column,$new$    and not coalesce(pg_catalog.has_any_column_privilege(
      'authenticated', 'public.plans', 'update'
    ), false)$new$);
end;
$migration$;
