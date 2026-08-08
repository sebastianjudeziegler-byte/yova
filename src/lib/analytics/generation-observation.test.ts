import { describe, expect, it } from "vitest";
import { GenerationObservationSchema } from "@/lib/analytics/generation-observation";

describe("GenerationObservationSchema", () => {
  const safeEvent = {
    generationType: "session",
    environment: "production",
    finalOutcome: "success",
    firstAttemptPassed: false,
    failedValidator: "session_semantic_validation",
    repairAttempted: true,
    repairSucceeded: true,
    elapsedMs: 1_234,
    attempts: 2,
    inputTokens: 400,
    cachedInputTokens: 200,
    cacheWriteTokens: 0,
    outputTokens: 300,
    model: "gpt-5-mini",
  } as const;

  it("accepts bounded operational generation facts", () => {
    expect(GenerationObservationSchema.safeParse(safeEvent).success).toBe(true);
  });

  it("rejects learner content even if a caller tries to add it", () => {
    expect(GenerationObservationSchema.safeParse({
      ...safeEvent,
      learnerPrompt: "My private study goal",
    }).success).toBe(false);
  });
});

