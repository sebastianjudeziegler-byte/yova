import { describe, expect, it } from "vitest";
import type { LearningPlanSession, SessionCompletion } from "@/lib/domain";
import {
  approvedPostSessionChanges,
  buildPostSessionDecision,
} from "@/lib/personalization/post-session-decision";

const currentSession: LearningPlanSession = {
  id: "session_current",
  sequence: 1,
  title: "Understand cellular respiration",
  objective: "Explain how the stages connect.",
  method: "Self-explanation",
  methodReason: "Build a connected model first.",
  scheduledFor: "2026-08-06T16:00:00.000Z",
  estimatedMinutes: 25,
  amountLabel: "One model and a check · about 25 min",
  learningMode: "learn",
  status: "ready",
};

const nextSession: LearningPlanSession = {
  ...currentSession,
  id: "session_next",
  sequence: 2,
  title: "Apply cellular respiration",
  objective: "Use the stages in new situations.",
  method: "Mixed practice",
  methodReason: "Apply the connected model.",
  status: "upcoming",
};

function completion(overrides: Partial<SessionCompletion> = {}): SessionCompletion {
  return {
    id: "completion_current",
    planId: "plan_biology",
    planSessionId: currentSession.id,
    startedAt: "2026-08-06T16:00:00.000Z",
    completedAt: "2026-08-06T16:25:00.000Z",
    plannedMinutes: 25,
    actualMinutes: 24,
    correctAnswers: 3,
    totalAnswers: 3,
    feedback: "about_right",
    observedGap: "No major gap detected in the required check",
    conceptEvidence: [],
    confidenceEvidence: [],
    ...overrides,
  };
}

describe("buildPostSessionDecision", () => {
  it("proposes a changed next session when evidence supports a repair", () => {
    const decision = buildPostSessionDecision(currentSession, nextSession, completion({
      correctAnswers: 1,
      totalAnswers: 3,
      observedGap: "electron transport chain",
    }));

    expect(decision.kind).toBe("adapt_next_session");
    expect(decision.adaptation?.title).toBe(nextSession.title);
    expect(decision.adaptation?.objective).toBe(nextSession.objective);
    expect(decision.explanation).toContain("not replace the next target");
    expect(decision.reviewPlan?.title).toContain("electron transport chain");
    expect(decision.reviewPlan?.scheduledFor).toBe("2026-08-07T16:25:00.000Z");
    expect(decision.changes).toHaveLength(3);
  });

  it("proposes delayed verification when the last planned session exposes a gap", () => {
    const decision = buildPostSessionDecision(currentSession, null, completion({
      correctAnswers: 2,
      totalAnswers: 3,
      observedGap: "cellular respiration sequence",
    }));

    expect(decision.kind).toBe("add_delayed_verification");
    expect(decision.followUpSession?.scheduledFor).toBe("2026-08-07T16:25:00.000Z");
    expect(decision.followUpSession?.estimatedMinutes).toBe(10);
    expect(decision.reviewPlan?.estimatedMinutes).toBe(10);
  });

  it("recommends no change after strong evidence at an appropriate challenge level", () => {
    const decision = buildPostSessionDecision(currentSession, nextSession, completion());

    expect(decision.kind).toBe("keep_current_plan");
    expect(decision.adaptation).toBeNull();
    expect(decision.followUpSession).toBeNull();
    expect(decision.reviewPlan).toBeNull();
  });

  it("does not apply a recommendation when the learner keeps the current plan", () => {
    const decision = buildPostSessionDecision(currentSession, nextSession, completion({
      correctAnswers: 1,
      totalAnswers: 3,
      observedGap: "electron transport chain",
    }));

    expect(approvedPostSessionChanges(decision, false)).toEqual({
      adaptation: null,
      followUpSession: null,
    });
    expect(approvedPostSessionChanges(decision, true).adaptation).not.toBeNull();
  });
});
