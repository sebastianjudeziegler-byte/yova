import { describe, expect, it } from "vitest";
import { generatePreviewPlan } from "@/lib/plan-generation/preview-generator";
import {
  LearningPlanSchema,
  MAX_GENERATED_PLAN_SESSIONS,
  MAX_RUNTIME_PLAN_SESSIONS,
  PlanActivationRequestSchema,
  PlanGenerationResponseSchema,
  PlanGenerationRequestSchema,
} from "@/lib/plan-generation/schema";

function matchingDraft() {
  const generationRequest = PlanGenerationRequestSchema.parse({
    intent: "plan",
    learningIntent: "learn",
    goal: "Understand photosynthesis and cellular respiration for my biology test.",
    materialMode: "none",
    materials: [],
    studyMode: "inside",
    deadline: "2026-08-14T23:59:00.000Z",
    timeZone: "America/Los_Angeles",
    diagnosticResponses: [{
      question: "Where are you starting?",
      answer: "I have not learned this yet",
      evaluation: "self_report",
    }],
    availability: [{ day: "Monday", window: "Evening", minutes: 25 }],
    profileSummary: "The learner prefers direct explanations, examples, and short structured sessions.",
  });
  return { generationRequest, plan: generatePreviewPlan(generationRequest) };
}

describe("plan activation contract", () => {
  it("accepts the richer learner profile used by personalized plan generation", () => {
    const draft = matchingDraft();
    const detailedProfile = Array.from({ length: 14 }, (_, index) => `Signal ${index + 1}: examples, independent application, and bounded support.`).join(" ");

    expect(detailedProfile.length).toBeGreaterThan(800);
    expect(PlanGenerationRequestSchema.safeParse({
      ...draft.generationRequest,
      profileSummary: detailedProfile,
    }).success).toBe(true);
  });

  it("accepts a generated draft that still matches its setup", () => {
    const draft = matchingDraft();

    expect(draft.plan.status).toBe("draft");
    expect(PlanActivationRequestSchema.safeParse(draft).success).toBe(true);
  });

  it("allows non-knowledge work to skip an irrelevant diagnostic", () => {
    const generationRequest = PlanGenerationRequestSchema.parse({
      ...matchingDraft().generationRequest,
      goal: "Complete a 1,500-word history essay using the assigned sources.",
      startingContext: "I have not started the essay yet.",
      diagnosticResponses: [],
    });
    const plan = generatePreviewPlan(generationRequest);

    expect(PlanActivationRequestSchema.safeParse({ plan, generationRequest }).success).toBe(true);
  });

  it("uses the learner evidence that generation used when validating activation", () => {
    const draft = matchingDraft();

    expect(draft.generationRequest.learningIntent).toBe("learn");
    expect(draft.plan.learningIntent).toBe("learn");
    expect(PlanActivationRequestSchema.safeParse(draft).success).toBe(true);
  });

  it("rejects an already active plan", () => {
    const draft = matchingDraft();

    expect(PlanActivationRequestSchema.safeParse({
      ...draft,
      plan: { ...draft.plan, status: "active" },
    }).success).toBe(false);
  });

  it("rejects a draft whose source or learner intent changed after generation", () => {
    const draft = matchingDraft();

    expect(PlanActivationRequestSchema.safeParse({
      ...draft,
      plan: { ...draft.plan, sourceMode: "user_materials", learningIntent: "study" },
    }).success).toBe(false);
  });

  it("keeps generation at 14 sessions while allowing bounded runtime verification rows", () => {
    const draft = matchingDraft();
    const template = draft.plan.sessions[0]!;
    const sessions = Array.from({ length: MAX_RUNTIME_PLAN_SESSIONS }, (_, index) => ({
      ...template,
      id: `runtime-session-${index + 1}`,
      sequence: index + 1,
    }));
    const runtimePlan = { ...draft.plan, sessions };

    expect(MAX_GENERATED_PLAN_SESSIONS).toBe(14);
    expect(LearningPlanSchema.safeParse(runtimePlan).success).toBe(true);
    expect(LearningPlanSchema.safeParse({
      ...runtimePlan,
      sessions: [...sessions, { ...template, id: "runtime-session-29", sequence: 29 }],
    }).success).toBe(false);
    expect(PlanActivationRequestSchema.safeParse({
      ...draft,
      plan: { ...draft.plan, sessions: sessions.slice(0, MAX_GENERATED_PLAN_SESSIONS + 1) },
    }).success).toBe(false);
    expect(PlanGenerationResponseSchema.safeParse({
      plan: { ...draft.plan, sessions: sessions.slice(0, MAX_GENERATED_PLAN_SESSIONS + 1) },
      generation: {
        mode: "preview",
        model: null,
        notice: null,
        requestId: "request-id",
        durationMs: 1,
        persistence: "draft",
      },
    }).success).toBe(false);
  });
});
