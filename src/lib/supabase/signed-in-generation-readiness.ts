import "server-only";

import {
  createSupabaseAdminClient,
  isSupabaseAdminConfigured,
} from "@/lib/supabase/admin";

export const SIGNED_IN_GENERATION_CONTRACT_VERSION = "202608310003";

type ReadinessPayload = {
  contractVersion?: unknown;
  ready?: unknown;
  studyRoutesSchema?: unknown;
  planSessionsRoutePointer?: unknown;
  requiredRouteRpcs?: unknown;
  expandedMethodAgencyBoundary?: unknown;
  methodEligibilityV3Boundary?: unknown;
};

export async function signedInGenerationReadinessStatus(): Promise<"ready" | "unavailable"> {
  if (!hasValidDraftReceiptSecrets() || !isSupabaseAdminConfigured()) {
    return "unavailable";
  }

  try {
    const { data, error } = await createSupabaseAdminClient().rpc(
      "signed_in_generation_readiness_v3",
    );
    if (error || !isReadinessPayload(data)) return "unavailable";

    return data.contractVersion === SIGNED_IN_GENERATION_CONTRACT_VERSION
      && data.ready === true
      && data.studyRoutesSchema === true
      && data.planSessionsRoutePointer === true
      && data.requiredRouteRpcs === true
      && data.expandedMethodAgencyBoundary === true
      && data.methodEligibilityV3Boundary === true
      ? "ready"
      : "unavailable";
  } catch {
    return "unavailable";
  }
}

function hasValidDraftReceiptSecrets() {
  const current = process.env.YOVA_DRAFT_RECEIPT_SECRET ?? "";
  const previous = process.env.YOVA_DRAFT_RECEIPT_PREVIOUS_SECRET ?? "";
  return validDraftReceiptSecret(current)
    && (!previous || validDraftReceiptSecret(previous));
}

function validDraftReceiptSecret(value: string) {
  return value.length >= 32 && value.length <= 4_096 && value === value.trim();
}

function isReadinessPayload(value: unknown): value is ReadinessPayload {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
