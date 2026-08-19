import type { SessionGenerationStats } from "@/lib/openai/session-generator";

export const RETRYABLE_GUIDED_SESSION_FAILURE_MESSAGE =
  "YOVA could not prepare this guided session right now. Try again in a moment.";

export const VALIDATION_GUIDED_SESSION_FAILURE_MESSAGE =
  "YOVA could not build a guided session for this setup that passed its learning checks.";

export const TRANSIENT_GUIDED_SESSION_FAILURE_CODE =
  "guided_session_generation_temporarily_unavailable" as const;

export const VALIDATION_GUIDED_SESSION_FAILURE_CODE =
  "guided_session_quality_checks_failed" as const;

export const GUIDED_SESSION_ALLOWANCE_EXHAUSTED_CODE =
  "guided_session_allowance_exhausted" as const;

export const GUIDED_SESSION_ALLOWANCE_EXHAUSTED_MESSAGE =
  "This account has used all of its guided-session allowance.";

type FailedGenerationStats = Pick<
  SessionGenerationStats,
  "repairReason" | "repairSucceeded"
>;

export type GuidedSessionFailureResponse =
  | {
    error: string;
    code: typeof TRANSIENT_GUIDED_SESSION_FAILURE_CODE;
    retryable: true;
  }
  | {
    error: string;
    code: typeof VALIDATION_GUIDED_SESSION_FAILURE_CODE;
    retryable: false;
  };

export type GuidedSessionAllowanceExhaustedResponse = {
  error: string;
  code: typeof GUIDED_SESSION_ALLOWANCE_EXHAUSTED_CODE;
  retryable: false;
  retryAfterSeconds: number;
};

export type GuidedSessionAllowanceExhaustedHeaders = {
  "Retry-After": string;
  "X-Yova-Fallback-Reason": typeof GUIDED_SESSION_ALLOWANCE_EXHAUSTED_CODE;
};

/**
 * Validation failures have already exhausted their bounded repair attempt, so
 * telling the learner to retry immediately is misleading. Provider failures
 * and incomplete responses may be transient and retain the retry guidance.
 */
export function guidedSessionFailureResponse(
  stats: FailedGenerationStats | null,
): GuidedSessionFailureResponse {
  const exhaustedValidation = stats?.repairSucceeded === false
    && (
      stats.repairReason === "structured_output"
      || stats.repairReason === "semantic_validation"
    );

  return exhaustedValidation
    ? {
      error: VALIDATION_GUIDED_SESSION_FAILURE_MESSAGE,
      code: VALIDATION_GUIDED_SESSION_FAILURE_CODE,
      retryable: false,
    }
    : {
      error: RETRYABLE_GUIDED_SESSION_FAILURE_MESSAGE,
      code: TRANSIENT_GUIDED_SESSION_FAILURE_CODE,
      retryable: true,
    };
}

export function guidedSessionFailureMessage(
  stats: FailedGenerationStats | null,
) {
  return guidedSessionFailureResponse(stats).error;
}

/**
 * Durable allowance exhaustion is not a provider failure and cannot be fixed
 * by immediately repeating the same request. Keep the server-provided reset
 * interval in the response contract so clients can render the real reset time.
 */
export function guidedSessionAllowanceExhaustedResponse(
  retryAfterSeconds: number,
): GuidedSessionAllowanceExhaustedResponse {
  return {
    error: GUIDED_SESSION_ALLOWANCE_EXHAUSTED_MESSAGE,
    code: GUIDED_SESSION_ALLOWANCE_EXHAUSTED_CODE,
    retryable: false,
    retryAfterSeconds,
  };
}

export function guidedSessionAllowanceExhaustedHeaders(
  retryAfterSeconds: number,
): GuidedSessionAllowanceExhaustedHeaders {
  return {
    "Retry-After": String(retryAfterSeconds),
    "X-Yova-Fallback-Reason": GUIDED_SESSION_ALLOWANCE_EXHAUSTED_CODE,
  };
}
