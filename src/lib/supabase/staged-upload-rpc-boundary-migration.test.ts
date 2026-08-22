import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const compatibilityMigration = readFileSync(
  new URL("../../../supabase/migrations/202608210007_late_upload_cleanup_receipts.sql", import.meta.url),
  "utf8",
);
const enforcementMigration = readFileSync(
  new URL("../../../supabase/migrations/202608210010_enforce_staged_upload_rpc_boundary.sql", import.meta.url),
  "utf8",
);

describe("phased staged-upload RPC boundary", () => {
  it("keeps old application instances functional and receipt-safe after phase 1", () => {
    expect(compatibilityMigration).toContain('create policy "material_uploads_owner_insert"');
    expect(compatibilityMigration).toContain('create policy "material_uploads_owner_delete"');
    expect(compatibilityMigration).toContain("create trigger capture_material_upload_delete_receipt");
    expect(compatibilityMigration).toContain("before delete on public.material_uploads");
    expect(compatibilityMigration).toContain("pg_catalog.hashtext('yova_learning_data')");
    expect(compatibilityMigration).toContain("security definer\nset search_path = ''");
    expect(compatibilityMigration).toContain("receipt.storage_path = new.storage_path");
    expect(compatibilityMigration).not.toContain(
      "drop policy if exists \"learning_material_objects_owner_insert\" on storage.objects;",
    );
  });

  it("removes compatibility writes only after the RPC-using app is live", () => {
    expect(enforcementMigration).toContain("PHASE 3 ONLY");
    expect(enforcementMigration).toContain(
      'drop policy if exists "material_uploads_owner_insert" on public.material_uploads',
    );
    expect(enforcementMigration).toContain(
      'drop policy if exists "material_uploads_owner_delete" on public.material_uploads',
    );
    expect(enforcementMigration).toContain(
      'drop policy if exists "learning_material_objects_owner_insert" on storage.objects',
    );
    expect(enforcementMigration).toContain(
      'drop policy if exists "learning_material_objects_owner_update" on storage.objects',
    );
    expect(enforcementMigration).toContain(
      'create policy "learning_material_objects_owner_update" on storage.objects',
    );
    expect(enforcementMigration).toContain(
      'drop policy if exists "learning_material_objects_owner_select" on storage.objects',
    );
    expect(enforcementMigration).toContain(
      'create policy "learning_material_objects_owner_select" on storage.objects',
    );
    expect(enforcementMigration).toContain("upload.storage_path = name");
    expect(enforcementMigration).toContain("upload.expires_at > pg_catalog.clock_timestamp()");
    expect(enforcementMigration).toContain("upload.cleanup_claimed_at is null");
    expect(enforcementMigration).toContain("private_storage_capability_boundaries");
    expect(enforcementMigration).toContain("interval '2 hours 20 minutes'");
    expect(enforcementMigration).toContain("discover_orphaned_learning_material_objects(10000)");
    expect(enforcementMigration).toContain("final_sweep_after = greatest");
  });
});
