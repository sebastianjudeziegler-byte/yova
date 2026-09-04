type StorageResult<T> = Promise<{ data: T | null; error: unknown | null }>;

export type PrivateMaterialBucket = {
  download: (path: string) => StorageResult<Blob>;
  // Present on Supabase's bucket API, but deliberately never called here.
  remove: (paths: string[]) => StorageResult<unknown>;
  upload: (
    path: string,
    file: File,
    options: { contentType: string; upsert: boolean },
  ) => StorageResult<unknown>;
};

export type StoredMaterialResult =
  | { ok: true; disposition: "uploaded" | "already-present" }
  | { ok: false; reason: "object-conflict" | "upload" };

/**
 * Completes the same-origin upload fallback without requiring an UPDATE.
 *
 * A browser privacy extension can report that a signed upload failed after
 * Supabase already received the object. We first verify that case. If a
 * different object already occupies the path, fail closed and require a new
 * stage instead of deleting through a service credential. The staging row can
 * be promoted or cancelled while Storage I/O is in flight, so this helper must
 * never infer that an existing object is still a disposable partial upload.
 * The route verifies the owner-scoped staging row first, then supplies a
 * server-authorized bucket so browser credentials never need replayable
 * Storage UPDATE or DELETE policies.
 */
export async function storePrivateMaterial(
  bucket: PrivateMaterialBucket,
  storagePath: string,
  file: File,
  contentType: string,
): Promise<StoredMaterialResult> {
  const existing = await bucket.download(storagePath);

  if (!existing.error && existing.data) {
    if (existing.data.size === file.size) {
      return { ok: true, disposition: "already-present" };
    }
    return { ok: false, reason: "object-conflict" };
  }

  const uploaded = await bucket.upload(storagePath, file, {
    contentType,
    upsert: false,
  });
  if (!uploaded.error) {
    return { ok: true, disposition: "uploaded" };
  }

  // A concurrent signed upload may have completed between the first check and
  // the fallback INSERT. Verify the object before reporting a failure.
  const afterFailure = await bucket.download(storagePath);
  if (!afterFailure.error && afterFailure.data?.size === file.size) {
    return { ok: true, disposition: "already-present" };
  }
  if (!afterFailure.error && afterFailure.data) {
    return { ok: false, reason: "object-conflict" };
  }

  return { ok: false, reason: "upload" };
}
