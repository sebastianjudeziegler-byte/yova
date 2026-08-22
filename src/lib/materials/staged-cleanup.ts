import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createSupabaseAdminClient,
  isSupabaseAdminConfigured,
} from "@/lib/supabase/admin";
import { retrySupabaseRpc } from "@/lib/supabase/retry-rpc";

const MATERIAL_BUCKET = "learning-materials";

type CleanupClaim = {
  materialId: string;
  userId: string;
  storagePath: string;
  cleanupToken: string;
};

type ExplicitClaimResponse =
  | { status: "missing_unconfirmed" }
  | { status: "durable" }
  | { status: "cleanup_pending" }
  | ({ status: "claimed" } & CleanupClaim);

export type StagedMaterialCancellationResult =
  | { status: "removed"; logicalRemovalCommitted: true }
  | { status: "durable"; logicalRemovalCommitted: false }
  | { status: "cleanup_pending"; logicalRemovalCommitted: true }
  | { status: "outcome_unconfirmed"; logicalRemovalCommitted: "unknown" };

export type StagedMaterialCleanupResult = {
  ok: boolean;
  claimedUploads: number;
  removedUploads: number;
  retryUploads: number;
};

type ClaimedMaterialSweepResult =
  | { status: "swept" }
  | { status: "cleanup_pending" };

/**
 * Atomically replaces one user-owned staging row with a content-free exact-path
 * receipt before deleting its current private object. The receipt survives a
 * successful immediate sweep until a second post-capability sweep completes.
 */
export async function cancelStagedMaterial(
  supabase: SupabaseClient,
  materialId: string,
): Promise<StagedMaterialCancellationResult> {
  let claimResult: { data: unknown; error: unknown };
  try {
    claimResult = await supabase.rpc("claim_material_upload_cleanup", {
      requested_material_id: materialId,
    });
  } catch {
    return { status: "outcome_unconfirmed", logicalRemovalCommitted: "unknown" };
  }

  if (claimResult.error) {
    return { status: "outcome_unconfirmed", logicalRemovalCommitted: "unknown" };
  }
  const response = parseExplicitClaim(claimResult.data);
  if (!response) {
    return { status: "outcome_unconfirmed", logicalRemovalCommitted: "unknown" };
  }
  if (response.status === "missing_unconfirmed") {
    return { status: "outcome_unconfirmed", logicalRemovalCommitted: "unknown" };
  }
  if (response.status === "durable") {
    return { status: "durable", logicalRemovalCommitted: false };
  }
  if (response.status === "cleanup_pending") {
    return { status: "cleanup_pending", logicalRemovalCommitted: true };
  }
  const sweep = await sweepClaimedMaterial(
    supabase,
    response,
    privateCleanupStorageClient(supabase),
  );
  // Even after a successful immediate delete, the signed upload capability
  // may recreate this exact object. The durable receipt remains pending until
  // a second post-capability sweep succeeds.
  return sweep.status === "swept"
    ? { status: "removed", logicalRemovalCommitted: true }
    : { status: "cleanup_pending", logicalRemovalCommitted: true };
}

/**
 * Atomically converts expired staging rows into bounded exact-path receipts.
 * Storage deletion is exact, confirmation is token fenced, and failed work is
 * released for a later cron run. The receipt worker owns the final TTL sweep.
 */
export async function cleanupExpiredStagedMaterials(
  admin: SupabaseClient,
  { limit = 250 }: { limit?: number } = {},
): Promise<StagedMaterialCleanupResult> {
  const requestedLimit = Math.max(1, Math.min(Math.trunc(limit), 1_000));
  const { data, error } = await retrySupabaseRpc(
    "claim_expired_material_uploads",
    () => admin.rpc("claim_expired_material_uploads", {
      requested_limit: requestedLimit,
    }),
  );
  if (error || !Array.isArray(data)) return failedCleanupResult();

  let removedUploads = 0;
  let retryUploads = 0;
  for (const value of data as unknown[]) {
    const claim = parseCronClaim(value);
    if (!claim) {
      retryUploads += 1;
      continue;
    }
    const result = await sweepClaimedMaterial(admin, claim, admin);
    if (result.status === "swept") removedUploads += 1;
    else retryUploads += 1;
  }

  return {
    ok: retryUploads === 0,
    claimedUploads: data.length,
    removedUploads,
    retryUploads,
  };
}

