import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = path.join(
  process.cwd(),
  "supabase/migrations/202608230009_route_bound_session_cache.sql",
);
const migration = fs.readFileSync(migrationPath, "utf8");

describe("route-bound generated-session cache migration", () => {
  it("requires one explicit expected route receipt and both generated cache receipts", () => {
    expect(migration).toContain("payload ? 'expectedRouteRevisionId'");
    expect(migration).toContain("requested_generated_session ->> 'routeRevisionId'");
    expect(migration).toContain("requested_generated_session #>> '{cacheContext,routeRevisionId}'");
    expect(migration).toContain("stored_route_revision_id is distinct from requested_route_revision_id");
    expect(migration).toContain("generated_route_revision_id is distinct from stored_route_revision_id");
    expect(migration).toContain("generated_context_route_revision_id is distinct from stored_route_revision_id");
  });

  it("checks route parity before accepting an idempotent retry", () => {
    const parityCheck = migration.indexOf("stored_route_revision_id is distinct from requested_route_revision_id");
    const retryCheck = migration.indexOf("stored_generated_session is not distinct from requested_generated_session");
    expect(parityCheck).toBeGreaterThan(-1);
    expect(retryCheck).toBeGreaterThan(parityCheck);
  });

  it("locks in canonical order and rechecks the pointer in the final write", () => {
    const advisory = migration.indexOf("pg_advisory_xact_lock");
    const planLock = migration.indexOf("from public.plans as plan");
    const itemLock = migration.indexOf("from public.learning_items as item");
    const sessionLock = migration.indexOf("from public.plan_sessions as session", planLock);
    expect(advisory).toBeGreaterThan(-1);
    expect(planLock).toBeGreaterThan(advisory);
    expect(itemLock).toBeGreaterThan(planLock);
    expect(sessionLock).toBeGreaterThan(itemLock);
    expect(migration).toContain("committed_route_revision_id is not distinct from stored_route_revision_id");
  });

  it("remains a narrow authenticated security-definer boundary", () => {
    expect(migration).toContain("security definer");
    expect(migration).toContain("set search_path = ''");
    expect(migration).toContain("current_user_id uuid := auth.uid()");
    expect(migration).toContain("revoke all on function public.cache_generated_session(jsonb)");
    expect(migration).toContain("grant execute on function public.cache_generated_session(jsonb)");
  });
});
