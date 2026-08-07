import { describe, expect, it } from "vitest";
import type { LearningPlan, SessionCompletion, SessionInterruption } from "@/lib/domain";
import { buildPersonalizationRecommendations } from "@/lib/personalization/recommendations";

const plan: LearningPlan = {
  id: "00000000-0000-4000-8000-000000000001",
  learningItemId: "00000000-0000-4000-8000-000000000002",
  title: "Calculus derivatives",
  topic: "Product and quotient rules",
  kind: "test",
  deadline: "2026-08-10",
  status: "active",
  sourceMode: "yova_generated",
  studyMode: "inside_yova",
  learningIntent: "learn",
  rationale: "Build a model, then fade support into independent problems.",
  createdAt: "2026-08-06T12:00:00.000Z",
  sessions: [],
};

describe("personalization recommendations", () => {
  it("recommends more context and real session evidence during cold start", () => {
    const result = buildPersonalizationRecommendations({
      answers: [],
      plans: [plan],
      completions: [],
      interruptions: [],
    });

    expect(result.map((item) => item.id)).toContain("add-learning-context");
    expect(result.map((item) => item.id)).toContain("collect-first-evidence");
    expect(result.map((item) => item.id)).toContain("add-goal-context");
  });

  it("turns a confident miss into a misconception-repair recommendation", () => {
    const completion: SessionCompletion = {
      id: "00000000-0000-4000-8000-000000000003",
      planId: plan.id,
      planSessionId: "00000000-0000-4000-8000-000000000004",
      startedAt: "2026-08-06T12:00:00.000Z",
      completedAt: "2026-08-06T12:20:00.000Z",
      plannedMinutes: 20,
      actualMinutes: 18,
      correctAnswers: 1,
      totalAnswers: 2,
      feedback: "about_right",
      observedGap: "Choosing the quotient rule",
      conceptEvidence: [],
      confidenceEvidence: [{
        concept: "Quotient rule",
        confidence: "very_sure",
        correct: false,
        activityType: "free_response",
      }],
    };
    const result = buildPersonalizationRecommendations({
      answers: [],
      plans: [plan],
      completions: [completion],
      interruptions: [],
    });

    expect(result[0].id).toBe("add-learning-context");
    expect(result.map((item) => item.id)).toContain("repair-confident-miss");
  });

  it("does not silently reinterpret learner-corrected interruption evidence", () => {
    const answers = Array.from({ length: 16 }, () => "");
    answers[15] = "I was interrupted by class ending; the session length was fine.";
    const interruption: SessionInterruption = {
      id: "00000000-0000-4000-8000-000000000005",
      planId: plan.id,
      planSessionId: "00000000-0000-4000-8000-000000000006",
      startedAt: "2026-08-06T12:00:00.000Z",
      interruptedAt: "2026-08-06T12:05:00.000Z",
      plannedMinutes: 20,
      actualMinutes: 5,
      completedSteps: 1,
      totalSteps: 5,
    };
    const result = buildPersonalizationRecommendations({
      answers,
      plans: [plan],
      completions: [],
      interruptions: [interruption, { ...interruption, id: "00000000-0000-4000-8000-000000000007" }],
    });

    expect(result.map((item) => item.id)).toContain("learner-correction-active");
    expect(result.map((item) => item.id)).not.toContain("reduce-switching");
    expect(result.find((item) => item.id === "learner-correction-active")?.explanation).toMatch(/compare it with future task-specific evidence/i);
  });
});
