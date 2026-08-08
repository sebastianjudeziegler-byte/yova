import { describe, expect, it } from "vitest";
import { materializePlanDraft } from "@/lib/plan-generation/materialize-plan";
import type { GeneratedPlanDraft, PlanGenerationRequest } from "@/lib/plan-generation/schema";

const request: PlanGenerationRequest = {
  intent: "plan",
  learningIntent: "learn",
  goal: "I know nothing about World War I and need to prepare for a test",
  materialMode: "none",
  materials: [],
  studyMode: "inside",
  deadline: null,
  timeZone: "America/Los_Angeles",
  diagnosticResponses: [
    { question: "Where are you starting?", answer: "Completely new", evaluation: "self_report" },
  ],
  availability: [{ day: "Friday", window: "Evening", minutes: 25 }],
  profileSummary: "The learner wants a clear big-picture explanation before independent work.",
};

const staleDraft: GeneratedPlanDraft = {
  title: "World War I",
  topic: "World War I causes and escalation",
  kind: "test",
  deadline: null,
  rationale: "Prepare for the assessment with a sequence of focused learning sessions.",
  sessions: [{
    title: "Recall the July Crisis",
    objective: "Recall the causes of World War I without looking at an explanation.",
    method: "Retrieval practice",
    methodReason: "Starting with recall can expose gaps.",
    scheduledFor: "2026-08-07T18:00:00.000-07:00",
    estimatedMinutes: 25,
    amountLabel: "One target and one check",
    learningMode: "study",
    contentTargets: ["How alliances and mobilization widened the war"],
    completionEvidence: ["Answer one question about the July Crisis"],
  }],
};

describe("materializePlanDraft", () => {
  it("treats the learner's requested starting approach as authoritative", () => {
    const plan = materializePlanDraft(staleDraft, request);

    expect(plan.sessions[0]).toMatchObject({
      learningMode: "learn",
      method: "Guided explanation and self-explanation",
    });
    expect(plan.sessions[0].objective).toMatch(/first mental model/i);
  });

  it("repairs generic generated titles before a plan reaches Learning", () => {
    const plan = materializePlanDraft({
      ...staleDraft,
      title: "Personalized learning plan",
    }, {
      ...request,
      goal: "I want to learn new vocabulary words so I can be better in conversation",
    });

    expect(plan.title).toBe("Conversation Vocabulary Builder");
  });
});
