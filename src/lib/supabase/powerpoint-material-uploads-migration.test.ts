import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL("../../../supabase/migrations/202609170001_powerpoint_material_uploads.sql", import.meta.url),
  "utf8",
);
const quotaMigration = readFileSync(
  new URL("../../../supabase/migrations/202609040002_storage_and_untrusted_write_quotas.sql", import.meta.url),
  "utf8",
);
const pptxMimeType = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

describe("PowerPoint material upload migration", () => {
  it("extends both Storage and staging admission without changing privacy or size limits", () => {
    const storageUpdate = migration.slice(
      migration.indexOf("update storage.buckets"),
      migration.indexOf("alter table public.material_uploads"),
    );
    expect(storageUpdate).toContain(pptxMimeType);
    expect(storageUpdate).toContain("where id = 'learning-materials'");
    expect(storageUpdate).not.toMatch(/\b(public|file_size_limit)\s*=/);
    const constraint = migration.slice(
      migration.indexOf("alter table public.material_uploads"),
      migration.indexOf("create or replace function"),
    );
    expect(constraint).toContain("drop constraint material_uploads_mime_type_check");
    expect(constraint).toContain("add constraint material_uploads_mime_type_check");
    expect(constraint).toContain(pptxMimeType);
  });

  it("preserves the audited quota and receipt boundary byte for byte except for the MIME list", () => {
    const previous = uploadBoundary(quotaMigration);
    const current = uploadBoundary(migration);
    expect(current).toContain(pptxMimeType);
    expect(current.replace(`, '${pptxMimeType}'`, "")).toBe(previous);
  });

  it("fails fast on a busy schema deployment without reopening direct upload writes", () => {
    expect(migration).toContain("lock table public.material_uploads, storage.buckets");
    expect(migration).toContain("in access exclusive mode nowait");
    expect(migration).not.toMatch(/disable row level security|drop policy|grant\s+(insert|all)\s+on\s+(table\s+)?public\.material_uploads/i);
  });
});

function uploadBoundary(sql: string) {
  const start = sql.indexOf("create or replace function public.create_material_upload(payload jsonb)");
  const finalGrant = "grant execute on function public.create_material_upload(jsonb) to authenticated;";
  const end = sql.indexOf(finalGrant, start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return sql.slice(start, end + finalGrant.length);
}
