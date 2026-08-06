import { describe, expect, it } from "vitest";
import { generatePreviewPlan } from "@/lib/plan-generation/preview-generator";
import { PlanGenerationRequestSchema } from "@/lib/plan-generation/schema";

function requestWithMinutes(minutes: number) {
  return PlanGenerationRequestSchema.parse({
    intent: "plan",
    learningIntent: "learn",
    goal: "Learn how the stages of cellular respiration connect before my biology test.",
    materialMode: "none",
    materials: [],
    studyMode: "inside",
    deadline: "2026-08-14T23:59:00.000Z",
    timeZone: "America/Los_Angeles",
    diagnosticResponses: [{
      question: "How well can you explain the process now?",
      answer: "I have not learned it yet",
      evaluation: "self_report",
    }],
    availability: [{ day: "Every day", window: "Evening", minutes }],
    profileSummary: "The learner prefers explicit structure, direct explanations, and bounded steps.",
  });
}

describe("preview plan time windows", () => {
  it("creates more bounded sessions when the same content must fit shorter windows", () => {
    const fortyFiveMinutePlan = generatePreviewPlan(requestWithMinutes(45));
    const fifteenMinutePlan = generatePreviewPlan(requestWithMinutes(15));

    expect(fifteenMinutePlan.sessions.length).toBeGreaterThan(fortyFiveMinutePlan.sessions.length);
    expect(fifteenMinutePlan.sessions.every((session) => session.estimatedMinutes <= 15)).toBe(true);
    expect(fifteenMinutePlan.sessions.every((session) => session.contentTargets?.length)).toBe(true);
    expect(fifteenMinutePlan.sessions.every((session) => session.completionEvidence?.length)).toBe(true);
  });
});
