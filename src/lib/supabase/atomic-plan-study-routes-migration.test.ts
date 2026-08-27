import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationName = "202608230002_atomic_plan_study_routes.sql";
const migrationsDirectory = resolve(process.cwd(), "supabase/migrations");
const migration = readFileSync(resolve(migrationsDirectory, migrationName), "utf8");

describe("atomic plan and StudyRoute persistence migration", () => {
  it("adds one authenticated invoker wrapper without replacing the guarded plan RPC", () => {
    expect(migration).toContain(
      "create or replace function public.save_generated_plan_with_routes(payload jsonb)",
    );
    expect(migration).toContain("security invoker\nset search_path = ''");
    expect(migration).not.toMatch(
      /create or replace function public\.save_generated_plan\(payload jsonb\)/,
    );
    expect(migration).toContain(
      "revoke all on function public.save_generated_plan_with_routes(jsonb)\nfrom public, anon, authenticated",
    );
    expect(migration).toContain(
      "grant execute on function public.save_generated_plan_with_routes(jsonb)\nto authenticated",
    );
  });

  it("accepts route-free legacy plans but rejects partial canonical coverage", () => {
    expect(migration).toContain(
      "if route_count <> 0 and route_count <> session_count then",
    );
    expect(migration).toContain("message = 'plan_route_incomplete_coverage'");
    expect(migration).toContain(
      "if route_count = 0 then\n    return saved_plan_id;",
    );
    expect(migration).toContain("message = 'plan_route_duplicate_session_id'");
    expect(migration).toContain("message = 'plan_route_duplicate_revision_id'");
  });

  it("requires every route to be committed and bound to the exact plan/session IDs", () => {
    expect(migration).toContain(
      "route_identity ->> 'lifecycleStatus' is distinct from 'committed'",
    );
    expect(migration).toContain(
      "routed_plan_id is distinct from requested_plan_id\n      or routed_session_id is distinct from requested_session_id",
    );
    expect(migration).toContain("message = 'plan_route_identity_mismatch'");
  });

  it("delegates first, commits every route, and verifies each resulting pointer", () => {
    const delegatedSave = migration.indexOf(
      "saved_plan_id := public.save_generated_plan(payload);",
    );
    const routeCommit = migration.indexOf(
      "perform public.commit_study_route_revision(route_payload);",
    );
    const pointerRead = migration.indexOf(
      "select session.committed_route_revision_id",
    );

    expect(delegatedSave).toBeGreaterThan(-1);
    expect(routeCommit).toBeGreaterThan(delegatedSave);
    expect(pointerRead).toBeGreaterThan(routeCommit);
    expect(migration).toContain(
      "committed_route_revision_id is distinct from requested_route_revision_id",
    );
    expect(migration).toContain("message = 'plan_route_pointer_mismatch'");
    expect(migration).not.toContain("exception when others then\n    return");
  });

  it("is the first migration to expose the atomic wrapper", () => {
    const earlierMigrations = readdirSync(migrationsDirectory)
      .filter((name) => name.endsWith(".sql") && name < migrationName);

    expect(earlierMigrations.length).toBeGreaterThan(0);
    for (const name of earlierMigrations) {
      expect(
        readFileSync(resolve(migrationsDirectory, name), "utf8"),
        name,
      ).not.toContain("save_generated_plan_with_routes");
    }
  });
});
