import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(
  process.cwd(),
  "supabase/migrations/202608230006_bound_study_route_export.sql",
), "utf8").toLocaleLowerCase();

describe("bounded StudyRoute account export migration", () => {
  it("replaces only the public route wrapper and preserves the mature private base", () => {
    expect(migration).toContain(
      "create or replace function public.export_yova_account_data()",
    );
    expect(migration).toContain(
      "base_export := public.export_yova_account_data_without_study_routes()",
    );
    expect(migration).not.toContain("alter function public.export_yova_account_data()");
    expect(migration).not.toContain("create or replace function public.build_account_data_export()");
  });

  it("pre-counts and pre-sums serialized route objects before aggregation", () => {
    const preflight = migration.indexOf("with serialized_routes as materialized");
    const count = migration.indexOf("pg_catalog.count(*)::bigint", preflight);
    const byteSum = migration.indexOf(
      "pg_catalog.sum(pg_catalog.octet_length(serialized_route::text)::bigint)",
      preflight,
    );
    const recordGuard = migration.indexOf(
      "if route_count > 10000 or combined_record_count > 25000 then",
      preflight,
    );
    const aggregate = migration.indexOf("pg_catalog.jsonb_agg(", preflight);

    expect(preflight).toBeGreaterThan(-1);
    expect(count).toBeGreaterThan(preflight);
    expect(byteSum).toBeGreaterThan(count);
    expect(recordGuard).toBeGreaterThan(byteSum);
    expect(aggregate).toBeGreaterThan(recordGuard);
  });

  it("budgets route serialization against the bytes left by the base artifact", () => {
    expect(migration).toContain(
      "maximum_payload_bytes constant bigint := 26214400",
    );
    expect(migration).toContain(
      "remaining_payload_bytes := maximum_payload_bytes - base_payload_bytes",
    );
    expect(migration).toContain(
      "route_serialized_bytes + ((route_count - 1) * 2) + 2",
    );
    expect(migration).toContain(
      "if route_array_bytes + route_envelope_bytes > remaining_payload_bytes then",
    );
  });

  it("recounts the aggregated ledger and rechecks the exact final JSON size", () => {
    const aggregate = migration.indexOf("pg_catalog.jsonb_agg(");
    const actualCount = migration.indexOf(
      "actual_route_count := pg_catalog.jsonb_array_length(route_history)::bigint",
    );
    const finalResult = migration.indexOf("result := base_export ||", actualCount);
    const exactSize = migration.indexOf(
      "pg_catalog.octet_length(result::text) > maximum_payload_bytes",
      finalResult,
    );

    expect(actualCount).toBeGreaterThan(aggregate);
    expect(finalResult).toBeGreaterThan(actualCount);
    expect(exactSize).toBeGreaterThan(finalResult);
    expect(migration).toContain(
      "if actual_route_count > 10000 or combined_record_count > 25000 then",
    );
  });

  it("retains every immutable route-ledger field", () => {
    for (const field of [
      "routerevisionid",
      "routelineageid",
      "revisionnumber",
      "schemaversion",
      "lifecyclestatus",
      "planid",
      "plansessionid",
      "supersedesrevisionid",
      "routefingerprint",
      "createdat",
      "committedat",
    ]) {
      expect(migration).toContain(`'${field}'`);
    }
    expect(migration).toContain("'route', route.route_payload");
    expect(migration).toContain("'studyroutes', route_history");
  });

  it("updates the claimed JWT-session receipt to the combined count and requires a row", () => {
    const receiptUpdate = migration.indexOf(
      "update public.account_data_exports as export_job",
    );
    const foundGuard = migration.indexOf("if not found then", receiptUpdate);

    expect(migration).toContain(
      "current_session_id text := coalesce(auth.jwt() ->> 'session_id', '')",
    );
    expect(receiptUpdate).toBeGreaterThan(-1);
    expect(migration.slice(receiptUpdate, foundGuard)).toContain(
      "record_count = combined_record_count::integer",
    );
    expect(migration.slice(receiptUpdate, foundGuard)).toContain(
      "export_job.session_id = current_session_id",
    );
    expect(migration.slice(receiptUpdate, foundGuard)).toContain(
      "export_job.status = 'finalizing'",
    );
    expect(foundGuard).toBeGreaterThan(receiptUpdate);
    expect(migration.slice(foundGuard)).toContain(
      "message = 'account_export_not_claimed'",
    );
  });

  it("keeps the public export boundary authenticated-only", () => {
    expect(migration).toContain(
      "revoke all on function public.export_yova_account_data()\nfrom public, anon, authenticated",
    );
    expect(migration).toContain(
      "grant execute on function public.export_yova_account_data()\nto authenticated",
    );
  });
});
