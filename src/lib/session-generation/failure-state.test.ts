import { describe, expect, it } from "vitest";
import {
  buildGuidedSessionFailureState,
  classifyGuidedSessionGenerationFailure,
  retryAfterResetAt,
  type GuidedSessionFailureState,
} from "@/lib/session-generation/failure-state";
import {
  SOURCE_UNAVAILABLE_GUIDED_SESSION_FAILURE_CODE,
  GUIDED_SESSION_ALLOWANCE_EXHAUSTED_CODE,
  TRANSIENT_GUIDED_SESSION_FAILURE_CODE,
  VALIDATION_GUIDED_SESSION_FAILURE_CODE,
} from "@/lib/session-generation/failure-message";

const now = Date.UTC(2026, 7, 19, 12, 0, 0);

function response(status: number, headers: Record<string, string> = {}) {
  return { status, headers: new Headers(headers) };
}

function actionIds(state: GuidedSessionFailureState) {
  return state.actions.map((action) => action.id);
}

describe("guided-session generation failure classification", () => {
  it("classifies durable allowance exhaustion and derives the reset only from Retry-After", () => {
    const cause = classifyGuidedSessionGenerationFailure({
      response: response(429, {
        "Retry-After": "3600",
        "X-Yova-Fallback-Reason": GUIDED_SESSION_ALLOWANCE_EXHAUSTED_CODE,
      }),
      body: {
        code: GUIDED_SESSION_ALLOWANCE_EXHAUSTED_CODE,
        error: "This account has used all of its guided-session allowance.",
        retryAfterSeconds: 5,
        retryable: false,
      },
      now,
    });

    expect(cause).toEqual({
      kind: "allowance_exhausted",
      apiMessage: "This account has used all of its guided-session allowance.",
      resetAt: "2026-08-19T13:00:00.000Z",
      retryable: false,
    });
    const state = buildGuidedSessionFailureState({
      cause,
      fallbackOutcome: "time_fit_rejected",
    });
    expect(state.kind).toBe("allowance_exhausted");
    expect(state.fallbackReason).toBe("length");
    expect(state.heading).toMatch(/allowance/i);
    expect(state.detail).toMatch(/more time/i);
    expect(state.resetAt).toBe("2026-08-19T13:00:00.000Z");
    expect(actionIds(state)).not.toContain("retry_generation");
  });

  it("does not mistake the short burst limit for durable allowance exhaustion", () => {
    const cause = classifyGuidedSessionGenerationFailure({
      response: response(429, { "Retry-After": "30" }),
      body: { error: "Too many sessions were generated at once. Wait a moment and try again." },
      now,
    });

    expect(cause.kind).toBe("transient_provider_or_network");
    expect(cause.resetAt).toBeNull();
    expect(cause.retryable).toBe(true);
  });

  it("classifies explicit and legacy exhausted quality-check responses as non-retryable", () => {
    const explicit = classifyGuidedSessionGenerationFailure({
      response: response(502),
      body: {
        code: VALIDATION_GUIDED_SESSION_FAILURE_CODE,
        error: "The generated lesson failed its learning checks.",
        retryable: false,
      },
    });
    const legacy = classifyGuidedSessionGenerationFailure({
      response: response(502),
      body: { error: "The generated lesson failed its learning checks.", retryable: false },
    });

    expect(explicit.kind).toBe("quality_checks_failed");
    expect(legacy.kind).toBe("quality_checks_failed");
    const state = buildGuidedSessionFailureState({
      cause: explicit,
      fallbackOutcome: "coverage_rejected",
    });
    expect(state.kind).toBe("quality_checks_failed");
    expect(state.eyebrow).toBe("LESSON QUALITY CHECK");
    expect(state.detail).toMatch(/uncovered/i);
    expect(actionIds(state)).not.toContain("retry_generation");
  });

  it("classifies provider, network, and timeout failures as transient", () => {
    const provider = classifyGuidedSessionGenerationFailure({
      response: response(502),
      body: {
        code: TRANSIENT_GUIDED_SESSION_FAILURE_CODE,
        error: "Provider request failed.",
        retryable: true,
      },
    });
    const network = classifyGuidedSessionGenerationFailure({ response: null });
    const timeout = classifyGuidedSessionGenerationFailure({
      response: response(422),
      timedOut: true,
    });

    expect(provider.kind).toBe("transient_provider_or_network");
    expect(network.kind).toBe("transient_provider_or_network");
    expect(timeout.kind).toBe("transient_provider_or_network");
    const state = buildGuidedSessionFailureState({ cause: provider });
    expect(state.heading).toMatch(/could not reach/i);
    expect(actionIds(state)).toContain("retry_generation");
    expect(actionIds(state)).toContain("start_method_work");
  });

  it("classifies a live operation-key conflict as retryable without treating it as quota", () => {
    const cause = classifyGuidedSessionGenerationFailure({
      response: response(409, { "Retry-After": "45" }),
      body: {
        code: "ai_operation_in_progress",
        error: "This guided session is already being prepared.",
        retryable: true,
      },
    });

    expect(cause).toMatchObject({
      kind: "transient_provider_or_network",
      retryable: true,
      resetAt: null,
    });
  });

  it("keeps setup and lifecycle rejections out of the provider-failure category", () => {
    const cause = classifyGuidedSessionGenerationFailure({
      response: response(409),
      body: { error: "This plan needs its topic map rebuilt before YOVA can prepare the session." },
    });

    expect(cause.kind).toBe("request_rejected");
    expect(cause.retryable).toBe(false);
    const state = buildGuidedSessionFailureState({ cause, fallbackOutcome: "unavailable" });
    expect(state.eyebrow).toBe("SESSION SETUP NEEDS ATTENTION");
    expect(state.kind).toBe("request_rejected");
    expect(state.detail).toMatch(/topic map rebuilt/i);
    expect(state.detail).toMatch(/subject-specific offline lesson is not available/i);
    expect(state.detail).not.toMatch(/study-method guide|ungraded practice/i);
    expect(actionIds(state)).not.toContain("retry_generation");
  });

  it("presents source-unavailable generation as actionable setup work, not a provider outage", () => {
    const cause = classifyGuidedSessionGenerationFailure({
      response: response(502),
      body: {
        code: SOURCE_UNAVAILABLE_GUIDED_SESSION_FAILURE_CODE,
        error: "Attach or reprocess readable material, or choose a source-independent route.",
        retryable: false,
      },
    });

    expect(cause).toMatchObject({ kind: "request_rejected", retryable: false });
    const state = buildGuidedSessionFailureState({ cause });
    expect(state.eyebrow).toBe("SESSION SETUP NEEDS ATTENTION");
    expect(state.detail).toMatch(/attach or reprocess readable material/i);
    expect(state.detail).toMatch(/source-independent/i);
    expect(state.heading).not.toMatch(/service|outage/i);
    expect(actionIds(state)).toContain("review_session_setup");
    expect(actionIds(state)).not.toContain("retry_generation");
  });
});

