begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
select extensions.plan(3);

-- Brief 2.5 finding 16: a refused plan change or Undo must answer. Raised as
-- SQLSTATE 40001 it reads as a serialization failure, is retried in front of
-- the database, and the request never returns. PostgREST maps PT409 to 409.
select extensions.is(
  (select count(*) from pg_catalog.pg_proc as p
   join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.prosrc ~ 'errcode\s*=\s*''40001''\s*,\s*message\s*=\s*''plan_revision_'),
  0::bigint,
  'no writer reports a plan revision refusal as a serialization failure'
);

select extensions.ok(
  position('PT409' in pg_catalog.pg_get_functiondef('public.apply_plan_revision(uuid,jsonb)'::regprocedure)) > 0,
  'the plan revision writer raises its refusals as PT409'
);

select set_config('request.jwt.claims','{"role":"service_role"}',true);
select extensions.ok(
  (public.signed_in_generation_readiness_v6()->>'planRevisionRefusalsAnswer')::boolean,
  'readiness reports that refused plan changes answer instead of hanging'
);

select * from extensions.finish();
rollback;
