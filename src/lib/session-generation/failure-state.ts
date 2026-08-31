import type { BuiltInFallbackOutcome } from "@/lib/session-generation/fallback-observation";
import { AI_USAGE_OPERATION_IN_PROGRESS_CODE } from "@/lib/ai-usage/reservation-conflict";
import {
  FALLBACK_UNAVAILABLE_GUIDED_SESSION_FAILURE_CODE,
  GUIDED_SESSION_ALLOWANCE_EXHAUSTED_CODE,
  SOURCE_UNAVAILABLE_GUIDED_SESSION_FAILURE_CODE,
  TRANSIENT_GUIDED_SESSION_FAILURE_CODE,
  VALIDATION_GUIDED_SESSION_FAILURE_CODE,
} from "@/lib/session-generation/failure-message";

export const GUIDED_SESSION_FAILURE_KINDS = [
  "allowance_exhausted",
  "transient_provider_or_network",
  "quality_checks_failed",
  "fallback_unavailable",
  "request_rejected",
] as const;

export type GuidedSessionFailureKind = (typeof GUIDED_SESSION_FAILURE_KINDS)[number];

export type GuidedSessionFailureActionId =
  | "start_method_work"
  | "retry_generation"
  | "review_session_setup"
  | "open_goal"
  | "return_home";

export type GuidedSessionFailureAction = {
  id: GuidedSessionFailureActionId;
  label: string;
  emphasis: "primary" | "secondary" | "quiet";
};

export type GuidedSessionGenerationCause = {
  kind: Exclude<GuidedSessionFailureKind, "fallback_unavailable">;
  apiMessage: string | null;
  resetAt: string | null;
  retryable: boolean;
};

export type GuidedSessionFallbackFailure = Exclude<BuiltInFallbackOutcome, "loaded">;

export type GuidedSessionFailureState = {
  kind: GuidedSessionFailureKind;
  generationCause: GuidedSessionGenerationCause;
  fallbackOutcome: GuidedSessionFallbackFailure | null;
  fallbackReason: "length" | "shape" | null;
  eyebrow: string;
  heading: string;
  detail: string;
  resetAt: string | null;
  retryable: boolean;
  actions: readonly GuidedSessionFailureAction[];
};

type HeaderReader = Pick<Headers, "get">;

export type GuidedSessionFailureResponseLike = {
  status: number;
  headers: HeaderReader;
};

export type ClassifyGuidedSessionGenerationFailureInput = {
  /** A missing response represents a network failure or client-side timeout. */
  response: GuidedSessionFailureResponseLike | null;
  body?: unknown;
  timedOut?: boolean;
  now?: number;
};

export type BuildGuidedSessionFailureStateInput = {
  cause: GuidedSessionGenerationCause;
  fallbackOutcome?: GuidedSessionFallbackFailure | null;
};

const METHOD_ACTION: GuidedSessionFailureAction = {
  id: "start_method_work",
  label: "Use the study method",
  emphasis: "primary",
};

const METHOD_ALTERNATIVE_ACTION: GuidedSessionFailureAction = {
  ...METHOD_ACTION,
  emphasis: "secondary",
};

const RETRY_ACTION: GuidedSessionFailureAction = {
  id: "retry_generation",
  label: "Try preparing the guided lesson again",
  emphasis: "primary",
};

const RETRY_ALTERNATIVE_ACTION: GuidedSessionFailureAction = {
  ...RETRY_ACTION,
  emphasis: "secondary",
};

const REVIEW_ACTION: GuidedSessionFailureAction = {
  id: "review_session_setup",
  label: "Review session setup",
  emphasis: "secondary",
};

const OPEN_GOAL_ACTION: GuidedSessionFailureAction = {
  id: "open_goal",
  label: "Open the goal",
  emphasis: "quiet",
};

const RETURN_HOME_ACTION: GuidedSessionFailureAction = {
  id: "return_home",
  label: "Return to YOVA",
  emphasis: "quiet",
};

/**
 * Converts a Retry-After header (integer seconds or an HTTP date) into the
 * absolute reset instant used by learner-facing quota copy. It deliberately
 * does not read a body field or invent a client-side reset interval.
 */
