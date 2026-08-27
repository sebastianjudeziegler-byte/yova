import { describe, expect, it } from "vitest";
import {
  DIAGNOSTIC_OPTION_MAX_LENGTH,
  DIAGNOSTIC_QUESTION_MAX_LENGTH,
  DiagnosticResponseSchema,
  GeneratedPlanDraftSchema,
  PlanDiagnosticQuestionSchema,
  PlanGenerationRequestSchema,
  ProviderGeneratedPlanDraftSchema,
} from "@/lib/plan-generation/schema";

describe("placement question round trip", () => {
  const longQuestion = "In cells, ATP is useful because it can donate a phosphate group to another molecule. ".repeat(4).trim().slice(0, DIAGNOSTIC_QUESTION_MAX_LENGTH);
  const longOption = "o".repeat(DIAGNOSTIC_OPTION_MAX_LENGTH);

  it("accepts every generated question length back as a diagnostic response", () => {
    const generated = PlanDiagnosticQuestionSchema.parse({
      id: crypto.randomUUID(),
      topicId: crypto.randomUUID(),
      prompt: longQuestion,
      options: [longOption, "b", "c", "I don't know yet"],
      correctAnswer: longOption,
    });

    const echoed = DiagnosticResponseSchema.safeParse({
      questionId: generated.id,
      topicId: generated.topicId,
      question: generated.prompt,
      answer: generated.correctAnswer,
      evaluation: "correct",
    });

    expect(echoed.success).toBe(true);
  });
});

describe("Study Now request contract", () => {
  const request = {
    intent: "study_now" as const,
    learningIntent: "learn" as const,
    goal: "Understand the product rule and apply it to unfamiliar functions.",
    materialMode: "none" as const,
    materials: [],
    studyMode: "inside" as const,
    deadline: null,
    timeZone: "UTC",
    diagnosticResponses: [],
    availability: [{ day: "Sunday", window: "Now", minutes: 25 }],
    profileSummary: "Use one concise explanation, a worked example, and an independent check.",
  };

  it("requires exactly one hard availability maximum", () => {
    expect(PlanGenerationRequestSchema.safeParse(request).success).toBe(true);
    expect(PlanGenerationRequestSchema.safeParse({
      ...request,
      availability: [
        request.availability[0],
        { day: "Monday", window: "Evening", minutes: 45 },
      ],
    }).success).toBe(false);
  });

  it("accepts a bounded Study Now method choice and rejects it on a multi-session plan", () => {
    expect(PlanGenerationRequestSchema.safeParse({
      ...request,
      methodChoice: { methodId: "self_explanation" },
    }).success).toBe(true);
    expect(PlanGenerationRequestSchema.safeParse({
      ...request,
      intent: "plan",
      methodChoice: { methodId: "self_explanation" },
    }).success).toBe(false);
    expect(PlanGenerationRequestSchema.safeParse({
      ...request,
      methodChoice: { methodId: "invented_method" },
    }).success).toBe(false);
  });
});

describe("provider plan-content contract", () => {
  it("does not ask the planning model to choose or justify a study method", () => {
    const providerDraft = ProviderGeneratedPlanDraftSchema.parse({
      title: "Product rule plan",
      topic: "Differentiating products of functions",
      kind: "skill",
      deadline: null,
      rationale: "Sequence one explanation, one application, and one later independent check.",
      deferredTopics: [],
      sessions: [{
        title: "Build the product-rule relationship",
        objective: "Explain why differentiating a product produces two derivative terms.",
        scheduledFor: "2026-08-24T18:00:00.000Z",
        estimatedMinutes: 25,
        amountLabel: "One relationship and one application",
        learningMode: "learn",
        topicIds: ["11111111-1111-4111-8111-111111111111"],
        contentTargets: ["Why the product rule has two derivative terms"],
        completionEvidence: ["Explain the two terms and apply the rule to one new product"],
      }],
    });

    expect(providerDraft.sessions[0]).not.toHaveProperty("method");
    expect(providerDraft.sessions[0]).not.toHaveProperty("methodReason");
    expect(GeneratedPlanDraftSchema.safeParse(providerDraft).success).toBe(false);
  });
});
