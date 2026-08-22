import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/202608210005_transactional_plan_session_scheduling.sql",
  ),
  "utf8",
);

const batchFunction = migration.slice(
  migration.indexOf("create or replace function public.reschedule_plan_sessions(payload jsonb)"),
  migration.indexOf("revoke all on function public.reschedule_plan_sessions(jsonb)"),
);
const legacyWrapper = migration.slice(
  migration.indexOf("create or replace function public.reschedule_plan_session(payload jsonb)"),
  migration.indexOf("revoke all on function public.reschedule_plan_session(jsonb)"),
);

describe("transactional plan-session scheduling migration", () => {
  it("uses one authenticated definer transaction for bounded batch requests", () => {
    expect(batchFunction).toContain("security definer\nset search_path = ''");
    expect(batchFunction).toContain("current_user_id uuid := auth.uid()");
    expect(batchFunction).toContain("update_count < 1 or update_count > 28");
    expect(batchFunction).toContain("operation_kind not in ('manual', 'advance_now')");
    expect(batchFunction).toContain(
      "jsonb_typeof(candidate.value -> 'scheduledFor') is distinct from 'string'",
    );
    expect(batchFunction).toContain(
      "count(distinct (candidate.value ->> 'planSessionId')::uuid)",
    );
    expect(batchFunction).toContain("schedule_duplicate_session");
    expect(batchFunction).toContain("schedule_time_in_past");
    expect(batchFunction).toContain("schedule_time_out_of_range");
  });

  it("locks the active plan and complete unfinished set before validation or writes", () => {
    const userLock = batchFunction.indexOf("pg_catalog.pg_advisory_xact_lock(");
    const planLock = batchFunction.indexOf("from public.plans as plan");
    const activeCheck = batchFunction.indexOf("requested_plan.status <> 'active'");
    const sessionLock = batchFunction.indexOf("perform session.id");
    const ownershipCheck = batchFunction.indexOf("schedule_session_unavailable");
    const firstWrite = batchFunction.indexOf("insert into public.learning_events");

    expect(userLock).toBeGreaterThan(-1);
    expect(userLock).toBeLessThan(planLock);
    expect(planLock).toBeLessThan(activeCheck);
    expect(activeCheck).toBeLessThan(sessionLock);
    expect(sessionLock).toBeLessThan(ownershipCheck);
    expect(ownershipCheck).toBeLessThan(firstWrite);
    expect(batchFunction).toContain("order by session.sequence\n  for update");
    expect(batchFunction).toContain("session.status in ('ready', 'upcoming')");
    expect(batchFunction).toContain("message = 'schedule_unchanged'");
  });

  it("validates final chronology and the authoritative plan deadline", () => {
    expect(batchFunction).toContain(
      "scheduled_for + estimated_minutes * interval '1 minute'",
    );
    expect(batchFunction).toContain(
      "previous_ends_at is not null and scheduled_for < previous_ends_at",
    );
    expect(batchFunction).toContain("message = 'schedule_sequence_conflict'");
    expect(batchFunction).toContain("select item.deadline\n  into plan_deadline");
    expect(batchFunction).toContain(
      "+ session.estimated_minutes * interval '1 minute' > plan_deadline",
    );
    expect(batchFunction).toContain("message = 'schedule_deadline_conflict'");
  });

  it("writes only after every invariant and returns the complete committed schedule", () => {
    const chronologyCheck = batchFunction.indexOf("message = 'schedule_sequence_conflict'");
    const deadlineCheck = batchFunction.indexOf("message = 'schedule_deadline_conflict'");
    const update = batchFunction.indexOf("update public.plan_sessions as session");
    const authoritativeRead = batchFunction.indexOf("select jsonb_agg(");

    expect(chronologyCheck).toBeLessThan(update);
    expect(deadlineCheck).toBeLessThan(update);
    expect(update).toBeLessThan(authoritativeRead);
    expect(batchFunction).toContain("'planId', requested_plan.id");
    expect(batchFunction).toContain("'sessions', authoritative_sessions");
  });

  it("routes the legacy one-session RPC through the transactional batch core", () => {
    expect(legacyWrapper).toContain(
      "batch_result := public.reschedule_plan_sessions(jsonb_build_object(",
    );
    expect(legacyWrapper).toContain("'operationKind', 'manual'");
    expect(legacyWrapper).not.toContain("update public.plan_sessions");
    expect(legacyWrapper).toContain("schedule_authoritative_read_failed");
  });

  it("exposes scheduling only to authenticated callers", () => {
    expect(migration).toContain(
      "revoke all on function public.reschedule_plan_sessions(jsonb)\nfrom public, anon, authenticated",
    );
    expect(migration).toContain(
      "grant execute on function public.reschedule_plan_sessions(jsonb) to authenticated",
    );
    expect(migration).toContain(
      "revoke all on function public.reschedule_plan_session(jsonb)\nfrom public, anon, authenticated",
    );
  });

  it("removes direct authenticated writes to scheduled_for without breaking other writers", () => {
    expect(migration).toContain(
      "revoke update on table public.plan_sessions from public, anon, authenticated",
    );
    const allowedUpdateGrant = migration.slice(
      migration.indexOf("grant update ("),
      migration.indexOf(") on table public.plan_sessions to authenticated") + 1,
    );
    expect(allowedUpdateGrant).toContain("sequence");
    expect(allowedUpdateGrant).toContain("estimated_minutes");
    expect(allowedUpdateGrant).toContain("status");
    expect(allowedUpdateGrant).toContain("step_data");
    expect(allowedUpdateGrant).not.toContain("scheduled_for");
  });
});
