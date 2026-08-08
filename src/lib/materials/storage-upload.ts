type StorageResult<T> = Promise<{ data: T | null; error: unknown | null }>;

export type PrivateMaterialBucket = {
  download: (path: string) => StorageResult<Blob>;
  remove: (paths: string[]) => StorageResult<unknown>;
  upload: (
    path: string,
    file: File,
    options: { contentType: string; upsert: boolean },
  ) => StorageResult<unknown>;
};

export type StoredMaterialResult =
  | { ok: true; disposition: "uploaded" | "already-present" | "replaced-partial" }
  | { ok: false; reason: "remove-partial" | "upload" };

/**
 * Completes the same-origin upload fallback without requiring an UPDATE.
 *
 * A browser privacy extension can report that a signed upload failed after
 * Supabase already received the object. We first verify that case. If an
 * interrupted upload left a partial object, we remove it and perform a fresh
 * owner-scoped INSERT. This works with the base private-storage policies and
 * avoids stranding a learner on an opaque upload error.
 */
export async function storePrivateMaterial(
  bucket: PrivateMaterialBucket,
  storagePath: string,
  file: File,
  contentType: string,
): Promise<StoredMaterialResult> {
  const existing = await bucket.download(storagePath);
  let replacedPartial = false;

  if (!existing.error && existing.data) {
    if (existing.data.size === file.size) {
      return { ok: true, disposition: "already-present" };
    }

    const removed = await bucket.remove([storagePath]);
    if (removed.error) return { ok: false, reason: "remove-partial" };
    replacedPartial = true;
  }

  const uploaded = await bucket.upload(storagePath, file, {
    contentType,
    upsert: false,
  });
  if (!uploaded.error) {
    return { ok: true, disposition: replacedPartial ? "replaced-partial" : "uploaded" };
  }

  // A concurrent signed upload may have completed between the first check and
  // the fallback INSERT. Verify the object before reporting a failure.
  const afterFailure = await bucket.download(storagePath);
  if (!afterFailure.error && afterFailure.data?.size === file.size) {
    return { ok: true, disposition: "already-present" };
  }

  return { ok: false, reason: "upload" };
}
