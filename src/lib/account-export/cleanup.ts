import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  accountExportFinalPath,
  accountExportTempPath,
} from "@/lib/account-export/server";
import { ACCOUNT_EXPORT_BUCKET } from "@/lib/account-export/schema";

type ClaimedExportCleanup = {
  export_id: string;
  user_id: string;
  temp_storage_path: string;
  final_storage_path: string;
  cleanup_token: string;
};

export type AccountExportCleanupResult = {
  ok: boolean;
  claimedJobs: number;
  removedJobs: number;
  retryJobs: number;
};

/**
 * Claims only database-confirmed expired jobs, removes their two exact private
 * objects, then token-confirms each deletion. A failed Storage operation
 * releases its lease so a later cron run can retry it.
 */
export async function cleanupExpiredAccountExports(
  admin: SupabaseClient,
  { limit = 250 }: { limit?: number } = {},
): Promise<AccountExportCleanupResult> {
  const requestedLimit = Math.max(1, Math.min(Math.trunc(limit), 1_000));
  const { data, error } = await admin.rpc("claim_expired_account_data_exports", {
    requested_limit: requestedLimit,
  });
  if (error || !Array.isArray(data)) return failedResult();

  const claims = data as unknown[];
  let removedJobs = 0;
  let retryJobs = 0;

  for (const value of claims) {
    const claim = parseClaim(value);
    if (!claim) {
      retryJobs += 1;
      continue;
    }

    const { error: removeError } = await admin.storage
      .from(ACCOUNT_EXPORT_BUCKET)
      .remove([claim.temp_storage_path, claim.final_storage_path]);
    if (removeError) {
      await releaseClaim(admin, claim);
      retryJobs += 1;
      continue;
    }

    const { data: confirmed, error: confirmError } = await admin.rpc(
      "confirm_account_data_export_cleanup",
      {
        requested_export_id: claim.export_id,
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
    claimedJobs: claims.length,
    removedJobs,
    retryJobs,
  };
}

function parseClaim(value: unknown): ClaimedExportCleanup | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Partial<ClaimedExportCleanup>;
  if (
    typeof row.export_id !== "string"
    || typeof row.user_id !== "string"
    || typeof row.temp_storage_path !== "string"
    || typeof row.final_storage_path !== "string"
    || typeof row.cleanup_token !== "string"
    || !isUuid(row.export_id)
    || !isUuid(row.user_id)
    || !isUuid(row.cleanup_token)
    || row.temp_storage_path !== accountExportTempPath(row.user_id, row.export_id)
    || row.final_storage_path !== accountExportFinalPath(row.user_id, row.export_id)
  ) {
    return null;
  }
  return row as ClaimedExportCleanup;
}

async function releaseClaim(admin: SupabaseClient, claim: ClaimedExportCleanup) {
  await admin.rpc("release_account_data_export_cleanup", {
    requested_export_id: claim.export_id,
    requested_cleanup_token: claim.cleanup_token,
  });
}

function failedResult(): AccountExportCleanupResult {
  return { ok: false, claimedJobs: 0, removedJobs: 0, retryJobs: 0 };
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
