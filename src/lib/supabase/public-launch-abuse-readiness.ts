import "server-only";

import {
  createSupabaseAdminClient,
  isSupabaseAdminConfigured,
} from "@/lib/supabase/admin";

export const PUBLIC_LAUNCH_ABUSE_CONTRACT_VERSION = "202609040002";

type PublicLaunchAbuseReadinessPayload = {
  contractVersion?: unknown;
  ready?: unknown;
  aiActionsCovered?: unknown;
  materialUploadQuota?: unknown;
  materialChunkWriteBoundary?: unknown;
  untrustedInsertQuotas?: unknown;
  tutorWriteBoundary?: unknown;
};

export async function publicLaunchAbuseReadinessStatus(): Promise<"ready" | "unavailable"> {
  if (!isSupabaseAdminConfigured()) return "unavailable";

  try {
    const { data, error } = await createSupabaseAdminClient().rpc(
      "public_launch_abuse_readiness_v1",
    );
    if (error || !isReadinessPayload(data)) return "unavailable";

    return data.contractVersion === PUBLIC_LAUNCH_ABUSE_CONTRACT_VERSION
      && data.ready === true
      && data.aiActionsCovered === true
      && data.materialUploadQuota === true
      && data.materialChunkWriteBoundary === true
      && data.untrustedInsertQuotas === true
      && data.tutorWriteBoundary === true
      ? "ready"
      : "unavailable";
  } catch {
    return "unavailable";
  }
}

function isReadinessPayload(value: unknown): value is PublicLaunchAbuseReadinessPayload {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
