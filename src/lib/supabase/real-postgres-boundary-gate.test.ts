import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(
  resolve(process.cwd(), ".github/workflows/quality.yml"),
  "utf8",
);
const databaseTest = readFileSync(
  resolve(
    process.cwd(),
    "supabase/tests/database/20260824_blurting_boundaries.test.sql",
  ),
  "utf8",
);

describe("real PostgreSQL Blurting boundary gate", () => {
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
    expect(databaseTest).toContain("select extensions.plan(48);");
    expect(databaseTest).toContain("select * from extensions.finish();");
    expect(databaseTest.trimEnd().endsWith("rollback;")).toBe(true);
    expect(databaseTest).not.toContain("session_replication_role");
    expect(databaseTest).not.toContain("disable trigger");
    expect(databaseTest).not.toContain("--linked");
  });

  it("proves the ordered migrations, zero-access store, and real SQL vectors", () => {
    for (const version of [
      "202608240001",
      "202608240002",
      "202608240003",
      "202608240004",
      "202608240005",
      "202608240006",
      "202608240007",
    ]) {
      expect(databaseTest).toContain(`'${version}'`);
    }
    for (const boundary of [
      "has_schema_privilege",
      "has_table_privilege",
      "has_function_privilege",
      "change_plan_session_method_with_route",
      "mint_plan_activation_permit_v1",
      "save_generated_plan_with_routes",
      "assert_study_route_blurting_recipe_v1",
      "blurting_public_resource_payload_valid_v18",
      "generated_session_has_broad_recall_v1",
      "is_valid_session_activity_progress",
      "blurting_resources_v18_guard_route_source",
      "blurting_evaluation_receipts_v18_guard_transition",
      "blurting_ecmascript_trim_v1",
      "blurting_bounded_text_valid_v18",
      "blurting_timestamp_text_matches_v18",
      "blurting_statement_timestamp_ms_v18",
      "blurting_resources_v18_canonical_domains_check",
      "U+0085, U+180E, and U+200B",
      "2026-08-25T08:00:00.000Z",
      "blurting_resource_store_cleanup_service_role_required",
      "86fd9b600999bd40b16fb5cdc84f34adcd344996a8ff5780369263273f6e8c2c",
    ]) {
      expect(databaseTest).toContain(boundary);
    }
  });
});
