begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select extensions.plan(5);

select extensions.is(
  (
    select pg_catalog.count(*)
    from supabase_migrations.schema_migrations as migration
    where migration.version = '202609040003'
  ),
  1::bigint,
  'the AI usage ledger ACL migration committed'
);

select extensions.ok(
  not pg_catalog.has_table_privilege('anon', 'public.ai_usage_windows', 'select')
  and not pg_catalog.has_table_privilege('anon', 'public.ai_usage_windows', 'insert')
  and not pg_catalog.has_table_privilege('anon', 'public.ai_usage_windows', 'update')
  and not pg_catalog.has_table_privilege('anon', 'public.ai_usage_windows', 'delete')
  and not pg_catalog.has_table_privilege('authenticated', 'public.ai_usage_windows', 'select')
  and not pg_catalog.has_table_privilege('authenticated', 'public.ai_usage_windows', 'insert')
  and not pg_catalog.has_table_privilege('authenticated', 'public.ai_usage_windows', 'update')
  and not pg_catalog.has_table_privilege('authenticated', 'public.ai_usage_windows', 'delete')
  and pg_catalog.has_table_privilege('service_role', 'public.ai_usage_windows', 'select')
  and not pg_catalog.has_table_privilege('service_role', 'public.ai_usage_windows', 'insert')
  and not pg_catalog.has_table_privilege('service_role', 'public.ai_usage_windows', 'update')
  and not pg_catalog.has_table_privilege('service_role', 'public.ai_usage_windows', 'delete'),
  'usage windows expose only the trusted lifecycle-audit read'
);

select extensions.ok(
  not pg_catalog.has_table_privilege('anon', 'public.ai_usage_claims', 'select')
  and not pg_catalog.has_table_privilege('anon', 'public.ai_usage_claims', 'insert')
  and not pg_catalog.has_table_privilege('anon', 'public.ai_usage_claims', 'update')
  and not pg_catalog.has_table_privilege('anon', 'public.ai_usage_claims', 'delete')
  and not pg_catalog.has_table_privilege('authenticated', 'public.ai_usage_claims', 'select')
  and not pg_catalog.has_table_privilege('authenticated', 'public.ai_usage_claims', 'insert')
  and not pg_catalog.has_table_privilege('authenticated', 'public.ai_usage_claims', 'update')
  and not pg_catalog.has_table_privilege('authenticated', 'public.ai_usage_claims', 'delete')
  and not pg_catalog.has_table_privilege('service_role', 'public.ai_usage_claims', 'select')
  and not pg_catalog.has_table_privilege('service_role', 'public.ai_usage_claims', 'insert')
  and not pg_catalog.has_table_privilege('service_role', 'public.ai_usage_claims', 'update')
  and not pg_catalog.has_table_privilege('service_role', 'public.ai_usage_claims', 'delete'),
  'reservation claims remain accessible only inside security-definer functions'
);

select extensions.is(
  (
    select pg_catalog.count(*)
    from pg_catalog.pg_proc as routine
    where routine.oid in (
      pg_catalog.to_regprocedure('public.read_ai_usage_status(text,integer,integer)'),
      pg_catalog.to_regprocedure('public.reserve_ai_request(text,integer,integer,uuid,uuid,integer)'),
      pg_catalog.to_regprocedure('public.consume_ai_request_claim(uuid)'),
      pg_catalog.to_regprocedure('public.release_ai_request_claim(uuid)'),
      pg_catalog.to_regprocedure('public.release_ai_request_reservation(text,uuid,uuid)'),
      pg_catalog.to_regprocedure('public.reserve_ai_request_for_user(uuid,text,uuid,uuid,boolean)'),
      pg_catalog.to_regprocedure('public.consume_ai_request_claim_for_user(uuid,uuid)'),
      pg_catalog.to_regprocedure('public.release_ai_request_claim_for_user(uuid,uuid)'),
      pg_catalog.to_regprocedure('public.release_ai_request_reservation_for_user(uuid,text,uuid,uuid)')
    )
      and routine.prosecdef
  ),
  9::bigint,
  'all supported usage and reservation callers retain their security-definer boundary'
);

do $block$
begin
  perform pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
end;
$block$;

select extensions.ok(
  (public.public_launch_abuse_readiness_v1() ->> 'ready')::boolean
  and (public.public_launch_abuse_readiness_v1() ->> 'untrustedInsertQuotas')::boolean,
  'the corrected ledger ACL satisfies the launch-abuse readiness gate'
);

select * from extensions.finish();
rollback;
