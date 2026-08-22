import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL("../../../supabase/migrations/202608210007_late_upload_cleanup_receipts.sql", import.meta.url),
  "utf8",
);
const archivedPlanMigration = readFileSync(
  new URL("../../../supabase/migrations/202608180004_delete_archived_learning_plans.sql", import.meta.url),
  "utf8",
);

describe("late signed-upload cleanup receipt migration", () => {
  it("keeps an ownerless, content-free exact-path receipt through the capability TTL", () => {
    expect(migration).toContain("create table public.private_storage_cleanup_receipts");
    expect(migration).toContain("user_id uuid not null,");
    expect(migration).not.toMatch(/private_storage_cleanup_receipts[\s\S]{0,500}references auth[.]users/i);
    expect(migration).not.toMatch(/private_storage_cleanup_receipts[\s\S]{0,700}(extracted_text|metadata|chunk_text)/i);
    expect(migration).toContain("pg_catalog.clock_timestamp() + interval '2 hours 10 minutes'");
    expect(migration).not.toContain("upload.created_at + interval '2 hours 10 minutes'");
    expect(migration).toContain("final_sweep_after <= pg_catalog.clock_timestamp()");
    expect(migration).toContain("initial_swept_at = pg_catalog.clock_timestamp()");
    expect(migration).toContain("delete from public.private_storage_cleanup_receipts");
    expect(migration).toContain("legacy_opaque_path boolean not null default false");
    expect(migration).toContain("enqueue_legacy_private_storage_cleanup_receipt");
  });

  it("makes logical cancellation atomic before returning an immediate sweep claim", () => {
    const cancel = functionBody("claim_material_upload_cleanup");
    const receipt = cancel.indexOf("enqueue_private_storage_cleanup_receipt");
    const chunks = cancel.indexOf("delete from public.material_chunks");
    const staging = cancel.indexOf("delete from public.material_uploads");
    const claim = cancel.indexOf("cleanup_claimed_at = pg_catalog.clock_timestamp()");

    expect(receipt).toBeGreaterThan(-1);
    expect(chunks).toBeGreaterThan(receipt);
    expect(staging).toBeGreaterThan(chunks);
    expect(claim).toBeGreaterThan(staging);
    expect(cancel).toContain("pg_catalog.clock_timestamp() + interval '2 hours 10 minutes'");
    const missingBranch = cancel.indexOf("if not found then");
    expect(cancel.indexOf("from public.materials as material", missingBranch)).toBeGreaterThan(missingBranch);
    expect(cancel.indexOf("'status', 'durable'", missingBranch)).toBeGreaterThan(missingBranch);
    expect(cancel.indexOf("'status', 'missing_unconfirmed'", missingBranch)).toBeGreaterThan(
      cancel.indexOf("'status', 'durable'", missingBranch),
    );
  });

  it("serializes reset against stage creation and both promotion transactions", () => {
    const createUpload = functionBody("create_material_upload");
    const reset = functionBody("reset_yova_learning_data");
    expect(createUpload).toContain("pg_catalog.hashtext('yova_learning_data')");
    expect(createUpload).toContain("private_material_upload_rpc_transactions");
    expect(createUpload).toContain("pg_catalog.txid_current()");
    expect(reset).toContain("pg_catalog.hashtext('yova_learning_data')");
    expect(reset).toContain("private_learning_data_reset_boundaries");
    expect(reset).toContain("reset_completed_at + interval '2 hours 10 minutes'");
    const guard = functionBody("guard_material_upload_lifecycle_identity");
    expect(guard).toContain("delete from public.private_material_upload_rpc_transactions");
    expect(guard).toContain("and not trusted_rpc_transaction");
    expect(guard).toContain("compatibility_writes_blocked_until > pg_catalog.clock_timestamp()");
    expect(migration).toContain("'public.save_generated_plan(jsonb)'",
    );
    expect(migration).toContain("'public.attach_materials_to_plan(jsonb)'",
    );
    expect(migration).toContain("reset lock was not installed");
    expect(migration).toContain("create trigger capture_material_upload_delete_receipt");
    expect(migration).toContain('create policy "material_uploads_owner_insert"');
    expect(migration).toContain("grant execute on function public.create_material_upload(jsonb) to authenticated");
  });

  it("rechecks the reset embargo after a legacy insert waits on the advisory lock", () => {
    const guard = functionBody("guard_material_upload_lifecycle_identity");
    const lock = guard.indexOf("pg_catalog.pg_advisory_xact_lock");
    const consumeMarker = guard.indexOf("delete from public.private_material_upload_rpc_transactions");
    const resetFence = guard.indexOf("compatibility_writes_blocked_until");
    expect(lock).toBeGreaterThan(-1);
    expect(consumeMarker).toBeGreaterThan(lock);
    expect(resetFence).toBeGreaterThan(consumeMarker);
    expect(guard).toContain("trusted_rpc_transaction := found");

    const createUpload = functionBody("create_material_upload");
    expect(createUpload.indexOf("private_material_upload_rpc_transactions")).toBeGreaterThan(
      createUpload.indexOf("pg_catalog.pg_advisory_xact_lock"),
    );
    expect(createUpload.indexOf("insert into public.material_uploads")).toBeGreaterThan(
      createUpload.indexOf("private_material_upload_rpc_transactions"),
    );
  });

  it("records reset and account-deletion paths before deleting data or Auth", () => {
    const reset = functionBody("reset_yova_learning_data");
    const resetReceipt = reset.indexOf("enqueue_legacy_private_storage_cleanup_receipt");
    expect(resetReceipt).toBeGreaterThan(-1);
    expect(reset.indexOf("delete from public.material_chunks")).toBeGreaterThan(resetReceipt);
    expect(reset.indexOf("delete from public.learning_items")).toBeGreaterThan(resetReceipt);
    expect(reset).toContain("select upload.storage_path from public.material_uploads");

    const deletion = functionBody("delete_yova_account");
    const deletionReceipt = deletion.indexOf("enqueue_legacy_private_storage_cleanup_receipt");
    expect(deletionReceipt).toBeGreaterThan(-1);
    expect(deletion.indexOf("insert into public.account_deletion_cleanup_jobs")).toBeGreaterThan(deletionReceipt);
    expect(deletion.indexOf("delete from auth.users")).toBeGreaterThan(deletionReceipt);
    expect(deletion).toContain("select upload.storage_path from public.material_uploads");
    expect(reset).toContain("reset_at + interval '2 hours 10 minutes'");
    expect(deletion).toContain("deletion_at + interval '2 hours 10 minutes'");
  });

  it("adds retained receipts to every future archived-plan material deletion", () => {
    expect(migration).toContain("'public.delete_archived_learning_plan(jsonb)'::pg_catalog.regprocedure");
    expect(migration).toContain("delete_archived_learning_plan receipt boundary changed; retained sweep was not installed");
    const planHardening = migration.indexOf("-- Permanent archived-goal deletion");
    const enqueue = migration.indexOf("enqueue_legacy_private_storage_cleanup_receipt", planHardening);
    const legacyJob = migration.indexOf("insert into public.account_deletion_cleanup_jobs", enqueue);
    expect(enqueue).toBeGreaterThan(planHardening);
    expect(legacyJob).toBeGreaterThan(enqueue);
    expect(migration.slice(enqueue, legacyJob)).toContain(
      "pg_catalog.clock_timestamp() + interval '2 hours 10 minutes'",
    );
    const deployedInsert = `  insert into public.account_deletion_cleanup_jobs (
    id,
    user_id,
    learning_material_paths,
    account_export_paths
  ) values (
    cleanup_job_id,
    current_user_id,
    learning_paths,
    '{}'::text[]
  );`;
    expect(archivedPlanMigration).toContain(deployedInsert);
    expect(migration).toContain(`legacy_receipt_source text := $source$\n${deployedInsert}\n$source$;`);
    const retainedBlock = migration.slice(enqueue, migration.indexOf("\n$source$;", enqueue));
    expect(retainedBlock).toContain("array(\n      select cleanup_path.value");
  });

  it("fails closed for durable collisions and never lets the receipt worker delete a durable path", () => {
    const collision = migration.indexOf("material_upload_cleanup_durable_collision_requires_review");
    const legacyChunkDelete = migration.indexOf("delete from public.material_chunks", collision);
    expect(collision).toBeGreaterThan(-1);
    expect(legacyChunkDelete).toBeGreaterThan(collision);
    const collisionPreflight = migration.slice(
      migration.lastIndexOf("if exists (", collision),
      collision,
    );
    expect(collisionPreflight).toContain("join public.materials as durable");
    expect(collisionPreflight).not.toContain("where staged.cleanup_claimed_at");
    expect(functionBody("guard_material_upload_lifecycle_identity")).toContain(
      "where material.id = new.id and material.user_id = new.user_id",
    );
    expect(functionBody("guard_material_upload_lifecycle_identity")).toContain(
      "receipt.storage_path = new.storage_path",
    );
    expect(functionBody("guard_material_upload_lifecycle_identity")).toContain(
      "receipt.source_material_id = new.id",
    );
    expect(functionBody("capture_material_upload_delete_receipt")).toContain(
      "material.storage_path is distinct from old.storage_path",
    );

    const claim = functionBody("claim_private_storage_cleanup_receipts");
    expect(claim).toContain("receipt.bucket_id = 'learning-materials'");
    expect(claim).toContain("material.storage_path = receipt.storage_path");
    expect(claim).toContain("upload.storage_path = receipt.storage_path");
    expect(claim).toContain("upload.expires_at > pg_catalog.clock_timestamp()");
  });

  it("prevents malformed paths from poisoning cleanup and closes ordinary late reads/writes", () => {
    expect(migration).toContain("material_uploads_exact_storage_path_check");
    expect(migration).toContain("material_uploads_bounded_lifetime_check");
    expect(migration).toContain(
      "staged.created_at > pg_catalog.clock_timestamp() + interval '5 minutes'",
    );
    expect(migration).toContain(
      "staged.expires_at > staged.created_at + interval '24 hours 1 minute'",
    );
    expect(migration).toContain("storage_path !~ '/\\.{1,2}$'");
    expect(migration).toContain("storage_path !~ '[[:cntrl:]]'");
    expect(migration).toContain("material_upload_lifecycle_immutable");
    const guardStart = migration.lastIndexOf(
      "create or replace function public.guard_material_upload_lifecycle_identity",
    );
    expect(migration.slice(guardStart, migration.indexOf("\n$$;", guardStart))).toContain(
      "security definer",
    );
    expect(migration).toContain('create policy "learning_material_objects_owner_select"');
    expect(migration).toContain("upload.storage_path = name");
    expect(migration).toContain("and upload.cleanup_claimed_at is null");
    expect(migration).toContain("material.storage_path = name");
  });

  it("keeps receipt mutation private and runs through leased service-role RPCs", () => {
    expect(migration).toContain(
      "revoke all on table public.private_storage_cleanup_receipts\nfrom public, anon, authenticated, service_role",
    );
    expect(migration).toContain(
      "grant execute on function public.claim_private_storage_cleanup_receipts(integer) to service_role",
    );
    expect(migration).not.toContain(
      "grant execute on function public.claim_private_storage_cleanup_receipts(integer) to authenticated",
    );
  });

  it("backfills and repeatedly discovers legacy or late-token orphan objects", () => {
    const discovery = functionBody("discover_orphaned_learning_material_objects");
    expect(discovery).toContain("from storage.objects as object");
    expect(discovery).toContain("not exists (\n        select 1 from public.materials as material");
    expect(discovery).toContain("not exists (\n        select 1 from public.material_uploads as upload");
    expect(discovery).toContain("pg_catalog.pg_try_advisory_xact_lock");
    expect(discovery).toContain("enqueue_legacy_private_storage_cleanup_receipt");
    expect(discovery).toContain("boundary.discovery_required_until");
    expect(migration).toContain("select public.discover_orphaned_learning_material_objects(10000)");
    expect(functionBody("claim_private_storage_cleanup_receipts")).toContain(
      "perform public.discover_orphaned_learning_material_objects(requested_limit)",
    );
  });

  it("lets reset and deletion inventory hostile owner keys without rolling back", () => {
    const reset = functionBody("reset_yova_learning_data");
    const deletion = functionBody("delete_yova_account");
    for (const body of [reset, deletion]) {
      expect(body).toContain("enqueue_legacy_private_storage_cleanup_receipt");
      expect(body).toContain("char_length(path) between 38 and 1024");
      expect(body).toContain("path like current_user_id::text || '/%'");
    }
    expect(migration).toContain("legacy_private_storage_cleanup_path_invalid");
  });
});

function functionBody(name: string) {
  const start = migration.lastIndexOf(`create or replace function public.${name}`);
  expect(start).toBeGreaterThan(-1);
  const end = migration.indexOf("\n$$;", start);
  expect(end).toBeGreaterThan(start);
  return migration.slice(start, end);
}
