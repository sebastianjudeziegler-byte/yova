import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(
  resolve(process.cwd(), ".github/workflows/quality.yml"),
  "utf8",
);
const databaseTest = readFileSync(resolve(
  process.cwd(),
  "supabase/tests/database/20260830_broad_recall_retry_containment.test.sql",
), "utf8");

describe("real PostgreSQL compatibility boundary gate", () => {
  it("runs pgTAP after the full migration replay and lint but before teardown", () => {
    const replay = workflow.indexOf("pnpm exec supabase db start");
    const lint = workflow.indexOf("pnpm exec supabase db lint --local");
    const test = workflow.indexOf("pnpm exec supabase test db --local");
    const stop = workflow.indexOf("pnpm exec supabase stop --no-backup");

    expect(replay).toBeGreaterThanOrEqual(0);
    expect(lint).toBeGreaterThan(replay);
    expect(test).toBeGreaterThan(lint);
    expect(stop).toBeGreaterThan(test);
    expect(workflow).not.toContain("supabase test db --linked");
  });

  it("keeps the database fixture transactional, local, and self-contained", () => {
    expect(databaseTest.trimStart().startsWith("begin;")).toBe(true);
    expect(databaseTest).toContain(
      "create extension if not exists pgtap with schema extensions;",
    );
    expect(databaseTest).toContain(
      "set local search_path = extensions, public, pg_catalog;",
    );
    expect(databaseTest).toContain("select extensions.plan(16);");
    expect(databaseTest).toContain("select * from extensions.finish();");
    expect(databaseTest.trimEnd().endsWith("rollback;")).toBe(true);
    expect(databaseTest).not.toContain("session_replication_role");
    expect(databaseTest).not.toContain("disable trigger");
    expect(databaseTest).not.toContain("--linked");
  });

  it("proves the retained checkpoint retry-containment vectors", () => {
    for (const boundary of [
      "has_function_privilege",
      "guard_broad_recall_checkpoint_binding_v1",
      "guard_broad_recall_attempt_binding_v1",
      "guard_broad_recall_event_binding_v1",
      "broad_recall_progress_binding_conflict",
      "broad_recall_interruption_resource_identity_required",
      "22023",
      "55000",
    ]) {
      expect(databaseTest).toContain(boundary);
    }
  });
});
