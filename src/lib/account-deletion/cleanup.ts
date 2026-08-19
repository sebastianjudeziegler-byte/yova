import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { ACCOUNT_EXPORT_BUCKET } from "@/lib/account-export/schema";
import { retrySupabaseRpc } from "@/lib/supabase/retry-rpc";

const LEARNING_MATERIALS_BUCKET = "learning-materials";

type CleanupClaim = {
  cleanup_job_id: string;
  user_id: string;
  learning_material_paths: string[];
  account_export_paths: string[];
  cleanup_token: string;
};

export type AccountDeletionCleanupResult = {
  ok: boolean;
  claimedJobs: number;
  removedJobs: number;
  retryJobs: number;
};

export async function cleanupDeletedAccountStorage(
  admin: SupabaseClient,
  { limit = 100 }: { limit?: number } = {},
): Promise<AccountDeletionCleanupResult> {
  const requestedLimit = Math.max(1, Math.min(Math.trunc(limit), 500));
  const { data, error } = await retrySupabaseRpc(
    "claim_account_deletion_cleanup_jobs",
    () => admin.rpc("claim_account_deletion_cleanup_jobs", {
      requested_limit: requestedLimit,
    }),
  );
  if (error || !Array.isArray(data)) return failedResult();

  let removedJobs = 0;
  let retryJobs = 0;
  for (const value of data as unknown[]) {
    const claim = parseClaim(value);
    if (!claim) {
      retryJobs += 1;
      continue;
    }

    const learningRemoved = await removePaths(
      admin,
      LEARNING_MATERIALS_BUCKET,
      claim.learning_material_paths,
    );
    const exportsRemoved = learningRemoved && await removePaths(
      admin,
      ACCOUNT_EXPORT_BUCKET,
      claim.account_export_paths,
    );
    if (!learningRemoved || !exportsRemoved) {
      await releaseClaim(admin, claim);
      retryJobs += 1;
      continue;
    }

    const { data: confirmed, error: confirmError } = await admin.rpc(
      "confirm_account_deletion_cleanup",
      {
        requested_cleanup_job_id: claim.cleanup_job_id,
        requested_cleanup_token: claim.cleanup_token,
      },
    );
    if (confirmError || confirmed !== true) {
      await releaseClaim(admin, claim);
      retryJobs += 1;
      continue;
    }
    removedJobs += 1;
  }

  return {
    ok: retryJobs === 0,
    claimedJobs: data.length,
    removedJobs,
    retryJobs,
  };
}

function parseClaim(value: unknown): CleanupClaim | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const claim = value as Partial<CleanupClaim>;
  if (
    typeof claim.cleanup_job_id !== "string"
    || typeof claim.user_id !== "string"
    || typeof claim.cleanup_token !== "string"
    || !isUuid(claim.cleanup_job_id)
    || !isUuid(claim.user_id)
    || !isUuid(claim.cleanup_token)
    || !validPathList(claim.user_id, claim.learning_material_paths)
    || !validPathList(claim.user_id, claim.account_export_paths)
  ) return null;
  return claim as CleanupClaim;
}

function validPathList(userId: string, value: unknown): value is string[] {
  return Array.isArray(value)
    && value.length <= 10_000
    && value.every((path) => typeof path === "string"
      && path.length <= 1_024
      && path.startsWith(`${userId}/`)
      && !path.includes("/../")
      && !path.includes("//"));
}

async function removePaths(admin: SupabaseClient, bucket: string, paths: string[]) {
  for (let index = 0; index < paths.length; index += 1_000) {
    const { error } = await admin.storage.from(bucket).remove(paths.slice(index, index + 1_000));
    if (error) return false;
  }
  return true;
}

async function releaseClaim(admin: SupabaseClient, claim: CleanupClaim) {
  await admin.rpc("release_account_deletion_cleanup", {
    requested_cleanup_job_id: claim.cleanup_job_id,
    requested_cleanup_token: claim.cleanup_token,
  });
}

function failedResult(): AccountDeletionCleanupResult {
  return { ok: false, claimedJobs: 0, removedJobs: 0, retryJobs: 0 };
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
