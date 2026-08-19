import { describe, expect, it } from "vitest";
import type {
  LearningPlan,
  LearningPlanSession,
  SessionCompletion,
  SessionInterruption,
} from "@/lib/domain";
import { buildMethodSignals } from "@/lib/personalization/method-signals";

function makeSession(id: string, method: string): LearningPlanSession {
  return {
    id,
    sequence: 1,
    title: "Review cellular respiration",
    objective: "Recall and apply the main stages.",
    method,
    methodReason: "This fits the current task.",
    scheduledFor: "2026-08-05",
    estimatedMinutes: 25,
    amountLabel: "25 minutes",
    learningMode: "study",
    status: "complete",
  };
}

function makePlan(sessions: LearningPlanSession[]): LearningPlan {
  return {
    id: "plan_biology",
    learningItemId: "item_biology",
    title: "AP Biology Unit 3",
    topic: "Cellular respiration",
    kind: "test",
    deadline: "2026-08-10",
    status: "active",
    sourceMode: "yova_generated",
    studyMode: "inside_yova",
    learningIntent: "study",
    rationale: "Prepare for the test.",
    createdAt: "2026-08-01T18:00:00.000Z",
    sessions,
  };
}

function makeCompletion(
  planSessionId: string,
  overrides: Partial<SessionCompletion> = {},
): SessionCompletion {
  return {
    id: `completion_${planSessionId}`,
    planId: "plan_biology",
    planSessionId,
    startedAt: "2026-08-05T18:00:00.000Z",
    completedAt: "2026-08-05T18:25:00.000Z",
    plannedMinutes: 25,
    actualMinutes: 24,
    correctAnswers: 4,
    totalAnswers: 5,
    feedback: "about_right",
    observedGap: "No major gap was detected",
    conceptEvidence: [],
    confidenceEvidence: [],
    ...overrides,
  };
}

function makeInterruption(planSessionId: string): SessionInterruption {
  return {
    id: `interruption_${planSessionId}`,
    planId: "plan_biology",
    planSessionId,
    startedAt: "2026-08-05T18:00:00.000Z",
    interruptedAt: "2026-08-05T18:08:00.000Z",
    plannedMinutes: 25,
    actualMinutes: 8,
    completedSteps: 1,
    totalSteps: 4,
  };
}

describe("buildMethodSignals", () => {
  it("groups comparable sessions and reports a promising signal cautiously", () => {
    const plan = makePlan([
      makeSession("session_one", "Active recall"),
      makeSession("session_two", "Targeted retrieval"),
    ]);
    const signals = buildMethodSignals(
      [plan],
      [makeCompletion("session_one"), makeCompletion("session_two")],
      [],
    );

    expect(signals).toHaveLength(1);
    expect(signals[0]).toMatchObject({
      family: "retrieval",
      sessions: 2,
      averageAccuracy: 80,
      status: "promising",
    });
    expect(signals[0].summary).toContain("not proof");
    expect(signals[0].comparisonLabel).toContain("concept learning");
  });

  it("keeps the same method separate across unrelated tasks", () => {
    const biologySession = makeSession("session_biology", "Active recall");
    const calculusSession = {
      ...makeSession("session_calculus", "Active recall"),
      title: "Solve derivative problems",
      objective: "Differentiate equations and apply the product rule independently.",
    };
    const calculusPlan: LearningPlan = {
      ...makePlan([calculusSession]),
      id: "plan_calculus",
      learningItemId: "item_calculus",
      title: "Calculus derivatives",
      topic: "Product rule problems",
    };

    const signals = buildMethodSignals(
      [makePlan([biologySession]), calculusPlan],
      [
        makeCompletion("session_biology"),
        { ...makeCompletion("session_calculus"), planId: "plan_calculus" },
      ],
      [],
    );

    expect(signals).toHaveLength(2);
    expect(signals.every((signal) => signal.sessions === 1)).toBe(true);
    expect(new Set(signals.map((signal) => signal.taskType))).toEqual(
      new Set(["conceptual_learning", "problem_solving"]),
    );
  });

  it("keeps one session as early evidence instead of declaring a best method", () => {
    const plan = makePlan([makeSession("session_one", "Worked examples")]);
    const [signal] = buildMethodSignals([plan], [makeCompletion("session_one")], []);

    expect(signal.status).toBe("early_signal");
    expect(signal.summary).toContain("not enough");
    expect(signal.summary.toLowerCase()).not.toContain("learn best");
  });

  it("marks repeated difficult, low-accuracy work as needing more support", () => {
    const plan = makePlan([
      makeSession("session_one", "Mixed practice"),
      makeSession("session_two", "Application practice"),
    ]);
    const signals = buildMethodSignals(
      [plan],
      [
        makeCompletion("session_one", { correctAnswers: 1, feedback: "too_difficult" }),
        makeCompletion("session_two", { correctAnswers: 2, feedback: "too_difficult" }),
      ],
      [],
    );

    expect(signals[0]).toMatchObject({
      family: "practice",
      averageAccuracy: 30,
      difficultRatings: 2,
      status: "needs_support",
    });
  });

  it("counts interruptions only when the method also has completed evidence", () => {
    const plan = makePlan([
      makeSession("session_one", "Active recall"),
      makeSession("session_two", "Active recall"),
    ]);
    const [signal] = buildMethodSignals(
      [plan],
      [makeCompletion("session_one")],
      [makeInterruption("session_one"), makeInterruption("session_two")],
    );

    expect(signal.interruptions).toBe(2);
  });

  it("does not treat unguided practice as learning-method evidence", () => {
    const plan = makePlan([
      makeSession("session_one", "Active recall"),
      makeSession("session_two", "Targeted retrieval"),
    ]);
    const [signal] = buildMethodSignals(
      [plan],
      [
        makeCompletion("session_one"),
        makeCompletion("session_two", {
          completionMode: "unguided_practice",
          correctAnswers: 0,
          totalAnswers: 0,
          feedback: "too_difficult",
        }),
      ],
      [],
    );

    expect(signal).toMatchObject({
      sessions: 1,
      checkedAnswers: 5,
      correctAnswers: 4,
      difficultRatings: 0,
      status: "early_signal",
    });
  });

  it("ignores results that cannot be joined to an existing plan session", () => {
    const signals = buildMethodSignals(
      [makePlan([])],
      [makeCompletion("missing_session")],
      [makeInterruption("missing_session")],
    );

    expect(signals).toEqual([]);
  });
});
