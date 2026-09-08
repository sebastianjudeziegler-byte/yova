import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(
  process.cwd(),
  "supabase/migrations/202609080001_study_profile_report_confirmation_gate.sql",
), "utf8");

describe("Study Profile report confirmation gate migration", () => {
  it("requires both hashed credentials for a report-bound confirmation", () => {
    const boundFunction = migration.slice(
      migration.indexOf(
        "create or replace function public.confirm_study_profile_report_waitlist_measured(payload jsonb)",
      ),
      migration.indexOf(
        "create or replace function public.study_profile_public_readiness_v5()",
      ),
    );

    expect(migration).toContain(
      "create or replace function public.confirm_study_profile_report_waitlist_measured(payload jsonb)",
    );
    expect(migration).toContain("reportTokenHash");
    expect(migration).toContain("confirmationTokenHash");
    expect(migration).toContain(
      "resolved_confirmation_response_id is distinct from resolved_response_id",
    );
    expect(migration).toContain(
      "resolved_confirmation_lead_id is distinct from resolved_response_lead_id",
    );
    expect(boundFunction).toContain("receipt := public.confirm_study_profile_waitlist(");
    expect(boundFunction).not.toContain(
      "public.confirm_study_profile_waitlist_measured",
    );
  });

  it("keeps token-only confirmation isolated to landing waitlist rows", () => {
    const landingFunction = migration.slice(
      migration.indexOf(
        "create or replace function public.confirm_study_profile_waitlist_measured(payload jsonb)",
      ),
      migration.indexOf(
        "create or replace function public.confirm_study_profile_report_waitlist_measured(payload jsonb)",
      ),
    );

    expect(landingFunction).toContain("where confirmation.response_id is null");
    expect(landingFunction).toContain("'metaConversionEligible', false");
    expect(landingFunction).toContain(
      "set meta_registration_eligible = conversion_eligible",
    );
    expect(landingFunction).not.toContain("or was_replay");
    expect(landingFunction).not.toContain("reportTokenHash");
  });

  it("publishes and enforces the complete release-readiness boundary", () => {
    const compatibilityReadiness = migration.slice(
      migration.indexOf(
        "create or replace function public.study_profile_public_readiness_v4()",
      ),
      migration.indexOf(
        "create or replace function public.confirm_study_profile_report_waitlist_measured(payload jsonb)",
      ),
    );

    expect(compatibilityReadiness).toContain("meta_registration_eligible");
    expect(compatibilityReadiness).not.toContain("was_replay");
    expect(migration).toContain("create or replace function public.study_profile_public_readiness_v5()");
    expect(migration).toContain(
      "base_readiness jsonb := public.study_profile_public_readiness_v3()",
    );
    expect(migration).not.toContain(
      "base_readiness jsonb := public.study_profile_public_readiness_v4()",
    );
    expect(migration).toContain("'contractVersion', '202609080001'");
    expect(migration).toContain(
      "'minorConversionSuppression', coalesce(minor_conversion_suppression, false)",
    );
    expect(migration).toContain(
      "'landingConfirmationIsolation', coalesce(landing_confirmation_isolation, false)",
    );
    expect(migration).toContain(
      "and coalesce(landing_confirmation_isolation, false)",
    );
    for (const rpc of [
      "request_study_profile_report_waitlist_confirmation",
      "confirm_study_profile_waitlist_measured",
      "confirm_study_profile_report_waitlist_measured",
    ]) {
      expect(migration).toContain(
        `revoke all on function public.${rpc}(jsonb)\nfrom public, anon, authenticated, service_role;`,
      );
      expect(migration).toContain(
        `grant execute on function public.${rpc}(jsonb)\nto service_role;`,
      );
    }
  });
});
