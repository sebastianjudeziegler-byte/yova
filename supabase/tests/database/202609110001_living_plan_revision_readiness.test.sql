-- Brief 2 precondition guard. Migration 202609090001 shipped the living-plan
-- revision RPCs with no readiness contract, was never applied to Production,
-- and `readiness:production` stayed green while every learner who opened
-- Adjust got a 503. These cases run against a database built by replaying
-- every migration, and assert both halves of the fix:
--   1. a fully migrated database reports the revision capability, and
--   2. a database missing the revision objects reports it FALSE.
-- Case 2 is the one that matters: a contract that cannot go red is not a
-- contract. See docs/audits/brief-2/EVIDENCE.md.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
select extensions.plan(9);

-- The probe is service-role only, like every other readiness RPC.
select set_config('request.jwt.claim.role','authenticated',true);
select extensions.throws_ok(
  'select public.signed_in_generation_readiness_v5()',
  '42501',
  'signed_in_generation_readiness_service_role_required',
  'the readiness probe refuses a non service-role caller');

select set_config('request.jwt.claim.role','service_role',true);

-- 1. A fully migrated database advertises the capability.
select extensions.is(
  public.signed_in_generation_readiness_v5()->>'contractVersion',
  '202609110001',
  'the probe reports the living-plan revision contract version');
select extensions.is(
  (public.signed_in_generation_readiness_v5()->>'livingPlanRevision')::boolean,
  true,
  'a fully migrated database reports living-plan revision support');

-- The contract must layer on v4 rather than replace it, so nothing the
-- earlier contract guarded is quietly dropped.
select extensions.is(
  (public.signed_in_generation_readiness_v5()->>'placementEvidenceBoundary')::boolean,
  (public.signed_in_generation_readiness_v4()->>'placementEvidenceBoundary')::boolean,
  'the v5 contract carries the v4 placement boundary through unchanged');

-- 2. Each missing object must independently flip the capability to false.
-- Every check runs inside its own savepoint and is rolled back.
savepoint drop_read_rpc;
drop function public.read_plan_revision_context(uuid);
select extensions.is(
  (public.signed_in_generation_readiness_v5()->>'livingPlanRevision')::boolean,
  false,
  'a database without read_plan_revision_context reports NOT ready');
select extensions.is(
  (public.signed_in_generation_readiness_v5()->>'ready')::boolean,
  false,
  'the overall contract fails closed when revision support is missing');
rollback to savepoint drop_read_rpc;

savepoint drop_apply_rpc;
drop function public.apply_plan_revision(uuid,jsonb);
select extensions.is(
  (public.signed_in_generation_readiness_v5()->>'livingPlanRevision')::boolean,
  false,
  'a database without apply_plan_revision reports NOT ready');
rollback to savepoint drop_apply_rpc;

savepoint drop_history_table;
drop table public.plan_revisions;
select extensions.is(
  (public.signed_in_generation_readiness_v5()->>'livingPlanRevision')::boolean,
  false,
  'a database without the plan_revisions history table reports NOT ready');
rollback to savepoint drop_history_table;

-- The browser reads its own revision history and never writes one. A database
-- that hands the learner a write path is not ready either.
savepoint grant_learner_write;
grant insert on public.plan_revisions to authenticated;
select extensions.is(
  (public.signed_in_generation_readiness_v5()->>'livingPlanRevision')::boolean,
  false,
  'a database that lets the learner write revision history reports NOT ready');
rollback to savepoint grant_learner_write;

select * from extensions.finish();
rollback;
