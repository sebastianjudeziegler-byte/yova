import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(
  process.cwd(),
  "supabase/migrations/202608310003_method_eligibility_v3.sql",
), "utf8");
const normalized = migration.toLocaleLowerCase();

function functionBody(signature: string, revokeMarker: string) {
  const start = normalized.indexOf(signature.toLocaleLowerCase());
  const end = normalized.indexOf(revokeMarker.toLocaleLowerCase(), start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return normalized.slice(start, end);
}

const publicAdapter = functionBody(
  "create or replace function public.change_plan_session_method_with_route(\n",
  "revoke all on function public.change_plan_session_method_with_route(jsonb)",
);
const readinessV3 = functionBody(
  "create or replace function public.signed_in_generation_readiness_v3()",
  "revoke all on function public.signed_in_generation_readiness_v3()",
);

describe("method eligibility v3 database boundary migration", () => {
  it("clones the mature v2 writer through a guarded, eligibility-only substitution", () => {
    expect(normalized).toContain(
      "pg_catalog.pg_get_functiondef(routine.oid)",
    );
    expect(normalized).toContain(
      "'change_plan_session_method_with_route_v2',\n    'change_plan_session_method_with_route_v3'",
    );
    expect(normalized).toContain(
      "'method_eligibility_v2',\n    'method_eligibility_v3'",
    );
    expect(normalized).toContain(
      "eligibility_marker_count is distinct from 5",
    );
    expect(normalized).toContain(
      "writer_name_marker_count is distinct from 1",
    );
    expect(normalized).toContain(
      "message = 'method_eligibility_v2_writer_shape_conflict'",
    );
    expect(normalized).not.toContain(
      "drop function public.change_plan_session_method_with_route_v2",
    );
    expect(normalized).not.toContain(
      "create or replace function public.change_plan_session_method_with_route_v2",
    );
  });

  it("selects the writer only from the owned stored predecessor trace", () => {
    expect(publicAdapter).toContain("current_user_id uuid := auth.uid()");
    expect(publicAdapter).toContain(
      "route.route_revision_id = expected_route_revision_id",
    );
    expect(publicAdapter).toContain("route.plan_id = requested_plan_id");
    expect(publicAdapter).toContain(
      "route.plan_session_id = requested_session_id",
    );
    expect(publicAdapter).toContain("route.user_id = current_user_id");
    expect(publicAdapter).toContain(
      "predecessor_route_payload #> '{provenance,ruletrace}'",
    );
    expect(publicAdapter).toContain(
      "if predecessor_has_agency_controller then",
    );
    expect(publicAdapter).toContain(
      "return public.change_plan_session_method_with_route_v3(payload)",
    );
    expect(publicAdapter).toContain(
      "return public.change_plan_session_method_with_route_v2(payload)",
    );
    expect(publicAdapter).toContain(
      "return public.change_plan_session_method_with_route_legacy_v1(payload)",
    );
    expect(publicAdapter).not.toContain("successorstudyroute");
    expect(publicAdapter).not.toContain("routerversion");
    expect(publicAdapter).not.toContain("eligibilitypolicyversion");
  });

  it("keeps both versioned writers private behind one authenticated adapter", () => {
    expect(normalized).toContain(
      "revoke all on function\n  public.change_plan_session_method_with_route_v3(jsonb)\nfrom public, anon, authenticated, service_role",
    );
    expect(normalized).toContain(
      "grant execute on function\n  public.change_plan_session_method_with_route(jsonb)\nto authenticated",
    );
    expect(normalized).not.toContain(
      "grant execute on function\n  public.change_plan_session_method_with_route_v3(jsonb)",
    );
  });

  it("adds a service-only readiness head for the v3 writer and dispatcher", () => {
    expect(readinessV3).toContain(
      "base_readiness := public.signed_in_generation_readiness_v2()",
    );
    expect(readinessV3).toContain("'contractversion', '202608310003'");
    expect(readinessV3).toContain(
      "'methodeligibilityv3boundary', eligibility_v3_ready",
    );
    expect(readinessV3).toContain("'method_eligibility_v3'");
    expect(readinessV3).toContain("'method_eligibility_v2'");
    expect(normalized).toContain(
      "revoke all on function public.signed_in_generation_readiness_v3()\nfrom public, anon, authenticated, service_role",
    );
    expect(normalized).toContain(
      "grant execute on function public.signed_in_generation_readiness_v3()\nto service_role",
    );
  });
});
