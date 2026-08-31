import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(
  process.cwd(),
  "supabase/migrations/202608310002_study_profile_waitlist_double_opt_in.sql",
), "utf8");

describe("Study Profile waitlist double opt-in migration", () => {
  it("stores only hashed, expiring, one-time confirmation credentials", () => {
    expect(migration).toContain("create table public.study_profile_waitlist_confirmations");
    expect(migration).toMatch(/token_hash text unique/);
    expect(migration).toContain("token_hash ~ '^[0-9a-f]{64}$'");
    expect(migration).toContain("now() + interval '24 hours'");
    expect(migration).toContain("now() + interval '15 minutes'");
    expect(migration).toMatch(/status = 'confirmed',[\s\S]*token_hash = null/);
    expect(migration).toContain("consumed_token_hash = confirmation_hash");
    expect(migration).toContain("replay_expires_at = least(");
    expect(migration).toContain("age_confirmed boolean not null check (age_confirmed)");
    expect(migration).toContain("payload -> 'ageConfirmed' is distinct from 'true'::jsonb");
    expect(migration).toContain("study_profile_waitlist_confirmations_replay_cleanup_idx");
    expect(migration).not.toMatch(/where status = 'confirmed'\s+and consumed_token_hash is not null/);
    expect(migration).not.toMatch(/raw[_ ]?token/i);
  });

  it("keeps request, delivery, and confirmation RPCs behind service role", () => {
    for (const rpc of [
      "request_study_profile_waitlist_confirmation",
      "request_study_profile_report_waitlist_confirmation",
      "mark_study_profile_waitlist_confirmation_delivery",
      "confirm_study_profile_waitlist",
      "reserve_study_profile_report_email_delivery",
    ]) {
      expect(migration).toContain(`revoke all on function public.${rpc}(jsonb)`);
      expect(migration).toContain(`grant execute on function public.${rpc}(jsonb)\nto service_role;`);
    }
    expect(migration).toContain("alter table public.study_profile_waitlist_confirmations enable row level security");
    expect(migration).toContain("alter table public.study_profile_email_delivery_attempts enable row level security");
    expect(migration).toContain("grant usage, select\non sequence public.study_profile_email_delivery_attempts_id_seq\nto service_role;");
    expect(migration).toContain("on sequence public.study_profile_email_delivery_attempts_id_seq\nfrom public, anon, authenticated;");
    expect(migration).toContain("revoke execute on function public.join_study_profile_waitlist(jsonb)");
    expect(migration).toContain("revoke execute on function public.join_study_profile_report_waitlist(jsonb)");
  });

  it("serializes a 15-minute report-email reservation per lead", () => {
    expect(migration).toContain("report_email_next_allowed_at");
    expect(migration).toContain("reserve_study_profile_report_email_delivery");
    expect(migration).toContain("pg_catalog.pg_advisory_xact_lock");
    expect(migration).toContain("now() + interval '15 minutes'");
    expect(migration).toContain("email_delivery_status = 'skipped'");
    expect(migration).toContain("create table public.study_profile_email_delivery_attempts");
    expect(migration).toContain("daily_attempt_count >= 5");
    expect(migration).toContain("reserved_at > now() - interval '24 hours'");
    expect(migration).toContain("delivery_kind = 'waitlist_confirmation'");
    expect(migration).toContain("study_profile_waitlist_confirmations_report_state_idx");
    expect(migration).toContain("on conflict (email_normalized) do nothing");
  });

  it("exposes the exact read-only deployment readiness contract", () => {
    expect(migration).toContain("create or replace function public.study_profile_public_readiness_v1()");
    expect(migration).toContain("'contractVersion', '202608310002'");
    expect(migration).toContain("'ready'");
    expect(migration).toContain("'pendingConfirmationColumns'");
    expect(migration).toContain("'confirmationRpcs'");
    expect(migration).toContain("'reportEmailCooldown'");
    expect(migration).toContain("'serviceRoleBoundary'");
    expect(migration).toContain("revoke all on function public.study_profile_public_readiness_v1()");
    expect(migration).toContain("grant execute on function public.study_profile_public_readiness_v1()\nto service_role;");
    expect(migration).toContain("and position(");
    expect(migration).not.toContain("pg_catalog.position(");
  });
});
