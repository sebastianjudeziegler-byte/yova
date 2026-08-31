import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(
  process.cwd(),
  "supabase/migrations/202608310001_study_profile_revamp_waitlist.sql",
), "utf8");

describe("Study Profile revamp waitlist migration", () => {
  it("keeps both waitlist functions private to the service role", () => {
    for (const signature of [
      "public.join_study_profile_waitlist(jsonb)",
      "public.join_study_profile_report_waitlist(jsonb)",
    ]) {
      expect(migration).toContain(
        `revoke all on function ${signature}\nfrom public, anon, authenticated`,
      );
      expect(migration).toContain(
        `grant execute on function ${signature}\nto service_role`,
      );
    }
    expect(migration).not.toMatch(
      /grant execute on function[^\n]*\n\s*to (?:public|anon|authenticated)/i,
    );
  });

  it("rejects missing consent evidence and derives report revision from storage", () => {
    expect(migration).toContain("consent_source is distinct from 'landing'");
    expect(migration).toContain(
      "consent_source is null or consent_source not in ('email_gate', 'report_cta')",
    );
    expect(migration).toContain("profile_snapshot ->> 'scoringRevision'");
    expect(migration).toContain("'study_profile_scoring_v1'");
    expect(migration).toContain("'study_profile_scoring_v2'");
    expect(migration).not.toContain("payload ->> 'scoringRevision'");
  });

  it("adds share events and records each waitlist conversion inside the first-join branch", () => {
    expect(migration).toContain("'study_profile_share_tapped'");
    const landingFirstJoin = migration.indexOf("if not already_joined then");
    const landingEvent = migration.indexOf("'study_profile_waitlist_joined'", landingFirstJoin);
    const reportFunction = migration.indexOf(
      "create or replace function public.join_study_profile_report_waitlist",
    );
    const reportFirstJoin = migration.indexOf("if not already_joined then", reportFunction);
    const reportEvent = migration.indexOf("'study_profile_waitlist_joined'", reportFirstJoin);

    expect(landingFirstJoin).toBeGreaterThan(-1);
    expect(landingEvent).toBeGreaterThan(landingFirstJoin);
    expect(reportFirstJoin).toBeGreaterThan(reportFunction);
    expect(reportEvent).toBeGreaterThan(reportFirstJoin);
  });
});
