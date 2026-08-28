import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(
  process.cwd(),
  "supabase/migrations/202608230004_export_study_route_history.sql",
), "utf8").toLocaleLowerCase();

describe("StudyRoute account export migration", () => {
  it("wraps rather than copies the mature claimed export transaction", () => {
    expect(migration).toContain(
      "alter function public.export_yova_account_data()\nrename to export_yova_account_data_without_study_routes",
    );
    expect(migration).toContain(
      "base_export := public.export_yova_account_data_without_study_routes()",
    );
    expect(migration).not.toContain("from public.account_data_exports");
  });

  it("exports the full immutable route ledger with identity and provenance", () => {
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
    expect(migration).toContain("from public.study_routes as route");
    expect(migration).toContain("where route.user_id = current_user_id");
    expect(migration).toContain("'studyroutes', route_history");
  });

  it("counts routes inside the existing hard export limits", () => {
    expect(migration).toContain("route_count > 10000");
    expect(migration).toContain("base_record_count + route_count > 25000");
    expect(migration).toContain(
      "'recordcount', base_record_count + route_count",
    );
    expect(migration).toContain("message = 'account_export_limit_exceeded'");
  });

  it("keeps the renamed helper private and grants only the wrapped boundary", () => {
    expect(migration).toContain(
      "revoke all on function public.export_yova_account_data_without_study_routes()\nfrom public, anon, authenticated",
    );
    expect(migration).toContain(
      "revoke all on function public.export_yova_account_data()\nfrom public, anon, authenticated",
    );
    expect(migration).toContain(
      "grant execute on function public.export_yova_account_data()\nto authenticated",
    );
  });
});