async function sweepClaimedMaterial(
  rpcClient: SupabaseClient,
  claim: CleanupClaim,
  storageClient: SupabaseClient,
): Promise<ClaimedMaterialSweepResult> {
  try {
    const { error: removeError } = await storageClient.storage
      .from(MATERIAL_BUCKET)
      .remove([claim.storagePath]);
    if (removeError) {
      await releaseClaim(rpcClient, claim);
      return { status: "cleanup_pending" };
    }

    const { data: confirmed, error: confirmError } = await rpcClient.rpc(
      "confirm_material_upload_cleanup",
      {
        requested_material_id: claim.materialId,
        requested_cleanup_token: claim.cleanupToken,
      },
    );
    if (confirmError || confirmed !== true) {
      await releaseClaim(rpcClient, claim);
      return { status: "cleanup_pending" };
    }
    return { status: "swept" };
  } catch {
    await releaseClaim(rpcClient, claim);
    return { status: "cleanup_pending" };
  }
}

function privateCleanupStorageClient(fallback: SupabaseClient) {
  if (!isSupabaseAdminConfigured()) return fallback;
  try {
    return createSupabaseAdminClient();
  } catch {
    return fallback;
  }
}

function parseExplicitClaim(value: unknown): ExplicitClaimResponse | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  // 006 returned `missing`; until 007's orphan inventory proves the absence,
  // that old response is just as ambiguous as the explicit new status.
  if (row.status === "missing" || row.status === "missing_unconfirmed") {
    return { status: "missing_unconfirmed" };
  }
  if (row.status === "durable" || row.status === "cleanup_pending") {
    return { status: row.status };
  }
  if (row.status !== "claimed") return null;
  const claim = parseClaim({
    materialId: row.materialId,
    userId: row.userId,
    storagePath: row.storagePath,
    cleanupToken: row.cleanupToken,
  });
  return claim ? { status: "claimed", ...claim } : null;
}

function parseCronClaim(value: unknown): CleanupClaim | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  return parseClaim({
    materialId: row.material_id,
    userId: row.user_id,
    storagePath: row.storage_path,
    cleanupToken: row.cleanup_token,
  });
}

function parseClaim(value: Record<string, unknown>): CleanupClaim | null {
  if (
    typeof value.materialId !== "string"
    || typeof value.userId !== "string"
    || typeof value.storagePath !== "string"
    || typeof value.cleanupToken !== "string"
    || !isUuid(value.materialId)
    || !isUuid(value.userId)
    || !isUuid(value.cleanupToken)
    || !isExactMaterialPath(value.storagePath, value.userId, value.materialId)
  ) return null;
  return value as CleanupClaim;
}

function isExactMaterialPath(storagePath: string, userId: string, materialId: string) {
  const prefix = `${userId}/${materialId}/`;
  if (!storagePath.startsWith(prefix)) return false;
  const filename = storagePath.slice(prefix.length);
  return filename.length > 0
    && filename.length <= 255
    && !filename.includes("/")
    && filename !== "."
    && filename !== "..";
}

async function releaseClaim(supabase: SupabaseClient, claim: CleanupClaim) {
  try {
    await supabase.rpc("release_material_upload_cleanup", {
      requested_material_id: claim.materialId,
      requested_cleanup_token: claim.cleanupToken,
    });
  } catch {
    // The ten-minute lease expires by itself; a later cron run can reclaim it.
  }
}

function failedCleanupResult(): StagedMaterialCleanupResult {
  return { ok: false, claimedUploads: 0, removedUploads: 0, retryUploads: 0 };
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
