import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(
  process.cwd(),
  "supabase/migrations/202609060001_study_profile_meta_attribution.sql",
), "utf8");
const firstTouchMigration = readFileSync(resolve(
  process.cwd(),
  "supabase/migrations/202609060002_study_profile_attribution_first_touch.sql",
), "utf8");

describe("Study Profile Meta attribution migration", () => {
  it("adds a bounded Meta click ID to both conversion records", () => {
    expect(migration).toContain("alter table public.study_profile_responses");
    expect(migration).toContain("alter table public.study_profile_waitlist_confirmations");
    expect(migration.match(/add column if not exists fbclid text/g)).toHaveLength(2);
    expect(migration).toContain("char_length(fbclid) between 1 and 500");
    expect(migration).toContain("fbclid ~ '^[A-Za-z0-9._-]+$'");
  });

  it("keeps attributed writes atomic and first-touch-safe", () => {
    expect(migration).toContain("receipt := public.save_study_profile_response(payload)");
    expect(migration).toContain(
      "receipt := public.request_study_profile_waitlist_confirmation(payload)",
    );
    expect(migration).toContain(
      "receipt := public.request_study_profile_report_waitlist_confirmation(payload)",
    );
    expect(migration).toContain("coalesce((receipt ->> 'shouldSend')::boolean, false)");
    expect(migration).toContain("case when response.has_attribution");
    expect(migration).toContain("pg_catalog.num_nonnulls(");
  });

  it("keeps every new RPC behind the server-only role", () => {
    for (const rpc of [
      "save_study_profile_response_attributed",
      "request_study_profile_waitlist_confirmation_attributed",
      "request_study_profile_report_waitlist_confirmation_attributed",
    ]) {
      expect(migration).toContain(`revoke all on function public.${rpc}(jsonb)`);
      expect(migration).toContain(`grant execute on function public.${rpc}(jsonb)\nto service_role;`);
    }
  });

  it("publishes the additive release-readiness contract", () => {
    expect(migration).toContain("create or replace function public.study_profile_public_readiness_v2()");
    expect(migration).toContain("base_readiness jsonb := public.study_profile_public_readiness_v1()");
    expect(migration).toContain("'contractVersion', '202609060001'");
    expect(migration).toContain("'attributionCapture', attribution_capture");
    expect(migration.match(/not candidate_proc\.prosecdef/g)).toHaveLength(3);
    expect(migration).toContain("'public.save_study_profile_response(payload)'");
    expect(migration).toContain(
      "'public.request_study_profile_waitlist_confirmation(payload)'",
    );
    expect(migration).toContain(
      "'public.request_study_profile_report_waitlist_confirmation(payload)'",
    );
    expect(migration).toContain("grant execute on function public.study_profile_public_readiness_v2()\nto service_role;");
  });

  it("lets a later tagged report CTA replace only an untagged direct response", () => {
    expect(firstTouchMigration).toContain(
      "pg_catalog.lower(pg_catalog.btrim(response.traffic_source))",
    );
    expect(firstTouchMigration).toContain("'direct'");
    expect(firstTouchMigration).toContain("response.referrer_host");
    expect(firstTouchMigration).toContain("response.utm_source");
    expect(firstTouchMigration).toContain("response.fbclid");
    expect(firstTouchMigration).toContain(
      "create or replace function public.study_profile_public_readiness_v3()",
    );
    expect(firstTouchMigration).toContain("'contractVersion', '202609060002'");
    expect(firstTouchMigration).toContain(
      "'attributionFirstTouch', coalesce(attribution_first_touch, false)",
    );
  });
});
