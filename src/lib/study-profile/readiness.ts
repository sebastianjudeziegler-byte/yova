import "server-only";

import {
  createSupabaseAdminClient,
  isSupabaseAdminConfigured,
} from "@/lib/supabase/admin";

export const STUDY_PROFILE_PUBLIC_CONTRACT_VERSION = "202609080001";

type StudyProfileReadinessPayload = {
  contractVersion?: unknown;
  ready?: unknown;
  pendingConfirmationColumns?: unknown;
  confirmationRpcs?: unknown;
  reportEmailCooldown?: unknown;
  serviceRoleBoundary?: unknown;
  attributionCapture?: unknown;
  attributionFirstTouch?: unknown;
  minorConversionSuppression?: unknown;
  reportScopedReconfirmation?: unknown;
  boundReportConfirmation?: unknown;
  landingConfirmationIsolation?: unknown;
};

export async function studyProfilePublicReadinessStatus(): Promise<"ready" | "unavailable"> {
  if (!isSupabaseAdminConfigured()) return "unavailable";

  try {
    const { data, error } = await createSupabaseAdminClient().rpc(
      "study_profile_public_readiness_v5",
    );
    if (error || !isReadinessPayload(data)) return "unavailable";

    return data.contractVersion === STUDY_PROFILE_PUBLIC_CONTRACT_VERSION
      && data.ready === true
      && data.pendingConfirmationColumns === true
      && data.confirmationRpcs === true
      && data.reportEmailCooldown === true
      && data.serviceRoleBoundary === true
      && data.attributionCapture === true
      && data.attributionFirstTouch === true
      && data.minorConversionSuppression === true
      && data.reportScopedReconfirmation === true
      && data.boundReportConfirmation === true
      && data.landingConfirmationIsolation === true
      ? "ready"
      : "unavailable";
  } catch {
    return "unavailable";
  }
}

function isReadinessPayload(value: unknown): value is StudyProfileReadinessPayload {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
