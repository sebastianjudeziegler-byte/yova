import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/202608160001_complete_learning_data_reset.sql"),
  "utf8",
);
const [mappingPersistence = "", resetFunction = ""] = migration.split(
  "create or replace function public.reset_yova_learning_data()",
);
const learnerTransactionLock = `perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('yova_learning_data'),
    pg_catalog.hashtext(current_user_id::text)
  )`;

describe("complete learning-data reset migration", () => {
  it("atomically abandons in-flight mapping after its owned source is gone", () => {
    expect(mappingPersistence).toContain(
      "create or replace function public.persist_material_mapping_result(",
    );
    expect(mappingPersistence).toContain("security invoker\nset search_path = ''");
    expect(mappingPersistence).toContain(
      "jsonb_typeof(requested_metadata_patch) is distinct from 'object'",
    );
    expect(mappingPersistence).toContain(learnerTransactionLock);
    expect(mappingPersistence.match(/for update;/g)).toHaveLength(2);
    expect(mappingPersistence).toContain("if material_exists is not true then\n    return false");
    expect(mappingPersistence.indexOf("return false")).toBeLessThan(
      mappingPersistence.indexOf("insert into public.material_chunks"),
    );
    expect(mappingPersistence.indexOf("return false")).toBeLessThan(
      mappingPersistence.indexOf("insert into public.product_events"),
    );
    expect(mappingPersistence).toContain(
      "revoke all on function public.persist_material_mapping_result(text, uuid, jsonb, jsonb, jsonb) from public",
    );
    expect(mappingPersistence).toContain(
      "grant execute on function public.persist_material_mapping_result(text, uuid, jsonb, jsonb, jsonb) to authenticated",
    );
  });

  it("serializes Reset with the complete mapping-persistence transaction", () => {
    expect(resetFunction).toContain(learnerTransactionLock);
    expect(resetFunction.indexOf(learnerTransactionLock)).toBeLessThan(
      resetFunction.indexOf("delete from public.material_chunks"),
    );
  });

  it("replaces the reset function with the protected authenticated RPC", () => {
    expect(migration).toContain("create or replace function public.reset_yova_learning_data()");
    expect(resetFunction).toContain("security definer\nset search_path = ''");
    expect(resetFunction).toContain("current_user_id uuid := auth.uid()");
    expect(resetFunction).toContain("if current_user_id is null then");
    expect(resetFunction).toContain("raise exception 'Authentication is required.'");
    expect(migration).toContain(
      "revoke all on function public.reset_yova_learning_data() from public",
    );
    expect(migration).toContain(
      "grant execute on function public.reset_yova_learning_data() to authenticated",
    );
  });

  it("deletes every current category promised by Reset learning data", () => {
    for (const table of [
      "material_chunks",
      "deadline_milestones",
      "learning_events",
      "learning_items",
      "tutor_threads",
      "material_uploads",
      "learner_profiles",
      "product_events",
      "error_reports",
    ]) {
      expect(migration).toContain(
        `delete from public.${table}\n  where user_id = current_user_id`,
      );
    }

    expect(migration).toContain(
      "update public.profiles\n  set onboarding_completed_at = null\n  where id = current_user_id",
    );
  });

  it("removes unlinked records before relying on learning-item cascades", () => {
    const learningItemsDelete = migration.indexOf("delete from public.learning_items");
    expect(migration.indexOf("delete from public.material_chunks")).toBeLessThan(learningItemsDelete);
    expect(migration.indexOf("delete from public.deadline_milestones")).toBeLessThan(
      learningItemsDelete,
    );
    expect(migration.indexOf("delete from public.learning_events")).toBeLessThan(
      learningItemsDelete,
    );
  });

  it("retains limited operational and access-control records", () => {
    for (const table of [
      "ai_usage_windows",
      "support_requests",
      "founder_accounts",
      "tester_invites",
    ]) {
      expect(migration).not.toContain(`delete from public.${table}`);
    }
  });
});