describe("guided-session fallback failure presentation", () => {
  const transientCause = classifyGuidedSessionGenerationFailure({
    response: response(503),
    body: { error: "The provider is unavailable." },
  });

  it.each([
    ["unavailable", "shape", /subject-specific offline lesson is not available for this session configuration/i],
    ["time_fit_rejected", "length", /subject-specific offline lesson needs more time than this session allows/i],
    ["coverage_rejected", "shape", /subject-specific offline lesson would leave part of the session target uncovered/i],
  ] as const)("names a %s fallback rejection honestly", (fallbackOutcome, reason, fallbackDetail) => {
    const state = buildGuidedSessionFailureState({ cause: transientCause, fallbackOutcome });

    expect(state.kind).toBe("fallback_unavailable");
    expect(state.fallbackReason).toBe(reason);
    expect(state.eyebrow).toBe("GUIDED LESSON TEMPORARILY UNAVAILABLE");
    expect(state.heading).toMatch(/could not reach the guided-lesson service/i);
    expect(state.detail).toMatch(/provider is unavailable/i);
    expect(state.detail).toMatch(fallbackDetail);
    expect(state.detail).not.toMatch(/topic-scoped study-method guide|ungraded practice/i);
    expect(state.detail).not.toMatch(/service interrupted|outage/i);
    expect(actionIds(state)).toContain("start_method_work");
  });

  it("never leaves retry as the only action", () => {
    const states = [
      buildGuidedSessionFailureState({ cause: transientCause }),
      buildGuidedSessionFailureState({ cause: transientCause, fallbackOutcome: "unavailable" }),
      buildGuidedSessionFailureState({
        cause: classifyGuidedSessionGenerationFailure({
          response: response(502),
          body: { code: VALIDATION_GUIDED_SESSION_FAILURE_CODE, retryable: false },
        }),
      }),
      buildGuidedSessionFailureState({
        cause: classifyGuidedSessionGenerationFailure({
          response: response(429, {
            "Retry-After": "600",
            "X-Yova-Fallback-Reason": GUIDED_SESSION_ALLOWANCE_EXHAUSTED_CODE,
          }),
        }),
      }),
    ];

    for (const state of states) {
      const nonRetryActions = state.actions.filter((action) => action.id !== "retry_generation");
      expect(nonRetryActions.length).toBeGreaterThan(0);
      expect(state.actions.filter((action) => action.emphasis === "primary")).toHaveLength(1);
    }
  });
});

describe("retryAfterResetAt", () => {
  it("supports integer seconds and HTTP dates without guessing malformed values", () => {
    expect(retryAfterResetAt("0", now)).toBe("2026-08-19T12:00:00.000Z");
    expect(retryAfterResetAt("3600", now)).toBe("2026-08-19T13:00:00.000Z");
    expect(retryAfterResetAt("Wed, 19 Aug 2026 13:00:00 GMT", now)).toBe("2026-08-19T13:00:00.000Z");
    expect(retryAfterResetAt("Wed, 19 Aug 2026 11:00:00 GMT", now)).toBe("2026-08-19T12:00:00.000Z");
    expect(retryAfterResetAt(null, now)).toBeNull();
    expect(retryAfterResetAt("junk", now)).toBeNull();
    expect(retryAfterResetAt("-1", now)).toBeNull();
    expect(retryAfterResetAt("1.5", now)).toBeNull();
  });
});
