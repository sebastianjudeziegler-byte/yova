import { describe, expect, it, vi } from "vitest";
import {
  isSessionGenerationOperationInProgress,
  reusableSessionGenerationOperation,
  SESSION_GENERATION_OPERATION_TTL_MS,
} from "@/lib/session-generation/operation-key";

const input = {
  planId: "11111111-1111-4111-8111-111111111111",
  planSessionId: "22222222-2222-4222-8222-222222222222",
  adjustment: {
    familiarity: "need_teaching" as const,
    availableMinutes: 20,
    knownTargets: ["Explain the causal chain"],
    note: "Use one concrete example.",
  },
};

describe("guided-session operation identity", () => {
  it("reuses one request id for the same ambiguous operation within its lease", () => {
    const createRequestId = vi.fn()
      .mockReturnValueOnce("33333333-3333-4333-8333-333333333333")
      .mockReturnValueOnce("44444444-4444-4444-8444-444444444444");
    const first = reusableSessionGenerationOperation(null, input, createRequestId, 1_000);
    const retry = reusableSessionGenerationOperation(first, input, createRequestId, 10_000);

    expect(retry).toBe(first);
    expect(retry.requestId).toBe("33333333-3333-4333-8333-333333333333");
    expect(createRequestId).toHaveBeenCalledTimes(1);
  });

  it("creates a new request id for a changed adjustment or an expired lease", () => {
    const createRequestId = vi.fn()
      .mockReturnValueOnce("33333333-3333-4333-8333-333333333333")
      .mockReturnValueOnce("44444444-4444-4444-8444-444444444444")
      .mockReturnValueOnce("55555555-5555-4555-8555-555555555555");
    const first = reusableSessionGenerationOperation(null, input, createRequestId, 1_000);
    const changed = reusableSessionGenerationOperation(first, {
      ...input,
      adjustment: { ...input.adjustment, availableMinutes: 10 },
    }, createRequestId, 2_000);
    const expired = reusableSessionGenerationOperation(
      first,
      input,
      createRequestId,
      1_000 + SESSION_GENERATION_OPERATION_TTL_MS,
    );

    expect(changed.requestId).toBe("44444444-4444-4444-8444-444444444444");
    expect(expired.requestId).toBe("55555555-5555-4555-8555-555555555555");
  });

  it("recognizes only the explicit live-operation conflict response", () => {
    expect(isSessionGenerationOperationInProgress({
      code: "ai_operation_in_progress",
      retryable: true,
    })).toBe(true);
    expect(isSessionGenerationOperationInProgress({
      code: "guided_session_allowance_exhausted",
    })).toBe(false);
    expect(isSessionGenerationOperationInProgress(null)).toBe(false);
  });
});
