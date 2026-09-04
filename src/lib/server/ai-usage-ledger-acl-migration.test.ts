import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL(
    "../../../supabase/migrations/202609040003_revoke_ai_usage_ledger_dml.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("AI usage ledger ACL migration", () => {
  it("removes every direct PostgREST privilege from the quota window ledger", () => {
    expect(migration).toContain(
      "revoke all on table public.ai_usage_windows\nfrom public, anon, authenticated, service_role",
    );
    expect(migration).not.toMatch(
      /grant\s+(?:insert|update|delete|all)[\s\S]*public\.ai_usage_windows/i,
    );
  });

  it("keeps reservation claims fully internal", () => {
    expect(migration).toContain(
      "revoke all on table public.ai_usage_claims\nfrom public, anon, authenticated, service_role",
    );
    expect(migration).not.toMatch(
      /grant\s+(?:select|insert|update|delete|all)[\s\S]*public\.ai_usage_claims/i,
    );
  });

  it("retains only the service-role window read required by the deletion canary", () => {
    expect(migration).toContain(
      "grant select on table public.ai_usage_windows to service_role",
    );
    expect(migration.match(/grant\s+/gi)).toHaveLength(1);
  });
});
