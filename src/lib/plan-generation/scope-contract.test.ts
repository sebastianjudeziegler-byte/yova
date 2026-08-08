import { describe, expect, it } from "vitest";
import { inferPlanScopeContract } from "@/lib/plan-generation/scope-contract";
import { PlanGenerationRequestSchema } from "@/lib/plan-generation/schema";

function request(goal: string) {
  return PlanGenerationRequestSchema.parse({
    intent: "plan",
    learningIntent: "learn",
    goal,
    startingContext: "I am starting from ground zero.",
    materialMode: "none",
    materials: [],
    studyMode: "inside",
    deadline: null,
    timeZone: "America/Los_Angeles",
    diagnosticResponses: [{
      question: "Where are you starting?",
      answer: "Completely new",
      evaluation: "self_report",
    }],
    availability: [{ day: "Monday", window: "Evening", minutes: 25 }],
    profileSummary: "The learner wants explicit steps and concise explanations before practice.",
  });
}

describe("plan scope contract", () => {
  it("keeps a named skill bounded", () => {
    const scope = inferPlanScopeContract(request("Learn the product rule from scratch."));
    expect(scope.band).toBe("focused_skill");
    expect(scope.recommendedSessions).toBe(4);
    expect(scope.maximumSessions).toBe(6);
  });

  it("expands a whole subject into a broad pathway", () => {
    const scope = inferPlanScopeContract(request("Learn all of calculus from the beginning."));
    expect(scope.band).toBe("broad_course");
    expect(scope.minimumSessions).toBe(10);
    expect(scope.recommendedSessions).toBe(12);
    expect(scope.minimumTeachingSessions).toBe(4);
  });

  it("treats an exam or multi-topic goal as unit sized", () => {
    const scope = inferPlanScopeContract(request("Prepare for my biology test on respiration, photosynthesis, and enzymes."));
    expect(scope.band).toBe("unit_or_exam");
    expect(scope.recommendedSessions).toBe(7);
  });
});
