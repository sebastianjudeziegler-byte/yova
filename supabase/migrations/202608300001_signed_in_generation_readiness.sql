-- Give deployment tooling one read-only, service-only capability probe for the
-- database boundary required by signed-in plan and session generation. The
-- probe never creates learner data and does not rely on PostgREST exposing
-- private catalog tables.

create or replace function public.signed_in_generation_readiness_v1()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  study_routes_schema_ready boolean;
  plan_sessions_pointer_ready boolean;
  route_rpc_ready boolean;
  result_ready boolean;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using
      errcode = '42501',
      message = 'signed_in_generation_readiness_service_role_required';
  end if;

  study_routes_schema_ready :=
    pg_catalog.to_regclass('public.study_routes') is not null
    and coalesce(
      pg_catalog.has_table_privilege(
        'authenticated',
        pg_catalog.to_regclass('public.study_routes'),
        'select'
      ),
      false
    )
    and not exists (
      select 1
      from pg_catalog.unnest(array[
        'route_revision_id',
        'route_lineage_id',
        'revision_number',
        'schema_version',
        'lifecycle',
        'user_id',
        'plan_id',
        'plan_session_id',
        'predecessor_revision_id',
        'route_payload',
        'route_fingerprint',
        'created_at',
        'committed_at'
      ]::text[]) as required_column(column_name)
      where not exists (
        select 1
        from pg_catalog.pg_attribute as attribute
        where attribute.attrelid = pg_catalog.to_regclass('public.study_routes')
          and attribute.attname = required_column.column_name
          and attribute.attnum > 0
          and not attribute.attisdropped
      )
    );

  plan_sessions_pointer_ready := exists (
    select 1
    from pg_catalog.pg_attribute as attribute
    where attribute.attrelid = pg_catalog.to_regclass('public.plan_sessions')
      and attribute.attname = 'committed_route_revision_id'
      and attribute.attnum > 0
      and not attribute.attisdropped
  );

  route_rpc_ready :=
    pg_catalog.to_regprocedure(
      'public.commit_study_route_revision(jsonb)'
    ) is not null
    and pg_catalog.to_regprocedure(
      'public.mint_plan_activation_permit_v1(jsonb,uuid,timestamptz)'
    ) is not null
    and pg_catalog.to_regprocedure(
      'public.save_generated_plan_with_routes(jsonb,uuid)'
    ) is not null
    and pg_catalog.to_regprocedure(
      'public.save_generated_plan_with_routes(jsonb)'
    ) is null
    and pg_catalog.to_regprocedure(
      'public.cache_generated_session(jsonb)'
    ) is not null
    and coalesce(
      pg_catalog.has_function_privilege(
        'service_role',
        pg_catalog.to_regprocedure(
          'public.mint_plan_activation_permit_v1(jsonb,uuid,timestamptz)'
        ),
        'execute'
      ),
      false
    )
    and coalesce(
      pg_catalog.has_function_privilege(
        'authenticated',
        pg_catalog.to_regprocedure(
          'public.save_generated_plan_with_routes(jsonb,uuid)'
        ),
        'execute'
      ),
      false
    )
    and coalesce(
      pg_catalog.has_function_privilege(
        'authenticated',
        pg_catalog.to_regprocedure(
          'public.cache_generated_session(jsonb)'
        ),
        'execute'
      ),
      false
    );

  result_ready := study_routes_schema_ready
    and plan_sessions_pointer_ready
    and route_rpc_ready;

  return pg_catalog.jsonb_build_object(
    'contractVersion', '202608300001',
    'ready', result_ready,
    'studyRoutesSchema', study_routes_schema_ready,
    'planSessionsRoutePointer', plan_sessions_pointer_ready,
    'requiredRouteRpcs', route_rpc_ready
  );
end;
$$;

revoke all on function public.signed_in_generation_readiness_v1()
from public, anon, authenticated, service_role;
grant execute on function public.signed_in_generation_readiness_v1()
to service_role;

comment on function public.signed_in_generation_readiness_v1() is
  'Read-only release gate for the StudyRoute database contract used by signed-in generation.';

notify pgrst, 'reload schema';
