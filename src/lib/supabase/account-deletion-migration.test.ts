import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL("../../../supabase/migrations/202608180002_self_service_account_deletion.sql", import.meta.url),
  "utf8",
).toLowerCase();

describe("self-service account-deletion migration", () => {
  it("atomically records exact private paths before deleting the current Auth identity", () => {
    expect(migration).toContain("create table public.account_deletion_cleanup_jobs");
    expect(migration).toContain("create or replace function public.delete_yova_account(expected_account_id uuid)");
    expect(migration).toContain("current_user_id uuid := auth.uid()");
    expect(migration).toContain("current_user_id <> expected_account_id");
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("object.bucket_id = 'learning-materials'");
    expect(migration).toContain("object.bucket_id = 'account-exports'");

    const receiptIndex = migration.indexOf("insert into public.account_deletion_cleanup_jobs");
    const exportReceiptDeleteIndex = migration.indexOf("delete from public.account_data_exports");
    const authDeleteIndex = migration.indexOf("delete from auth.users");
    expect(receiptIndex).toBeGreaterThan(0);
    expect(exportReceiptDeleteIndex).toBeGreaterThan(receiptIndex);
    expect(authDeleteIndex).toBeGreaterThan(receiptIndex);
  });

  it("requires recent human authentication and a confirmed account email in SQL", () => {
    expect(migration).toContain("public.account_export_has_recent_human_amr() is not true");
    expect(migration).toContain("email_confirmed_at");
    expect(migration).toContain("account_deletion_reauthentication_required");
  });

  it("keeps cleanup receipts after Auth deletion and exposes only leased service-role cleanup", () => {
    expect(migration).toContain("-- no auth fk");
    expect(migration).toContain("for update skip locked");
    expect(migration).toContain("claim_account_deletion_cleanup_jobs");
    expect(migration).toContain("confirm_account_deletion_cleanup");
    expect(migration).toContain("release_account_deletion_cleanup");
    expect(migration).toContain("revoke all on table public.account_deletion_cleanup_jobs from public, anon, authenticated, service_role");
    expect(migration).toContain("grant execute on function public.delete_yova_account(uuid) to authenticated");
    expect(migration).toContain("grant execute on function public.claim_account_deletion_cleanup_jobs(integer) to service_role");
    expect(migration).not.toContain("grant execute on function public.claim_account_deletion_cleanup_jobs(integer) to authenticated");
  });

  it("allows founder account deletion without erasing invitation history", () => {
    expect(migration).toContain("alter column invited_by drop not null");
    expect(migration).toContain("on delete set null");
    expect(migration).toContain("update public.tester_invites");
    expect(migration).toContain("set invited_by = null");
  });
});