export function retryAfterResetAt(retryAfter: string | null, now = Date.now()) {
  const normalized = retryAfter?.trim() ?? "";
  if (!normalized) return null;

  if (/^\d+$/.test(normalized)) {
    const seconds = Number(normalized);
    const resetAt = now + (seconds * 1_000);
    if (!Number.isSafeInteger(seconds) || !Number.isFinite(resetAt)) return null;
    const resetDate = new Date(resetAt);
    return Number.isNaN(resetDate.getTime()) ? null : resetDate.toISOString();
  }

  // Numeric-like signed and decimal values are invalid delta-seconds. Requiring
  // a letter prevents Date.parse from reinterpreting them as calendar dates.
  if (!/[A-Za-z]/.test(normalized)) return null;
  const parsedDate = Date.parse(normalized);
  if (!Number.isFinite(parsedDate)) return null;
  return new Date(Math.max(now, parsedDate)).toISOString();
}

/**
 * Classifies the generation failure before fallback selection. Explicit API
 * codes are authoritative; retryable=false remains as compatibility for
 * responses emitted before the quality-check code was added.
 */
export function classifyGuidedSessionGenerationFailure({
  response,
  body,
  timedOut = false,
  now = Date.now(),
}: ClassifyGuidedSessionGenerationFailureInput): GuidedSessionGenerationCause {
  const apiMessage = readStringProperty(body, "error");
  const code = readStringProperty(body, "code");
  const responseStatus = response?.status ?? null;
  const allowanceHeader = response?.headers.get("X-Yova-Fallback-Reason");
  const durableAllowance = responseStatus === 429 && (
    code === GUIDED_SESSION_ALLOWANCE_EXHAUSTED_CODE
    || allowanceHeader === GUIDED_SESSION_ALLOWANCE_EXHAUSTED_CODE
    || apiMessage?.toLocaleLowerCase().includes("guided-session allowance") === true
  );

  if (durableAllowance) {
    return {
      kind: "allowance_exhausted",
      apiMessage,
      resetAt: retryAfterResetAt(response?.headers.get("Retry-After") ?? null, now),
      retryable: false,
    };
  }

  const sourceOrFallbackUnavailable = code === SOURCE_UNAVAILABLE_GUIDED_SESSION_FAILURE_CODE
    || code === FALLBACK_UNAVAILABLE_GUIDED_SESSION_FAILURE_CODE;
  if (sourceOrFallbackUnavailable) {
    return {
      kind: "request_rejected",
      apiMessage,
      resetAt: null,
      retryable: false,
    };
  }

  const qualityChecksFailed = code === VALIDATION_GUIDED_SESSION_FAILURE_CODE
    || (responseStatus === 502 && readBooleanProperty(body, "retryable") === false);
  if (qualityChecksFailed) {
    return {
      kind: "quality_checks_failed",
      apiMessage,
      resetAt: null,
      retryable: false,
    };
  }

  const explicitlyTransient = code === TRANSIENT_GUIDED_SESSION_FAILURE_CODE
    || code === AI_USAGE_OPERATION_IN_PROGRESS_CODE;
  const transientStatus = responseStatus === null
    || responseStatus === 429
    || responseStatus === 500
    || responseStatus === 502
    || responseStatus === 503
    || responseStatus === 504;
  if (timedOut || explicitlyTransient || transientStatus) {
    return {
      kind: "transient_provider_or_network",
      apiMessage,
      resetAt: null,
      retryable: true,
    };
  }

  return {
    kind: "request_rejected",
    apiMessage,
    resetAt: null,
    retryable: false,
  };
}

/**
 * Resolves a learner-facing screen after the built-in fallback has also been
 * considered. Quota and quality causes stay primary because they explain why
 * generation stopped. A transient provider/network cause also stays primary;
 * a failed offline fallback is reported as the second layer explaining why no
 * degraded lesson could open.
 * Request/setup rejections remain primary because describing an inactive or
 * invalid plan as a lesson-shape failure would hide the actionable cause.
 */
