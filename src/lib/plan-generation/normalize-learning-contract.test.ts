import { describe, expect, it } from "vitest";
import { normalizeGeneratedPlanLearningContract } from "@/lib/plan-generation/normalize-learning-contract";
import {
  GeneratedPlanDraftSchema,
  PlanGenerationRequestSchema,
} from "@/lib/plan-generation/schema";

const request = PlanGenerationRequestSchema.parse({
  intent: "plan",
  learningIntent: "learn",
  goal: "Learn calculus from the beginning, including limits, derivatives, and integrals.",
  materialMode: "none",
  materials: [],
  studyMode: "inside",
  deadline: null,
  timeZone: "America/Los_Angeles",
  diagnosticResponses: [],
  availability: [{ day: "Monday", window: "Evening", minutes: 30 }],
  profileSummary: "The learner wants an overall map and one complete example before trying a problem.",
});

const draft = GeneratedPlanDraftSchema.parse({
  title: "Calculus Foundations",
  topic: "Limits, derivatives, and integrals",
  kind: "course",
  deadline: null,
  rationale: "Build the prerequisites and then move toward independent mathematical use.",
  sessions: [{
    title: "Build the derivative model",
    objective: "Understand the derivative as an instantaneous rate and calculate one derivative.",
    method: "Read-recall-review",
    methodReason: "Read the explanation before looking at an example.",
    scheduledFor: "2026-08-10T19:00:00.000-07:00",
    estimatedMinutes: 30,
    amountLabel: "One derivative model and one example",
    learningMode: "learn",
    contentTargets: ["The derivative as an instantaneous rate"],
    completionEvidence: ["Review the worked example and spend time checking the steps"],
  }],
});

describe("generated plan learning contract", () => {
  it("replaces task-incompatible methods and passive completion with active evidence", () => {
    const normalized = normalizeGeneratedPlanLearningContract(draft, request);

    expect(normalized.sessions[0].method).toBe("Worked example fading");
    expect(normalized.sessions[0].methodReason).toMatch(/problem solving/i);
    expect(normalized.sessions[0].completionEvidence[0]).toMatch(/^Solve /);
  });
});
