-- Migration 202609090001 shipped the living-plan revision RPCs without giving
-- them a readiness contract. `readiness:production` therefore stayed green
-- against a production database that had never received it, and every learner
-- who opened Adjust got a 503 from read_plan_revision_context. A capability
-- the application calls must be one the release probe can see.
--
-- Existence is resolved BEFORE any privilege lookup. PostgreSQL does not
-- promise to short-circuit an `and` chain, and has_table_privilege /
-- has_function_privilege raise when their object is absent — exactly the case
-- this probe exists to report. A readiness probe must return false, never
-- throw.
create or replace function public.signed_in_generation_readiness_v5()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  base_readiness jsonb;
  objects_present boolean;
  boundary_ready boolean := false;
  revision_ready boolean;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode='42501', message='signed_in_generation_readiness_service_role_required';
  end if;
  base_readiness := public.signed_in_generation_readiness_v4();

  objects_present :=
    pg_catalog.to_regprocedure('public.read_plan_revision_context(uuid)') is not null
    and pg_catalog.to_regprocedure('public.apply_plan_revision(uuid,jsonb)') is not null
    and pg_catalog.to_regclass('public.plan_revisions') is not null
    and exists(
      select 1 from pg_catalog.pg_attribute
      where attrelid = 'public.plans'::regclass
        and attname = 'current_revision_id'
        and not attisdropped
    )
    and exists(
      select 1 from pg_catalog.pg_trigger
      where tgrelid = 'public.plans'::regclass
        and tgname = 'plans_initial_revision'
        and not tgisinternal
    );

  -- The browser reads its own revision history and never writes one, and the
  -- signing server alone applies a revision.
  if objects_present then
    boundary_ready :=
      pg_catalog.has_table_privilege('authenticated','public.plan_revisions','select')
      and not pg_catalog.has_table_privilege('authenticated','public.plan_revisions','insert')
      and not pg_catalog.has_table_privilege('authenticated','public.plan_revisions','update')
      and not pg_catalog.has_table_privilege('authenticated','public.plan_revisions','delete')
      and not pg_catalog.has_function_privilege('authenticated','public.apply_plan_revision(uuid,jsonb)','execute')
      and not pg_catalog.has_function_privilege('anon','public.read_plan_revision_context(uuid)','execute');
  end if;

  revision_ready := objects_present and boundary_ready;

  return base_readiness || jsonb_build_object(
    'contractVersion','202609110001',
    'ready',coalesce((base_readiness ->> 'ready')::boolean,false) and revision_ready,
    'livingPlanRevision',revision_ready
  );
end;
$$;
revoke all on function public.signed_in_generation_readiness_v5() from public, anon, authenticated, service_role;
grant execute on function public.signed_in_generation_readiness_v5() to service_role;
