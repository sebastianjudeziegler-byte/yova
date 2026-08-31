import { describe, expect, it } from "vitest";
import type { LearningPlan, SessionCompletion, SessionInterruption } from "@/lib/domain";
import { buildPersonalizationRecommendations } from "@/lib/personalization/recommendations";
import {
  defaultPersonalizationState,
  writePersonalizationStateToAnswers,
} from "@/lib/personalization/personalization-state";
import { legacyPlanSessionToStudyRoute } from "@/lib/study-route/adapters";

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

  it("recommends restoring support when repeated method results are weak", () => {
    const sessions = [1, 2, 3, 4].map((sequence) => ({
      id: `00000000-0000-4000-8000-00000000001${sequence}`,
      sequence,
      title: `Product-rule practice ${sequence}`,
      objective: "Choose and apply the product rule independently.",
      method: "Practice Problems",
      methodReason: "Problems require independent method selection.",
      scheduledFor: `2026-08-${String(6 + sequence).padStart(2, "0")}T12:00:00.000Z`,
      estimatedMinutes: 20,
      amountLabel: "Four problems",
      learningMode: "study" as const,
      status: "complete" as const,
    }));
    const routeFreePlan: LearningPlan = { ...plan, sessions };
    const routedSessions = sessions.map((session, index) => {
      const routeRevisionId = `00000000-0000-4000-8000-0000000001${String(index).padStart(2, "0")}`;
      const route = legacyPlanSessionToStudyRoute({
        plan: routeFreePlan,
        session,
        adaptedAt: "2026-08-06T11:00:00.000Z",
        identity: {
          routeLineageId: `00000000-0000-4000-8000-0000000002${String(index).padStart(2, "0")}`,
          routeRevisionId,
          lifecycleStatus: "committed",
          createdAt: "2026-08-06T10:59:00.000Z",
          committedAt: "2026-08-06T11:00:00.000Z",
        },
      });
      if (!route) throw new Error("Expected a routed recommendation fixture.");
      return { ...session, studyRoute: route };
    });
    const methodPlan: LearningPlan = { ...routeFreePlan, sessions: routedSessions };
    const completions: SessionCompletion[] = routedSessions.map((session, index) => ({
      id: `00000000-0000-4000-8000-00000000002${index}`,
      planId: methodPlan.id,
      planSessionId: session.id,
      routeRevisionId: session.studyRoute!.identity.routeRevisionId,
      startedAt: "2026-08-06T12:00:00.000Z",
      completedAt: `2026-08-${String(7 + index).padStart(2, "0")}T12:20:00.000Z`,
      plannedMinutes: 20,
      actualMinutes: 20,
      correctAnswers: 1,
      totalAnswers: 4,
      feedback: "too_difficult",
      observedGap: "Selecting the product rule",
      conceptEvidence: [],
      confidenceEvidence: [],
    }));

    const result = buildPersonalizationRecommendations({
      answers: Array.from({ length: 16 }, () => "answered"),
      plans: [methodPlan],
      completions,
      interruptions: [],
    });

    expect(result.find((item) => item.id.startsWith("restore-support"))).toMatchObject({
      action: "start_session",
    });
  });

  it("does not bypass personalization controls with legacy Home recommendations", () => {
    const defaults = defaultPersonalizationState();
    const answers = writePersonalizationStateToAnswers([], {
      ...defaults,
      controls: {
        ...defaults.controls,
        selfReport: false,
        behavior: false,
        optionalQuestions: false,
      },
    });
    answers[15] = "That interruption was caused by class ending.";
    const interruption: SessionInterruption = {
      id: "00000000-0000-4000-8000-000000000031",
      planId: plan.id,
      planSessionId: "00000000-0000-4000-8000-000000000032",
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
      interruptions: [
        interruption,
        { ...interruption, id: "00000000-0000-4000-8000-000000000033" },
      ],
    });

    expect(result.map((item) => item.id)).toEqual(["add-goal-context"]);
  });

  it("does not prompt for deeper profile answers when optional questions are off", () => {
    const defaults = defaultPersonalizationState();
    const answers = writePersonalizationStateToAnswers([], {
      ...defaults,
      controls: { ...defaults.controls, optionalQuestions: false },
    });

    const result = buildPersonalizationRecommendations({
      answers,
      plans: [plan],
      completions: [],
      interruptions: [],
    });

    expect(result.map((item) => item.id)).not.toContain("add-learning-context");
    expect(result.map((item) => item.id)).toContain("collect-first-evidence");
  });

  it("suppresses a legacy interruption recommendation when the signal is paused", () => {
    const defaults = defaultPersonalizationState();
    const answers = writePersonalizationStateToAnswers([], {
      ...defaults,
      pausedSignalIds: ["signal:starting_friction"],
    });
    const interruption: SessionInterruption = {
      id: "00000000-0000-4000-8000-000000000041",
      planId: plan.id,
      planSessionId: "00000000-0000-4000-8000-000000000042",
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
      interruptions: [
        interruption,
        { ...interruption, id: "00000000-0000-4000-8000-000000000043" },
      ],
    });

    expect(result.map((item) => item.id)).not.toContain("reduce-switching");
  });
});
