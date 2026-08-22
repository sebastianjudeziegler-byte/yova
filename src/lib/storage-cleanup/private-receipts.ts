import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { retrySupabaseRpc } from "@/lib/supabase/retry-rpc";

const PRIVATE_BUCKETS = new Set(["learning-materials", "account-exports"]);

type CleanupClaim = {
  cleanup_receipt_id: string;
  user_id: string;
  bucket_id: string;
  storage_path: string;
  legacy_opaque_path: boolean;
  cleanup_token: string;
  sweep_phase: "initial" | "final";
};

export type PrivateStorageCleanupResult = {
  ok: boolean;
  claimedReceipts: number;
  sweptReceipts: number;
  retryReceipts: number;
};

/**
 * Sweeps exact private Storage paths from durable, ownerless receipts.
 *
 * Confirmation is intentionally a database decision: an initial sweep marks
 * the receipt but retains it until its signed-upload capability deadline. A
 * sweep at or after that deadline is the only operation that may delete the
 * receipt, closing the late-upload window without retaining learner content.
 */
export async function cleanupPrivateStorageReceipts(
  admin: SupabaseClient,
  { limit = 250 }: { limit?: number } = {},
): Promise<PrivateStorageCleanupResult> {
  const requestedLimit = Math.max(1, Math.min(Math.trunc(limit), 1_000));
  const { data, error } = await retrySupabaseRpc(
    "claim_private_storage_cleanup_receipts",
    () => admin.rpc("claim_private_storage_cleanup_receipts", {
      requested_limit: requestedLimit,
    }),
  );
  if (error || !Array.isArray(data)) return failedResult();

  let sweptReceipts = 0;
  let retryReceipts = 0;
  for (const value of data as unknown[]) {
    const claim = parseClaim(value);
    if (!claim) {
      retryReceipts += 1;
      continue;
    }

    try {
      const { error: removeError } = await admin.storage
        .from(claim.bucket_id)
        .remove([claim.storage_path]);
      if (removeError) {
        await releaseClaim(admin, claim);
        retryReceipts += 1;
        continue;
      }

      const { data: confirmed, error: confirmError } = await admin.rpc(
        "confirm_private_storage_cleanup_receipt",
        {
          requested_cleanup_receipt_id: claim.cleanup_receipt_id,
          requested_cleanup_token: claim.cleanup_token,
        },
      );
      if (confirmError || confirmed !== true) {
        await releaseClaim(admin, claim);
        retryReceipts += 1;
        continue;
      }
      sweptReceipts += 1;
    } catch {
      await releaseClaim(admin, claim);
      retryReceipts += 1;
    }
  }

  return {
    ok: retryReceipts === 0,
    claimedReceipts: data.length,
    sweptReceipts,
    retryReceipts,
  };
}

function parseClaim(value: unknown): CleanupClaim | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const claim = value as Partial<CleanupClaim>;
  if (
    typeof claim.cleanup_receipt_id !== "string"
    || typeof claim.user_id !== "string"
    || typeof claim.bucket_id !== "string"
    || typeof claim.storage_path !== "string"
    || typeof claim.legacy_opaque_path !== "boolean"
    || typeof claim.cleanup_token !== "string"
    || (claim.sweep_phase !== "initial" && claim.sweep_phase !== "final")
    || !isUuid(claim.cleanup_receipt_id)
    || !isUuid(claim.user_id)
    || !isUuid(claim.cleanup_token)
    || !PRIVATE_BUCKETS.has(claim.bucket_id)
    || !isExactOwnerPath(claim.storage_path, claim.user_id, claim.legacy_opaque_path)
  ) return null;
  return claim as CleanupClaim;
}

function isExactOwnerPath(storagePath: string, userId: string, legacyOpaquePath: boolean) {
  const ownerBounded = storagePath.length > userId.length + 1
    && storagePath.length <= 1_024
    && storagePath.startsWith(`${userId}/`);
  if (!ownerBounded || legacyOpaquePath) return ownerBounded;
  return !storagePath.includes("//")
    && !storagePath.includes("/../")
    && !storagePath.includes("/./")
    && !/[\u0000-\u001f\u007f]/.test(storagePath);
}

async function releaseClaim(admin: SupabaseClient, claim: CleanupClaim) {
  try {
    await admin.rpc("release_private_storage_cleanup_receipt", {
      requested_cleanup_receipt_id: claim.cleanup_receipt_id,
      requested_cleanup_token: claim.cleanup_token,
    });
  } catch {
    // The bounded lease expires by itself; a later cleanup run can reclaim it.
  }
}

function failedResult(): PrivateStorageCleanupResult {
  return { ok: false, claimedReceipts: 0, sweptReceipts: 0, retryReceipts: 0 };
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
