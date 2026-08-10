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

  it("accepts privacy-safe streamed lesson measurements", () => {
    expect(GenerationObservationSchema.safeParse({
      ...safeEvent,
      generationType: "lesson",
      failedValidator: null,
      diagnostics: {
        latencyToFirstTokenMs: 340,
        wordCount: 612,
        streamCompleted: true,
      },
    }).success).toBe(true);
  });

  it("accepts a bounded lesson failure kind but rejects free-form failure detail", () => {
    expect(GenerationObservationSchema.safeParse({
      ...safeEvent,
      generationType: "lesson",
      finalOutcome: "failure",
      firstAttemptPassed: false,
      failedValidator: "lesson_provider_request",
      diagnostics: {
        streamCompleted: false,
        lessonFailureKind: "runtime_timeout",
      },
    }).success).toBe(true);
    expect(GenerationObservationSchema.safeParse({
      ...safeEvent,
      generationType: "lesson",
      finalOutcome: "failure",
      firstAttemptPassed: false,
      failedValidator: "lesson_provider_request",
      diagnostics: {
        streamCompleted: false,
        lessonFailureKind: "the provider rejected the learner's private WWI topic",
      },
    }).success).toBe(false);
  });

  it("accepts an over-budget lesson recovery without learner content", () => {
    expect(GenerationObservationSchema.safeParse({
      ...safeEvent,
      generationType: "lesson",
      finalOutcome: "fallback",
      firstAttemptPassed: false,
      failedValidator: "lesson_stream",
      diagnostics: {
        wordCount: 180,
        streamCompleted: true,
        lessonFailureKind: "content_exceeded_time_budget",
      },
    }).success).toBe(true);
  });

  it("accepts a thin-lesson recovery without storing learner content", () => {
    expect(GenerationObservationSchema.safeParse({
      ...safeEvent,
      generationType: "lesson",
      finalOutcome: "fallback",
      firstAttemptPassed: false,
      failedValidator: "lesson_stream",
      diagnostics: {
        wordCount: 74,
        streamCompleted: true,
        lessonFailureKind: "content_below_substance_threshold",
      },
    }).success).toBe(true);
  });

  it("represents lesson skip usage without learner content", () => {
    expect(GenerationObservationSchema.safeParse({
      ...safeEvent,
      generationType: "lesson",
      observationKind: "usage",
      finalOutcome: "cache",
      firstAttemptPassed: null,
      failedValidator: null,
      repairAttempted: false,
      repairSucceeded: null,
      elapsedMs: 0,
      attempts: 0,
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      diagnostics: {
        lessonAction: "skip_to_practice",
        lessonRequestId: "e7643187-7584-43d3-b4a2-14ea5a2c0d6f",
      },
    }).success).toBe(true);
  });

  it("accepts bounded curriculum recognition without learner text", () => {
    expect(GenerationObservationSchema.safeParse({
      ...safeEvent,
      generationType: "knowledge_map",
      diagnostics: {
        topicCount: 10,
        scopeBand: "unit_or_exam",
        curriculumRecognized: true,
        curriculumId: "college_board_ap_biology_2025_unit_2",
        curriculumMatchSource: "both",
        curriculumMatchConfidence: "exact",
      },
    }).success).toBe(true);
  });
});
