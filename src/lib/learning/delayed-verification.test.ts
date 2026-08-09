import { describe, expect, it } from "vitest";
import type { LearningPlanSession, SessionCompletion } from "@/lib/domain";
import { buildDelayedVerificationSession } from "@/lib/learning/delayed-verification";

const completedSession: LearningPlanSession = {
  id: "session-current",
  sequence: 1,
  title: "Focused review",
  objective: "Review cellular respiration.",
  method: "Retrieval practice",
  methodReason: "Practice from memory.",
  scheduledFor: "2026-08-05T16:00:00.000Z",
  estimatedMinutes: 25,
  amountLabel: "3 checks · about 25 min",
  learningMode: "study",
  resource: {
    rationale: "A prior practice session checked one bounded relationship.",
    activities: [{
      methodPhase: "independent_practice",
      estimatedMinutes: 3,
      requiredForCompletion: true,
      type: "multiple_choice",
      concept: "Cellular respiration sequence",
      label: "Check",
      title: "Trace energy through the three stages",
      body: "Glycolysis occurs in the cytosol, the citric acid cycle in the matrix, and oxidative phosphorylation at the inner mitochondrial membrane. Which order is correct?",
      teaching: null,
      choices: ["Cytosol, matrix, inner membrane", "Matrix, cytosol, inner membrane", "Inner membrane, matrix, cytosol"],
      correctAnswer: "Cytosol, matrix, inner membrane",
      feedback: "The pathway moves from glycolysis in the cytosol to the matrix and then to the inner membrane.",
    }],
    generatedAt: "2026-08-05T15:55:00.000Z",
    origin: "generated",
  },
  status: "ready",
};

function completion(overrides: Partial<SessionCompletion> = {}): SessionCompletion {
  return {
    id: "completion-current",
    planId: "plan-current",
    planSessionId: completedSession.id,
    startedAt: "2026-08-05T16:00:00.000Z",
    completedAt: "2026-08-05T16:25:00.000Z",
    plannedMinutes: 25,
    actualMinutes: 25,
    correctAnswers: 2,
    totalAnswers: 3,
    feedback: "about_right",
    observedGap: "Cellular respiration sequence",
    conceptEvidence: [],
    confidenceEvidence: [],
    ...overrides,
  };
}

describe("buildDelayedVerificationSession", () => {
  it("schedules a short spaced check after a one-off session miss", () => {
    const result = buildDelayedVerificationSession(completedSession, completion());

    expect(result).toMatchObject({
      sequence: 2,
      estimatedMinutes: 10,
      method: "Spaced retrieval and error repair",
      learningMode: "study",
      reviewConcept: "Cellular respiration sequence",
      reviewType: "verify",
      status: "ready",
    });
    expect(result?.scheduledFor).toBe("2026-08-06T16:25:00.000Z");
    expect(result?.adaptationNote?.explanation).toContain("delayed retrieval");
    expect(result?.objective).toContain("self-contained questions");
    expect(result?.methodReason).toContain("Glycolysis occurs in the cytosol");
  });

  it("keeps a confident-miss return short while preserving the repair signal", () => {
    const result = buildDelayedVerificationSession(completedSession, completion({
      confidenceEvidence: [{
        concept: "Cellular respiration sequence",
        confidence: "very_sure",
        correct: false,
        activityType: "multiple_choice",
      }],
    }));

    expect(result).toMatchObject({
      method: "Misconception repair and delayed transfer",
      learningMode: "study",
      reviewConcept: "Cellular respiration sequence",
      reviewType: "repair_and_retrieve",
    });
  });

  it("does not manufacture follow-up work after a secure check", () => {
    expect(buildDelayedVerificationSession(completedSession, completion({
      correctAnswers: 3,
      totalAnswers: 3,
      observedGap: "No major gap detected in the required check",
    }))).toBeNull();
  });

  it("does not schedule the same gap again after an in-session repair was completed", () => {
    expect(buildDelayedVerificationSession(completedSession, completion({
      conceptEvidence: [{
        concept: "Cellular respiration sequence",
        outcome: "secure",
        activityType: "free_response",
        methodPhase: "repair",
      }],
    }))).toBeNull();
  });

  it("schedules only a later unrepaired gap when earlier gaps were repaired in-session", () => {
    const result = buildDelayedVerificationSession(completedSession, completion({
      observedGap: "Cellular respiration sequence; ATP production",
      conceptEvidence: [{
        concept: "Cellular respiration sequence",
        outcome: "secure",
        activityType: "free_response",
        methodPhase: "repair",
      }],
    }));

    expect(result?.reviewConcept).toBe("ATP production");
  });
});
