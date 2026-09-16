-- Brief 2 precondition guard. Migration 202609090001 shipped the living-plan
-- revision RPCs with no readiness contract, was never applied to Production,
-- and `readiness:production` stayed green while every learner who opened
-- Adjust got a 503. These cases run against a database built by replaying
-- every migration, and assert both halves of the fix:
--   1. a fully migrated database reports the revision capability, and
--   2. a database missing the revision objects reports it FALSE.
-- Case 2 is the one that matters: a contract that cannot go red is not a
-- contract. See docs/audits/brief-2/EVIDENCE.md.
--
-- pgTAP records each assertion inside the test transaction, so ROLLBACK TO
-- SAVEPOINT also erases the assertions made after that savepoint. The first
-- version of this suite undid each absence case that way: the cases ran, their
-- results were rolled back, and pg_prove reported "planned 9 tests but ran 4"
-- as ok. Each absence case now makes its change inside a PL/pgSQL exception
-- block, which undoes the change without touching pgTAP's record.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
select extensions.plan(10);

-- Applies one change, reads the contract, then raises to undo the change.
-- Local variables survive the exception block's rollback; the change does not.
create function pg_temp.readiness_without(change text) returns jsonb language plpgsql as $$
declare
  observed jsonb;
begin
  begin
    execute change;
    observed := public.signed_in_generation_readiness_v5();
    raise exception using errcode = 'U0001', message = 'undo_readiness_change';
  exception when sqlstate 'U0001' then
    null;
  end;
  return observed;
end $$;

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
select extensions.is(
  (pg_temp.readiness_without('drop function public.read_plan_revision_context(uuid)')->>'livingPlanRevision')::boolean,
  false,
  'a database without read_plan_revision_context reports NOT ready');
select extensions.is(
  (pg_temp.readiness_without('drop function public.read_plan_revision_context(uuid)')->>'ready')::boolean,
  false,
  'the overall contract fails closed when revision support is missing');
select extensions.is(
  (pg_temp.readiness_without('drop function public.apply_plan_revision(uuid,jsonb)')->>'livingPlanRevision')::boolean,
  false,
  'a database without apply_plan_revision reports NOT ready');
select extensions.is(
  (pg_temp.readiness_without('drop table public.plan_revisions')->>'livingPlanRevision')::boolean,
  false,
  'a database without the plan_revisions history table reports NOT ready');

-- The browser reads its own revision history and never writes one. A database
-- that hands the learner a write path is not ready either.
select extensions.is(
  (pg_temp.readiness_without('grant insert on public.plan_revisions to authenticated')->>'livingPlanRevision')::boolean,
  false,
  'a database that lets the learner write revision history reports NOT ready');

-- Every absence case above was undone, so later suites see the real database.
select extensions.is(
  (public.signed_in_generation_readiness_v5()->>'livingPlanRevision')::boolean,
  true,
  'each absence check is undone and the migrated database still reports revision support');

select * from extensions.finish();
rollback;
