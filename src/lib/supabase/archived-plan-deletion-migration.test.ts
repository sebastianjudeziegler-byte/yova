import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL("../../../supabase/migrations/202608180004_delete_archived_learning_plans.sql", import.meta.url),
  "utf8",
).toLowerCase();

describe("archived learning-plan deletion migration", () => {
  it("is owner-scoped, archived-only, strict, and authenticated-only", () => {
    expect(migration).toContain("create or replace function public.delete_archived_learning_plan(payload jsonb)");
    expect(migration).toContain("current_user_id uuid := auth.uid()");
    expect(migration).toContain("requested_plan.status <> 'archived'");
    expect(migration).toContain("plan_deletion_requires_archived");
    expect(migration).toContain("set search_path = ''");
    expect(migration).toContain("security definer");
    expect(migration).toContain("revoke all on function public.delete_archived_learning_plan(jsonb) from public, anon");
    expect(migration).toContain("grant execute on function public.delete_archived_learning_plan(jsonb) to authenticated");
  });

  it("records exact private paths before any database content is deleted", () => {
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("material.storage_path");
    expect(migration).toContain("path.value not like current_user_id::text || '/%'");
    expect(migration).toContain("char_length(path.value) > 1024");
    expect(migration).toContain("plan_deletion_shared_learning_item");
    expect(migration).toContain("plan_deletion_shared_material_path");

    const receipt = migration.indexOf("insert into public.account_deletion_cleanup_jobs");
    const chunks = migration.indexOf("delete from public.material_chunks");
    const item = migration.indexOf("delete from public.learning_items");
    expect(receipt).toBeGreaterThan(0);
    expect(chunks).toBeGreaterThan(receipt);
    expect(item).toBeGreaterThan(chunks);
  });

  it("relies on existing cascades only after explicitly removing orphan-prone chunks", () => {
    expect(migration).toContain("material_id = any(material_ids)");
    expect(migration).toContain("deletedlearningitemid");
    expect(migration).toContain("cleanupjobid");
    expect(migration).not.toContain("delete from auth.users");
  });
});
