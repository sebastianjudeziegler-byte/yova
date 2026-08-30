begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select extensions.plan(5);

select extensions.is(
  (
    select pg_catalog.count(*)
    from supabase_migrations.schema_migrations as migration
    where migration.version = '202608300001'
  ),
  1::bigint,
  'the signed-in generation readiness migration committed'
);

select extensions.ok(
  pg_catalog.has_function_privilege(
    'service_role',
    'public.signed_in_generation_readiness_v1()',
    'execute'
  )
  and not pg_catalog.has_function_privilege(
    'authenticated',
    'public.signed_in_generation_readiness_v1()',
    'execute'
  )
  and not pg_catalog.has_function_privilege(
    'anon',
    'public.signed_in_generation_readiness_v1()',
    'execute'
  ),
  'the read-only readiness probe is service-role-only'
);

select extensions.ok(
  (
    select routine.prosecdef and routine.provolatile = 's'
    from pg_catalog.pg_proc as routine
    where routine.oid = pg_catalog.to_regprocedure(
      'public.signed_in_generation_readiness_v1()'
    )
  ),
  'the readiness probe is stable and security-definer'
);

do $block$
begin
  perform pg_catalog.set_config(
    'request.jwt.claim.role',
    'service_role',
    true
  );
end;
$block$;

select extensions.is(
  public.signed_in_generation_readiness_v1(),
  pg_catalog.jsonb_build_object(
    'contractVersion', '202608300001',
    'ready', true,
    'studyRoutesSchema', true,
    'planSessionsRoutePointer', true,
    'requiredRouteRpcs', true
  ),
  'the fully migrated database certifies the exact signed-in generation contract'
);

do $block$
begin
  perform pg_catalog.set_config(
    'request.jwt.claim.role',
    'authenticated',
    true
  );
end;
$block$;

select extensions.throws_ok(
  'select public.signed_in_generation_readiness_v1()',
  '42501',
  'signed_in_generation_readiness_service_role_required',
  'an authenticated learner cannot invoke the deployment probe'
);

select * from extensions.finish();
rollback;
