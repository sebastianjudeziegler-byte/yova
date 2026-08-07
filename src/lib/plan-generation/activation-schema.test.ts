import { describe, expect, it } from "vitest";
import { generatePreviewPlan } from "@/lib/plan-generation/preview-generator";
import {
  PlanActivationRequestSchema,
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
});
