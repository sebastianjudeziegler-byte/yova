import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(
  process.cwd(),
  "supabase/migrations/202609060003_study_profile_minor_conversion_suppression.sql",
), "utf8");

describe("Study Profile minor conversion suppression migration", () => {
  it("adds nullable minor status to report responses and waitlist confirmations", () => {
    expect(migration).toContain("alter table public.study_profile_responses");
    expect(migration).toContain("alter table public.study_profile_waitlist_confirmations");
    expect(migration.match(/add column if not exists under_18 boolean;/g)).toHaveLength(2);
  });

  it("persists explicit landing status and derives report confirmation status server-side", () => {
    expect(migration.match(/payload -> 'under18' = 'true'::jsonb/g)).toHaveLength(2);
    expect(migration.match(/payload -> 'under18' = 'false'::jsonb/g)).toHaveLength(2);
    expect(migration).toContain("under_18 = resolved_under_18");
    expect(migration).toContain("confirmation.under_18 is true or response.under_18 is true");
    expect(migration).toContain("confirmation.under_18 is false or response.under_18 is false");
    expect(migration).not.toContain("payload #>> '{under18}'");
  });

  it("derives measured conversion eligibility from the stored confirmation", () => {
    expect(migration).toContain(
      "create or replace function public.confirm_study_profile_waitlist_measured(payload jsonb)",
    );
    expect(migration).toContain("receipt := public.confirm_study_profile_waitlist(payload)");
    expect(migration).toMatch(/select under_18[\s\S]*from public\.study_profile_waitlist_confirmations/);
    expect(migration).toContain("conversion_eligible := resolved_under_18 is false");
    expect(migration).toContain("or was_replay");
    expect(migration).toContain("'metaConversionEligible', conversion_eligible");
  });

  it("keeps the measured confirmation RPC behind the server-only role", () => {
    expect(migration).toContain(
      "revoke all on function public.confirm_study_profile_waitlist_measured(jsonb)\nfrom public, anon, authenticated;",
    );
    expect(migration).toContain(
      "grant execute on function public.confirm_study_profile_waitlist_measured(jsonb)\nto service_role;",
    );
  });

  it("publishes minor suppression in the additive readiness contract", () => {
    expect(migration).toContain(
      "create or replace function public.study_profile_public_readiness_v4()",
    );
    expect(migration).toContain(
      "base_readiness jsonb := public.study_profile_public_readiness_v3()",
    );
    expect(migration).toContain("'contractVersion', '202609060003'");
    expect(migration).toContain(
      "'minorConversionSuppression', coalesce(minor_conversion_suppression, false)",
    );
  });
});