export function buildGuidedSessionFailureState({
  cause,
  fallbackOutcome = null,
}: BuildGuidedSessionFailureStateInput): GuidedSessionFailureState {
  const fallbackReason = fallbackOutcome === "time_fit_rejected"
    ? "length"
    : fallbackOutcome
      ? "shape"
      : null;
  const fallbackDetail = detailForFallbackOutcome(fallbackOutcome);

  if (cause.kind === "allowance_exhausted") {
    return {
      kind: cause.kind,
      generationCause: cause,
      fallbackOutcome,
      fallbackReason,
      eyebrow: "GUIDED SESSION ALLOWANCE USED",
      heading: "You have used this account's daily guided-session allowance.",
      detail: joinDetails(
        cause.resetAt
          ? "The reset time below comes from YOVA's session service."
          : "YOVA's session service did not provide a readable reset time.",
        fallbackDetail,
      ),
      resetAt: cause.resetAt,
      retryable: false,
      actions: [METHOD_ACTION, REVIEW_ACTION, OPEN_GOAL_ACTION, RETURN_HOME_ACTION],
    };
  }

  if (cause.kind === "quality_checks_failed") {
    return {
      kind: cause.kind,
      generationCause: cause,
      fallbackOutcome,
      fallbackReason,
      eyebrow: "LESSON QUALITY CHECK",
      heading: "The generated lesson did not pass YOVA's quality checks.",
      detail: joinDetails(
        "YOVA stopped the lesson before showing material that did not meet the learning requirements.",
        fallbackDetail,
      ),
      resetAt: null,
      retryable: false,
      actions: [METHOD_ACTION, REVIEW_ACTION, OPEN_GOAL_ACTION, RETURN_HOME_ACTION],
    };
  }

  if (cause.kind === "request_rejected") {
    return {
      kind: cause.kind,
      generationCause: cause,
      fallbackOutcome,
      fallbackReason,
      eyebrow: "SESSION SETUP NEEDS ATTENTION",
      heading: "YOVA could not prepare a guided lesson for this session setup.",
      detail: joinDetails(
        cause.apiMessage,
        fallbackDetail,
        "Review the session setup or choose another route from this screen.",
      ),
      resetAt: null,
      retryable: false,
      actions: [REVIEW_ACTION, METHOD_ACTION, OPEN_GOAL_ACTION, RETURN_HOME_ACTION],
    };
  }

  if (fallbackOutcome) {
    return {
      kind: "fallback_unavailable",
      generationCause: cause,
      fallbackOutcome,
      fallbackReason,
      eyebrow: "GUIDED LESSON TEMPORARILY UNAVAILABLE",
      heading: "YOVA could not reach the guided-lesson service.",
      detail: joinDetails(
        cause.apiMessage,
        fallbackDetail,
      ),
      resetAt: null,
      retryable: cause.retryable,
      actions: cause.retryable
        ? [METHOD_ACTION, RETRY_ALTERNATIVE_ACTION, REVIEW_ACTION, OPEN_GOAL_ACTION, RETURN_HOME_ACTION]
        : [METHOD_ACTION, REVIEW_ACTION, OPEN_GOAL_ACTION, RETURN_HOME_ACTION],
    };
  }

  if (cause.kind === "transient_provider_or_network") {
    return {
      kind: cause.kind,
      generationCause: cause,
      fallbackOutcome: null,
      fallbackReason: null,
      eyebrow: "GUIDED LESSON TEMPORARILY UNAVAILABLE",
      heading: "YOVA could not reach the guided-lesson service.",
      detail: joinDetails(
        cause.apiMessage,
        "This may be temporary. You can retry or choose another route from this screen.",
      ),
      resetAt: null,
      retryable: true,
      actions: [RETRY_ACTION, METHOD_ALTERNATIVE_ACTION, REVIEW_ACTION, OPEN_GOAL_ACTION, RETURN_HOME_ACTION],
    };
  }

  // This is unreachable for today's cause kinds. Keep a safe setup state as a
  // forward-compatible floor because GuidedSessionGenerationCause stores its
  // kind as a field union rather than as a discriminated object union.
  return {
    kind: "request_rejected",
    generationCause: cause,
    fallbackOutcome,
    fallbackReason,
    eyebrow: "SESSION SETUP NEEDS ATTENTION",
    heading: "YOVA could not prepare a guided lesson for this session setup.",
    detail: joinDetails(cause.apiMessage, fallbackDetail, "Review the session setup or open the goal."),
    resetAt: null,
    retryable: false,
    actions: [REVIEW_ACTION, OPEN_GOAL_ACTION, RETURN_HOME_ACTION],
  };
}

function detailForFallbackOutcome(outcome: GuidedSessionFallbackFailure | null) {
  if (outcome === "time_fit_rejected") {
    return "The subject-specific offline lesson needs more time than this session allows.";
  }
  if (outcome === "coverage_rejected") {
    return "The subject-specific offline lesson would leave part of the session target uncovered.";
  }
  if (outcome === "unavailable") {
    return "A subject-specific offline lesson is not available for this session configuration.";
  }
  return null;
}

function joinDetails(...parts: Array<string | null>) {
  return parts.filter((part): part is string => Boolean(part?.trim())).join(" ");
}

function readStringProperty(value: unknown, key: string) {
  const property = readProperty(value, key);
  return typeof property === "string" ? property : null;
}

function readBooleanProperty(value: unknown, key: string) {
  const property = readProperty(value, key);
  return typeof property === "boolean" ? property : null;
}

function readProperty(value: unknown, key: string) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)[key]
    : null;
}
