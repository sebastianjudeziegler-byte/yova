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

  it("accepts only bounded non-private duration decision diagnostics", () => {
    expect(GenerationObservationSchema.safeParse({
      ...safeEvent,
      generationType: "plan",
      diagnostics: {
        durationContextStatus: "degraded",
        durationContextReason: "history_read_failed",
        durationSource: "router_default",
        durationActiveMinutes: 25,
        durationHardMaximumMinutes: 45,
        durationTaskFamily: "conceptual_learning",
        durationMode: "learn",
        methodContextStatus: "ready",
        methodContextReason: "loaded",
        methodAuthority: "authorized_declaration",
        methodId: "self_explanation",
        methodTaskFamily: "conceptual_learning",
        methodKnowledgeStage: "novice",
        methodMode: "learn",
      },
    }).success).toBe(true);
    expect(GenerationObservationSchema.safeParse({
      ...safeEvent,
      diagnostics: {
        durationContextReason: "private learner answer: I am exhausted",
      },
    }).success).toBe(false);
  });

  it("accepts bounded plan failure diagnostics without provider or learner text", () => {
    expect(GenerationObservationSchema.safeParse({
      ...safeEvent,
      generationType: "plan",
      finalOutcome: "fallback",
      failedValidator: "plan_provider_request",
      diagnostics: {
        planFailureReason: "provider_error",
        providerCategory: "rate_limit",
        providerStatus: 429,
        providerCode: "rate_limit_exceeded",
        planValidationIssueCode: "schedule_fit",
      },
    }).success).toBe(true);
    expect(GenerationObservationSchema.safeParse({
      ...safeEvent,
      diagnostics: {
        providerCategory: "the provider echoed private learner content",
        providerCode: "private learner goal: pass calculus",
      },
    }).success).toBe(false);
  });

  it("accepts only the bounded safe recovery markers", () => {
    expect(GenerationObservationSchema.safeParse({
      ...safeEvent,
      diagnostics: { recoveryMode: "safe_study" },
    }).success).toBe(true);
    expect(GenerationObservationSchema.safeParse({
      ...safeEvent,
      diagnostics: { recoveryMode: "safe_learn" },
    }).success).toBe(true);
    expect(GenerationObservationSchema.safeParse({
      ...safeEvent,
      diagnostics: { recoveryMode: "private learner explanation" },
    }).success).toBe(false);
  });

  it("keeps session strategy, fallback, and persistence diagnostics bounded", () => {
    expect(GenerationObservationSchema.safeParse({
      ...safeEvent,
      finalOutcome: "fallback",
      diagnostics: {
        sessionGenerationStrategy: "streamed",
        sessionGenerationStage: "persistence",
        sessionGenerationCause: "cache_write",
        sessionFallbackMode: "source_grounded",
        sessionPersistence: "browser_only",
        sessionPersistenceCause: "cache_write",
      },
    }).success).toBe(true);
    for (const cause of ["source_unavailable", "fallback_unavailable"] as const) {
      expect(GenerationObservationSchema.safeParse({
        ...safeEvent,
        finalOutcome: "failure",
        diagnostics: {
          sessionGenerationStrategy: "full",
          sessionGenerationStage: "fallback",
          sessionGenerationCause: cause,
        },
      }).success).toBe(true);
    }
    expect(GenerationObservationSchema.safeParse({
      ...safeEvent,
      diagnostics: {
        sessionGenerationStrategy: "learner-chosen private strategy",
        sessionGenerationCause: "provider included private learner text",
        sessionPersistence: "saved beside private study notes",
      },
    }).success).toBe(false);
  });

  it("accepts only enumerated session validation issue codes", () => {
    expect(GenerationObservationSchema.safeParse({
      ...safeEvent,
      diagnostics: { sessionValidationIssueCode: "streamed_target_subject" },
    }).success).toBe(true);
    expect(GenerationObservationSchema.safeParse({
      ...safeEvent,
      diagnostics: { sessionValidationIssueCode: "private Product Rule target" },
    }).success).toBe(false);
  });

  it("keeps ordinary typed-recall and scheduled-review format failures distinct", () => {
    for (const issueCode of ["session_required_typed_recall", "scheduled_retrieval_format"] as const) {
      expect(GenerationObservationSchema.safeParse({
        ...safeEvent,
        finalOutcome: "failure",
        failedValidator: issueCode,
        repairSucceeded: false,
        diagnostics: { sessionValidationIssueCode: issueCode },
      }).success).toBe(true);
    }
  });

  it("accepts the privacy-safe deterministic practice-metadata repair code", () => {
    expect(GenerationObservationSchema.safeParse({
      ...safeEvent,
      diagnostics: { sessionValidationIssueCode: "session_practice_metadata" },
    }).success).toBe(true);
  });

  it("accepts UUID-only session correlation diagnostics", () => {
    expect(GenerationObservationSchema.safeParse({
      ...safeEvent,
      diagnostics: {
        sessionRequestId: "d870b3e3-4286-4709-8a16-86bb785edcd9",
        planSessionId: "c2da486e-5ba0-4bc6-af7d-d8f5bb3d21af",
      },
    }).success).toBe(true);
    expect(GenerationObservationSchema.safeParse({
      ...safeEvent,
      diagnostics: {
        sessionRequestId: "private learner session reference",
        planSessionId: "not-a-uuid",
      },
    }).success).toBe(false);
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

  it("rejects raw provider and learner-bearing lesson diagnostics", () => {
    for (const diagnostics of [
      { providerMessage: "The provider echoed the learner's private goal." },
      { lessonSubstanceNote: "The lesson omitted the learner's private essential idea." },
    ]) {
      expect(GenerationObservationSchema.safeParse({
        ...safeEvent,
        generationType: "lesson",
        diagnostics,
      }).success).toBe(false);
    }

    expect(GenerationObservationSchema.safeParse({
      ...safeEvent,
      generationType: "lesson",
      diagnostics: {
        lessonTruncatedToBudget: true,
        lessonQualityNote: "slightly_below_word_floor",
      },
    }).success).toBe(true);
    expect(GenerationObservationSchema.safeParse({
      ...safeEvent,
      generationType: "lesson",
      diagnostics: {
        lessonQualityNote: "missing the learner's private osmosis target",
      },
    }).success).toBe(false);
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

  it("records an allowance fallback separately from a provider failure", () => {
    expect(GenerationObservationSchema.safeParse({
      ...safeEvent,
      generationType: "lesson",
      finalOutcome: "fallback",
      firstAttemptPassed: false,
      failedValidator: null,
      diagnostics: {
        streamCompleted: true,
        lessonFailureKind: "allowance_exhausted",
      },
    }).success).toBe(true);
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
