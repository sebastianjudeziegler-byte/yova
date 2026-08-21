import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/202608210001_protect_plan_adjustments_and_reconcile_lifecycle.sql",
  "utf8",
).toLowerCase();

describe("protected plan adjustment and lifecycle migration", () => {
  it("matches every protected payload row to an authoritative stored review", () => {
    expect(migration).toContain("every scheduled review must be preserved by the adjustment");
    expect(migration).toContain("a protected review did not match the stored plan");
    expect(migration).toContain("step_data ->> 'reviewtype' in ('repair_and_retrieve', 'verify', 'maintenance_transfer')");
    expect(migration).toContain("protected_count <> stored_protected_count");
  });

  it("keeps protected rows intact instead of deleting and reconstructing their narrow metadata", () => {
    expect(migration).toContain("set sequence = session.sequence + 1000");
    expect(migration).toContain("and not (\n      jsonb_typeof(session.step_data) = 'object'");
    expect(migration).toContain("if coalesce((replacement ->> 'protected')::boolean, false) then");
    expect(migration).toContain("set sequence = (replacement ->> 'sequence')::smallint");
    expect(migration).not.toContain("'reviewtype', replacement ->> 'reviewtype'");
  });

  it("validates every rebuilt content duration at the database boundary", () => {
    expect(migration).toContain("candidate.value -> 'estimatedminutes'");
    expect(migration).toContain(
      "(candidate.value ->> 'estimatedminutes')::integer not between 10 and 90",
    );
  });

  it("returns authoritative stored session metadata instead of echoing the request", () => {
    expect(migration).toContain("authoritative_sessions jsonb");
    expect(migration).toContain("'scheduledfor', session.scheduled_for");
    expect(migration).toContain("'sessions', authoritative_sessions");
    expect(migration).not.toContain("'sessions', payload -> 'sessions'");
  });

  it("refuses to rewrite saved learner work even when the RPC is called directly", () => {
    expect(migration).toContain("plan_adjustment_saved_work_protected");
    expect(migration).toContain("session.step_data ? 'generatedsession'");
    expect(migration).toContain("session.step_data ? 'activesessioncheckpoint'");
    expect(migration).toContain("event.event_type = 'session_interrupted'");
    expect(migration).toContain("event.plan_session_id = session.id");
  });

  it("locks every unfinished session before checking saved work or deleting rows", () => {
    const adjustmentFunction = migration.slice(
      migration.indexOf("create or replace function public.adjust_learning_plan(payload jsonb)"),
      migration.indexOf("revoke all on function public.adjust_learning_plan(jsonb)"),
    );
    const planLock = adjustmentFunction.indexOf(
      "where id = (payload ->> 'planid')::uuid and user_id = current_user_id\n  for update",
    );
    const sessionLock = adjustmentFunction.indexOf(
      "perform session.id\n  from public.plan_sessions as session",
    );
    const savedWorkCheck = adjustmentFunction.indexOf(
      "raise exception 'plan_adjustment_saved_work_protected'",
    );
    const rewriteDelete = adjustmentFunction.indexOf(
      "delete from public.plan_sessions as session",
    );

    expect(planLock).toBeGreaterThanOrEqual(0);
    expect(sessionLock).toBeGreaterThan(planLock);
    expect(adjustmentFunction.slice(sessionLock, savedWorkCheck)).toContain("for update");
    expect(savedWorkCheck).toBeGreaterThan(sessionLock);
    expect(rewriteDelete).toBeGreaterThan(savedWorkCheck);
  });

  it("keeps the legacy duration RPC inside the same protected-session boundary", () => {
    expect(migration).toContain(
      "create or replace function public.adjust_plan_session_duration(payload jsonb)",
    );
    expect(migration).toContain("if next_minutes < 10 or next_minutes > 90");
    expect(migration).toContain("requested_session.step_data ? 'generatedsession'");
    expect(migration).toContain("requested_session.step_data ? 'activesessioncheckpoint'");
    expect(migration).toContain("plan_session_rewrite_protected");
    expect(migration).toContain(
      "revoke all on function public.adjust_plan_session_duration(jsonb) from public, anon",
    );
  });

  it("repairs completed plans with runnable work and prevents the contradiction returning", () => {
    expect(migration).toContain("legacylifecyclerecoveredat");
    expect(migration).toContain("plan.status = 'completed'");
    expect(migration).toContain("session.status in ('ready', 'upcoming')");
    expect(migration).toContain("session.estimated_minutes < 10");
    expect(migration).toContain("session.step_data ->> 'segmentcount')::integer > 1");
    const undersizedRepair = migration.slice(
      migration.indexOf("update public.plan_sessions as session\nset\n  estimated_minutes = 10"),
      migration.indexOf("create or replace function public.guard_completed_plan_lifecycle()"),
    );
    expect(undersizedRepair).toContain("plan.status = 'active'");
    expect(undersizedRepair).not.toContain("plan.generation_inputs ? 'legacylifecyclerecoveredat'");
    expect(undersizedRepair).toContain("not (session.step_data ? 'generatedsession')");
    expect(undersizedRepair).toContain("not (session.step_data ? 'activesessioncheckpoint')");
    expect(undersizedRepair).toContain("event.event_type = 'session_interrupted'");
    expect(migration).toContain("then 'one focused target + evidence check · about 10 min'");
    expect(migration).toContain("session.step_data ->> 'reviewtype' in ('repair_and_retrieve', 'verify', 'maintenance_transfer')");
    expect(migration).toContain("completed_plan_has_unfinished_sessions");
    expect(migration).toContain("before insert or update of status on public.plans");
    expect(migration).toContain("after insert on public.plan_sessions");
    expect(migration).toContain("set status = 'active'");
    const reopenFunction = migration.slice(
      migration.indexOf("create or replace function public.reopen_completed_plan_for_new_work()"),
      migration.indexOf("drop trigger if exists plan_sessions_reopen_completed_parent"),
    );
    expect(reopenFunction).toContain("from public.plans as plan");
    expect(reopenFunction).toContain("for update");
    expect(reopenFunction.indexOf("for update")).toBeLessThan(
      reopenFunction.indexOf("update public.plans"),
    );
  });

  it("keeps adjustment and lifecycle helpers unavailable to anonymous callers", () => {
    expect(migration).toContain(
      "revoke all on function public.adjust_learning_plan(jsonb) from public, anon",
    );
    expect(migration).toContain(
      "grant execute on function public.adjust_learning_plan(jsonb) to authenticated",
    );
    expect(migration).toContain(
      "revoke all on function public.guard_completed_plan_lifecycle()\nfrom public, anon, authenticated",
    );
    expect(migration).toContain(
      "revoke all on function public.reopen_completed_plan_for_new_work()\nfrom public, anon, authenticated",
    );
  });
});
