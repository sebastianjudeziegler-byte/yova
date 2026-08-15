import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/202608140002_tester_invites.sql"),
  "utf8",
);

describe("tester invitation migration", () => {
  it("keeps the invitation ledger private from browser roles", () => {
    expect(migration).toContain("alter table public.tester_invites enable row level security");
    expect(migration).toContain(
      "revoke all on table public.tester_invites from public, anon, authenticated",
    );
    expect(migration).toContain(
      "grant select, insert, update, delete on table public.tester_invites to service_role",
    );
    expect(migration).not.toContain("create policy");
  });

  it("exposes only a founder boolean to signed-in accounts", () => {
    expect(migration).toContain("create or replace function public.is_yova_founder()");
    expect(migration).toContain("security definer\nset search_path = ''");
    expect(migration).toContain(
      "revoke all on function public.is_yova_founder() from public, anon",
    );
    expect(migration).toContain(
      "grant execute on function public.is_yova_founder() to authenticated",
    );
  });

  it("enforces tester access through a private claim RPC", () => {
    expect(migration).toContain("create or replace function public.claim_yova_tester_access()");
    expect(migration).toContain("and send_count > 0");
    expect(migration).toContain("and email = current_email");
    expect(migration).toContain(
      "revoke all on function public.claim_yova_tester_access() from public, anon",
    );
    expect(migration).toContain(
      "grant execute on function public.claim_yova_tester_access() to authenticated",
    );
  });

  it("marks an invitation joined only after Auth confirms its email", () => {
    expect(migration).toContain("after update of email_confirmed_at on auth.users");
    expect(migration).toContain(
      "when (old.email_confirmed_at is null and new.email_confirmed_at is not null)",
    );
    expect(migration).toContain("status = 'joined'");
    expect(migration).toContain("where email = lower(btrim(new.email))");
  });

  it("stores no invitation secret or action link", () => {
    expect(migration).not.toMatch(/token_hash|email_otp|action_link|confirmation_url/i);
  });
});
