import "server-only";
import {
  PERSONALIZATION_ROLLOUT_POLICY_VERSION,
  parsePersonalizationRolloutPercent,
  resolvePersonalizationRollout,
} from "@/lib/study-route/personalization-rollout";

export const PERSONALIZATION_ROLLOUT_ENVIRONMENT_KEY =
  "YOVA_PERSONALIZATION_ROLLOUT_PERCENT" as const;

export type PersonalizationRolloutConfigurationStatus = Readonly<{
  policyVersion: typeof PERSONALIZATION_ROLLOUT_POLICY_VERSION;
  status: "missing" | "misconfigured" | "baseline" | "staged" | "full";
  percent: number | null;
}>;

/**
 * Public-safe release observability for the server-owned issuance flag. It
 * exposes no subject assignment. Zero is an intentional baseline cohort, not
 * a database-readiness failure; missing or malformed values remain visible so
 * a release cannot silently inherit the default.
 */
export function personalizationRolloutConfigurationStatus(): PersonalizationRolloutConfigurationStatus {
  const raw = process.env[PERSONALIZATION_ROLLOUT_ENVIRONMENT_KEY];
  if (!raw?.trim()) {
    return Object.freeze({
      policyVersion: PERSONALIZATION_ROLLOUT_POLICY_VERSION,
      status: "missing" as const,
      percent: null,
    });
  }
  try {
    const percent = parsePersonalizationRolloutPercent(raw);
    return Object.freeze({
      policyVersion: PERSONALIZATION_ROLLOUT_POLICY_VERSION,
      status: percent === 0
        ? "baseline" as const
        : percent === 100
          ? "full" as const
          : "staged" as const,
      percent,
    });
  } catch {
    return Object.freeze({
      policyVersion: PERSONALIZATION_ROLLOUT_POLICY_VERSION,
      status: "misconfigured" as const,
      percent: null,
    });
  }
}

export function resolveServerPersonalizationRollout({
  subjectKey,
  currentRouterVersion,
}: {
  subjectKey: string | null;
  currentRouterVersion?: string | null;
}) {
  return resolvePersonalizationRollout({
    rolloutPercent: parsePersonalizationRolloutPercent(
      process.env[PERSONALIZATION_ROLLOUT_ENVIRONMENT_KEY],
    ),
    subjectKey,
    currentRouterVersion,
  });
}
