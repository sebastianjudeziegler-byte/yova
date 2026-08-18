import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/202608180001_guard_inactive_plan_session_updates.sql",
  ),
  "utf8",
);

const guardFunction = migration.slice(
  migration.indexOf("create or replace function public.guard_inactive_plan_session_update()"),
  migration.indexOf("drop trigger if exists plan_sessions_guard_inactive_parent_update"),
);

describe("inactive plan-session update guard migration", () => {
  it("rejects reparenting before consulting either parent status", () => {
    expect(guardFunction).toContain(
      "if new.plan_id is distinct from old.plan_id\n    or new.user_id is distinct from old.user_id then",
    );
    expect(guardFunction).toContain("message = 'plan_session_reparent_forbidden'");
    expect(guardFunction.indexOf("new.plan_id is distinct from old.plan_id")).toBeLessThan(
      guardFunction.indexOf("select plans.status"),
    );
  });

  it("serializes every session update without waiting in the inverse lock order", () => {
    expect(guardFunction).toContain("security definer\nset search_path = ''");
    expect(guardFunction).toContain(
      "where plans.id = old.plan_id\n      and plans.user_id = old.user_id\n    for no key update nowait",
    );
    expect(guardFunction).toContain("when lock_not_available then");
    expect(guardFunction).toContain("errcode = '40001'");
    expect(guardFunction).toContain(
      "message = 'plan_session_parent_state_conflict'",
    );
    expect(guardFunction).toContain("if parent_status = 'active' then\n    return new");
    expect(guardFunction.indexOf("for no key update nowait")).toBeLessThan(
      guardFunction.indexOf("if parent_status = 'active'"),
    );
    expect(guardFunction).not.toContain("for key share");
    expect(guardFunction).not.toMatch(/for no key update\s*;/);
  });

  it("fails closed for operational updates on every inactive plan status", () => {
    expect(guardFunction).toContain("errcode = '55000'");
    expect(guardFunction).toContain("message = 'plan_session_parent_inactive'");
    expect(guardFunction).not.toContain("parent_status = 'archived'");
    expect(guardFunction).not.toContain("parent_status = 'completed'");
    expect(guardFunction).not.toContain("parent_status = 'draft'");
  });

  it("allows only removal of generated caches or active recovery checkpoints", () => {
    expect(guardFunction).toContain("jsonb_typeof(old.step_data) = 'object'");
    expect(guardFunction).toContain("jsonb_typeof(new.step_data) = 'object'");
    expect(guardFunction).toContain("old.step_data ? 'generatedSession'");
    expect(guardFunction).toContain(
      "new.step_data is not distinct from old.step_data - 'generatedSession'",
    );
    expect(guardFunction).toContain("old.step_data ? 'activeSessionCheckpoint'");
    expect(guardFunction).toContain(
      "new.step_data is not distinct from old.step_data - 'activeSessionCheckpoint'",
    );
    expect(guardFunction).toContain(
      "old.step_data - 'generatedSession' - 'activeSessionCheckpoint'",
    );
    expect(guardFunction).not.toMatch(/new\.step_data\s*\?\s*'generatedSession'/);
    expect(guardFunction).not.toMatch(/new\.step_data\s*\?\s*'activeSessionCheckpoint'/);
  });

  it("protects every present and future operational column", () => {
    expect(guardFunction).toContain(
      "to_jsonb(new) - 'step_data' - 'updated_at'",
    );
    expect(guardFunction).toContain(
      "to_jsonb(old) - 'step_data' - 'updated_at'",
    );
    expect(guardFunction).not.toContain("new.status = old.status");
    expect(guardFunction).not.toContain("new.scheduled_for = old.scheduled_for");
    expect(guardFunction).not.toContain("new.estimated_minutes = old.estimated_minutes");
  });

  it("guards UPDATE only, leaving reset and cascading deletion intact", () => {
    expect(migration).toContain(
      "create trigger plan_sessions_guard_inactive_parent_update\nbefore update on public.plan_sessions",
    );
    expect(migration).not.toContain("before delete on public.plan_sessions");
    expect(migration).not.toContain("after delete on public.plan_sessions");
    expect(migration).not.toContain("before insert on public.plan_sessions");
    expect(migration).not.toContain("after insert on public.plan_sessions");
  });

  it("runs after checkpoint cleanup and cannot be invoked directly", () => {
    expect(
      "plan_sessions_clear_invalid_active_session_checkpoint".localeCompare(
        "plan_sessions_guard_inactive_parent_update",
      ),
    ).toBeLessThan(0);
    expect(
      "plan_sessions_guard_inactive_parent_update".localeCompare(
        "plan_sessions_set_updated_at",
      ),
    ).toBeLessThan(0);
    expect(migration).toContain(
      "revoke all on function public.guard_inactive_plan_session_update()\nfrom public, anon, authenticated",
    );
  });
});
