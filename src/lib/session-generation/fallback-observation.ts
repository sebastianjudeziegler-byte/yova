export const BUILT_IN_FALLBACK_OUTCOMES = [
  "loaded",
  "unavailable",
  "time_fit_rejected",
  "coverage_rejected",
] as const;

export type BuiltInFallbackOutcome = typeof BUILT_IN_FALLBACK_OUTCOMES[number];

export type BuiltInFallbackDecision = {
  fallbackAvailable: boolean;
  fitsAvailableTime: boolean;
  coverageAccepted: boolean;
};

type SessionFallbackErrorCodeInput = BuiltInFallbackDecision & {
  generationTimedOut: boolean;
};

/**
 * Classifies only bounded control-flow facts. Learner text, plan identifiers,
 * and session content must never be added to this observation contract.
 */
export function builtInFallbackOutcome({
  fallbackAvailable,
  fitsAvailableTime,
  coverageAccepted,
}: BuiltInFallbackDecision): BuiltInFallbackOutcome {
  if (!fallbackAvailable) return "unavailable";
  if (!fitsAvailableTime) return "time_fit_rejected";
  if (!coverageAccepted) return "coverage_rejected";
  return "loaded";
}

/** Produces an error_reports-compatible identifier while retaining the cause. */
export function sessionFallbackErrorCode({
  generationTimedOut,
  fallbackAvailable,
  fitsAvailableTime,
  coverageAccepted,
}: SessionFallbackErrorCodeInput) {
  const failureKind = generationTimedOut ? "timeout" : "failed";
  const outcome = builtInFallbackOutcome({
    fallbackAvailable,
    fitsAvailableTime,
    coverageAccepted,
  });
  return `guided_session_generation_${failureKind}_fallback_${outcome}` as const;
}
