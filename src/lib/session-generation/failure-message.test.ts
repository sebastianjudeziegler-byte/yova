import { describe, expect, it, vi } from "vitest";
import { SessionGenerationFailure, type SessionGenerationStats } from "@/lib/openai/session-generator";
import {
  guidedSessionAllowanceExhaustedHeaders,
  guidedSessionAllowanceExhaustedResponse,
  guidedSessionFailureMessage,
  guidedSessionFailureResponse,
  FALLBACK_UNAVAILABLE_GUIDED_SESSION_FAILURE_CODE,
  FALLBACK_UNAVAILABLE_GUIDED_SESSION_FAILURE_MESSAGE,
  GUIDED_SESSION_ALLOWANCE_EXHAUSTED_CODE,
  GUIDED_SESSION_ALLOWANCE_EXHAUSTED_MESSAGE,
  RETRYABLE_GUIDED_SESSION_FAILURE_MESSAGE,
  SOURCE_UNAVAILABLE_GUIDED_SESSION_FAILURE_CODE,
  SOURCE_UNAVAILABLE_GUIDED_SESSION_FAILURE_MESSAGE,
  TRANSIENT_GUIDED_SESSION_FAILURE_CODE,
  VALIDATION_GUIDED_SESSION_FAILURE_MESSAGE,
  VALIDATION_GUIDED_SESSION_FAILURE_CODE,
} from "@/lib/session-generation/failure-message";

vi.mock("server-only", () => ({}));

function failureStats(
  overrides: Partial<SessionGenerationStats>,
): SessionGenerationStats {
  return {
    elapsedMs: 1_000,
    attempts: 2,
    firstAttemptPassed: false,
    failedValidator: "session_semantic_validation",
    repairAttempted: true,
    repairSucceeded: false,
    repairReason: "semantic_validation",
    repairDetail: "The repaired session still failed validation.",
    inputTokens: 100,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 100,
    ...overrides,
  };
}

function messageForFailure(stats: SessionGenerationStats) {
  const error = new SessionGenerationFailure("Generation failed.", stats);
  return guidedSessionFailureMessage(error.generationStats);
}

function responseForFailure(stats: SessionGenerationStats) {
  const error = new SessionGenerationFailure("Generation failed.", stats);
  return guidedSessionFailureResponse(error.generationStats);
}

describe("guidedSessionFailureMessage", () => {
  it("classifies durable allowance exhaustion as non-retryable and preserves its reset interval", () => {
    expect(guidedSessionAllowanceExhaustedResponse(3_600)).toEqual({
      error: GUIDED_SESSION_ALLOWANCE_EXHAUSTED_MESSAGE,
      code: GUIDED_SESSION_ALLOWANCE_EXHAUSTED_CODE,
      retryable: false,
      retryAfterSeconds: 3_600,
    });
    expect(GUIDED_SESSION_ALLOWANCE_EXHAUSTED_MESSAGE).not.toMatch(/try again|service|interrupted/i);
    expect(guidedSessionAllowanceExhaustedHeaders(3_600)).toEqual({
      "Retry-After": "3600",
      "X-Yova-Fallback-Reason": GUIDED_SESSION_ALLOWANCE_EXHAUSTED_CODE,
    });
  });

  it("does not recommend retrying an exhausted semantic validation failure", () => {
    const stats = failureStats({
      failedValidator: "session_substantive_teaching",
      repairReason: "semantic_validation",
    });
    const message = messageForFailure(stats);

    expect(message).toBe(VALIDATION_GUIDED_SESSION_FAILURE_MESSAGE);
    expect(message).not.toMatch(/try again|retry/i);
    expect(responseForFailure(stats)).toEqual({
      error: VALIDATION_GUIDED_SESSION_FAILURE_MESSAGE,
      code: VALIDATION_GUIDED_SESSION_FAILURE_CODE,
      retryable: false,
    });
  });

  it("does not recommend retrying an exhausted structured-output failure", () => {
    const stats = failureStats({
      failedValidator: "session_structure",
      repairReason: "structured_output",
    });

    expect(messageForFailure(stats)).toBe(VALIDATION_GUIDED_SESSION_FAILURE_MESSAGE);
    expect(responseForFailure(stats)).toEqual({
      error: VALIDATION_GUIDED_SESSION_FAILURE_MESSAGE,
      code: VALIDATION_GUIDED_SESSION_FAILURE_CODE,
      retryable: false,
    });
  });

  it("retains retry guidance for a transient provider failure", () => {
    const stats = failureStats({
      attempts: 1,
      failedValidator: "session_provider_request",
      repairAttempted: false,
      repairSucceeded: null,
      repairReason: "none",
      repairDetail: null,
    });

    expect(messageForFailure(stats)).toBe(RETRYABLE_GUIDED_SESSION_FAILURE_MESSAGE);
    expect(responseForFailure(stats)).toEqual({
      error: RETRYABLE_GUIDED_SESSION_FAILURE_MESSAGE,
      code: TRANSIENT_GUIDED_SESSION_FAILURE_CODE,
      retryable: true,
    });
  });

  it("gives missing-source and fallback-unavailable failures setup actions instead of outage copy", () => {
    const sourceUnavailable = failureStats({ cause: "source_unavailable" });
    const fallbackUnavailable = failureStats({ cause: "fallback_unavailable" });

    expect(responseForFailure(sourceUnavailable)).toEqual({
      error: SOURCE_UNAVAILABLE_GUIDED_SESSION_FAILURE_MESSAGE,
      code: SOURCE_UNAVAILABLE_GUIDED_SESSION_FAILURE_CODE,
      retryable: false,
    });
    expect(SOURCE_UNAVAILABLE_GUIDED_SESSION_FAILURE_MESSAGE).toMatch(/attach|reprocess/i);
    expect(SOURCE_UNAVAILABLE_GUIDED_SESSION_FAILURE_MESSAGE).toMatch(/source-independent/i);
    expect(responseForFailure(fallbackUnavailable)).toEqual({
      error: FALLBACK_UNAVAILABLE_GUIDED_SESSION_FAILURE_MESSAGE,
      code: FALLBACK_UNAVAILABLE_GUIDED_SESSION_FAILURE_CODE,
      retryable: false,
    });
    expect(FALLBACK_UNAVAILABLE_GUIDED_SESSION_FAILURE_MESSAGE).not.toMatch(/try again|outage/i);
  });

  it("retains retry guidance for an incomplete provider response or unclassified error", () => {
    const incompleteStats = failureStats({
      failedValidator: "session_response_status",
      repairReason: "incomplete_response",
    });

    expect(messageForFailure(incompleteStats)).toBe(RETRYABLE_GUIDED_SESSION_FAILURE_MESSAGE);
    expect(responseForFailure(incompleteStats)).toEqual({
      error: RETRYABLE_GUIDED_SESSION_FAILURE_MESSAGE,
      code: TRANSIENT_GUIDED_SESSION_FAILURE_CODE,
      retryable: true,
    });
    expect(guidedSessionFailureMessage(null)).toBe(
      RETRYABLE_GUIDED_SESSION_FAILURE_MESSAGE,
    );
    expect(guidedSessionFailureResponse(null)).toEqual({
      error: RETRYABLE_GUIDED_SESSION_FAILURE_MESSAGE,
      code: TRANSIENT_GUIDED_SESSION_FAILURE_CODE,
      retryable: true,
    });
  });
});
