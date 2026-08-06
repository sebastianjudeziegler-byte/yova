import { describe, expect, it } from "vitest";
import type { LearningPlanSession, SessionCompletion } from "@/lib/domain";
import { buildNextSessionAdaptation } from "@/lib/personalization/session-adaptation";

const nextSession: LearningPlanSession = {
  id: "session_next",
  sequence: 2,
  title: "Apply cellular respiration",
  objective: "Compare the stages of cellular respiration in new scenarios.",
  method: "Mixed practice",
  methodReason: "Application practice follows the first retrieval session.",
  scheduledFor: "2026-08-06",
  estimatedMinutes: 25,
  amountLabel: "6 practice questions · about 25 min",
  status: "upcoming",
};

function makeCompletion(
  overrides: Partial<SessionCompletion> = {},
): SessionCompletion {
  return {
    id: "completion_current",
    planId: "plan_biology",
    planSessionId: "session_current",
    startedAt: "2026-08-05T16:00:00.000Z",
    completedAt: "2026-08-05T16:25:00.000Z",
    plannedMinutes: 25,
    actualMinutes: 25,
    correctAnswers: 4,
    totalAnswers: 5,
    feedback: "about_right",
    observedGap: "electron transport chain; ATP production",
    conceptEvidence: [],
    ...overrides,
  };
}

describe("buildNextSessionAdaptation", () => {
  it("does not invent an adaptation when there is no next session", () => {
    expect(buildNextSessionAdaptation(null, makeCompletion())).toBeNull();
  });

  it("adds guided repair when performance is low", () => {
    const result = buildNextSessionAdaptation(
      nextSession,
      makeCompletion({
        correctAnswers: 2,
        totalAnswers: 5,
        feedback: "too_difficult",
      }),
    );

    expect(result).toMatchObject({
      planSessionId: nextSession.id,
      method: "Guided repair, then retrieval",
      estimatedMinutes: nextSession.estimatedMinutes,
    });
    expect(result?.objective).toContain("electron transport chain");
    expect(result?.explanation).toContain("session felt too difficult");
  });

  it("uses targeted retrieval for a smaller knowledge gap", () => {
    const result = buildNextSessionAdaptation(
      nextSession,
      makeCompletion({ correctAnswers: 3, totalAnswers: 4 }),
    );

    expect(result?.method).toBe("Targeted retrieval and error review");
    expect(result?.title).toBe("Repair gaps, then apply cellular respiration");
    expect(result?.amountLabel).toBe("Targeted repair + planned work · about 25 min");
  });

  it("uses a safe fallback when no specific missed concept was found", () => {
    const result = buildNextSessionAdaptation(
      nextSession,
      makeCompletion({
        correctAnswers: 1,
        totalAnswers: 2,
        observedGap: "No major gap was detected",
      }),
    );

    expect(result?.objective).toContain("the missed details");
    expect(result?.explanation).not.toContain("No major gap");
  });

  it("adds support when the learner succeeded but the session felt too difficult", () => {
    const result = buildNextSessionAdaptation(
      nextSession,
      makeCompletion({
        correctAnswers: 5,
        totalAnswers: 5,
        feedback: "too_difficult",
      }),
    );

    expect(result?.method).toBe("Guided example, then mixed practice");
    expect(result?.objective).toContain("Begin with one guided example");
  });

  it("raises the challenge after strong performance that felt too easy", () => {
    const result = buildNextSessionAdaptation(
      nextSession,
      makeCompletion({
        correctAnswers: 5,
        totalAnswers: 5,
        feedback: "too_easy",
      }),
    );

    expect(result?.method).toBe("Independent application and mixed practice");
    expect(result?.explanation).toContain("5 of 5");
  });

  it("does not infer stronger performance without a knowledge check", () => {
    const result = buildNextSessionAdaptation(
      nextSession,
      makeCompletion({
        correctAnswers: 0,
        totalAnswers: 0,
        feedback: "too_easy",
      }),
    );

    expect(result).toBeNull();
  });

  it("leaves a successful, appropriately difficult session unchanged", () => {
    const result = buildNextSessionAdaptation(
      nextSession,
      makeCompletion({
        correctAnswers: 4,
        totalAnswers: 5,
        feedback: "about_right",
      }),
    );

    expect(result).toBeNull();
  });
});
