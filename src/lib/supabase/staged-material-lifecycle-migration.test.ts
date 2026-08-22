import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL("../../../supabase/migrations/202608210006_staged_material_lifecycle.sql", import.meta.url),
  "utf8",
);

describe("staged material lifecycle migration", () => {
  it("fences mapping and durable promotion after expiration", () => {
    expect(migration).toContain("before update of processing_status, extracted_text, metadata");
    expect(migration).toContain("old.expires_at <= pg_catalog.clock_timestamp() or old.cleanup_claimed_at is not null");
    expect(migration).toContain("before insert on public.materials");
    expect(migration).toContain("select upload.expires_at, upload.cleanup_claimed_at");
    expect(migration).toContain("for update;");
    expect(migration).toContain("if not found then");
    expect(migration).toContain("staged_expires_at <= pg_catalog.clock_timestamp()");
    expect(migration).toContain("message = 'material_staging_expired'");
  });

  it("fails fast in both promotion sources when staging is expired or leased", () => {
    expect(migration).toContain("'public.save_generated_plan(jsonb)'::pg_catalog.regprocedure");
    expect(migration).toContain("'public.attach_materials_to_plan(jsonb)'::pg_catalog.regprocedure");
    expect(migration.match(/upload\.expires_at > pg_catalog\.clock_timestamp\(\)/g)).toHaveLength(2);
    expect(migration.match(/upload\.cleanup_claimed_at is null;/g)).toHaveLength(2);
    expect(migration).toContain(
      "save_generated_plan promotion source changed; staged expiry fence was not installed",
    );
    expect(migration).toContain(
      "attach_materials_to_plan promotion source changed; staged expiry fence was not installed",
    );
  });

  it("leases only expired non-durable staging rows with skip-locked batching", () => {
    expect(migration).toContain("function public.claim_expired_material_uploads");
    expect(migration).toContain("upload.expires_at <= now()");
    expect(migration).toContain("not exists (\n        select 1 from public.materials");
    expect(migration).toContain("for update skip locked");
    expect(migration).toContain("cleanup_claimed_at <= now() - interval '10 minutes'");
  });

  it("makes explicit cancellation immediately unusable and token-confirms deletion", () => {
    const expire = migration.indexOf("set expires_at = least(expires_at, now())");
    const claim = migration.indexOf("cleanup_claimed_at = now()", expire);
    expect(expire).toBeGreaterThan(-1);
    expect(claim).toBeGreaterThan(expire);
    expect(migration).toContain("upload.cleanup_token = requested_cleanup_token");
    expect(migration.indexOf("delete from public.material_chunks"))
      .toBeLessThan(migration.indexOf("delete from public.material_uploads"));
    expect(migration).toContain("grant execute on function public.claim_material_upload_cleanup(uuid) to authenticated");
    expect(migration).toContain("grant execute on function public.claim_expired_material_uploads(integer) to service_role");
  });
});
