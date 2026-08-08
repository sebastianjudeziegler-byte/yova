import { describe, expect, it } from "vitest";
import { buildPlanContentBudget, contentBudgetForMinutes } from "@/lib/plan-generation/content-budget";
import { PlanGenerationRequestSchema } from "@/lib/plan-generation/schema";

function request(overrides: Record<string, unknown> = {}) {
  return PlanGenerationRequestSchema.parse({
    intent: "plan",
    learningIntent: "learn",
    goal: "Prepare for my World War I unit test.",
    startingContext: "I am starting from ground zero.",
    materialMode: "none",
    materials: [],
    studyMode: "inside",
    deadline: null,
    timeZone: "America/Los_Angeles",
    diagnosticResponses: [{ question: "Where are you starting?", answer: "Completely new", evaluation: "self_report" }],
    availability: [{ day: "Monday", window: "Evening", minutes: 25 }],
    profileSummary: "The learner prefers explicit steps and short structured sessions.",
    ...overrides,
  });
}

describe("plan content budget", () => {
  it("reduces the normal amount of information in shorter sessions", () => {
    expect(contentBudgetForMinutes(15)).toMatchObject({ preferredContentTargets: 1, maximumContentTargets: 2 });
    expect(contentBudgetForMinutes(45)).toMatchObject({ preferredContentTargets: 3, maximumContentTargets: 4 });
  });

  it("uses outline headings to size uploaded material", () => {
    const material = [
      "# Long-term causes",
      "- Nationalism and imperial competition",
      "- Alliance systems",
      "# The July Crisis",
      "- Mobilization decisions",
      "# Major fronts",
      "- Trench warfare",
      "# United States entry",
      "# Armistice and consequences",
    ].join("\n");
    const budget = buildPlanContentBudget(request({
      materialMode: "upload",
      materials: [{ id: "10000000-1000-4000-8000-100000000001", name: "WWI guide.pdf", mimeType: "application/pdf", sizeBytes: 1000, textContent: material, processingStatus: "ready" }],
      availability: [{ day: "Monday", window: "Evening", minutes: 15 }],
    }));

    expect(budget.materialAnchors).toEqual(expect.arrayContaining(["Long-term causes", "The July Crisis", "Armistice and consequences"]));
    expect(budget.estimatedInstructionalUnits).toBeGreaterThanOrEqual(8);
    expect(budget.minimumSessions).toBeGreaterThanOrEqual(8);
  });

  it("does not turn a large reference file for one named skill into a full course", () => {
    const budget = buildPlanContentBudget(request({
      goal: "Learn the product rule from scratch.",
      materials: [{ id: "10000000-1000-4000-8000-100000000002", name: "calculus.pdf", mimeType: "application/pdf", sizeBytes: 1000, textContent: "# Product rule\n".repeat(200), processingStatus: "ready" }],
      materialMode: "upload",
    }));

    expect(budget.estimatedInstructionalUnits).toBeLessThanOrEqual(2);
    expect(budget.recommendedSessions).toBe(4);
  });
});
