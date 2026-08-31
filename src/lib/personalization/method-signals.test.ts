import { describe, expect, it } from "vitest";
import type {
  LearningPlan,
  LearningPlanSession,
  SessionCompletion,
  SessionInterruption,
} from "@/lib/domain";
import { buildMethodSignals } from "@/lib/personalization/method-signals";
import { legacyPlanSessionToStudyRoute } from "@/lib/study-route/adapters";

const ROUTED_PLAN_ID = "00000000-0000-4000-8000-000000000001";

function uuid(index: number) {
  return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

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
    const { plan, completions } = routedHistory([
      "Active recall",
      "Targeted retrieval",
      "Closed-note retrieval",
      "Retrieval practice",
    ]);
    const signals = buildMethodSignals(
      [plan],
      completions,
      [],
    );

    expect(signals).toHaveLength(1);
    expect(signals[0]).toMatchObject({
      family: "retrieval",
      sessions: 4,
      distinctStudyDays: 4,
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
    expect(signal.summary).toContain("without an exact committed route");
    expect(signal.summary.toLowerCase()).not.toContain("learn best");
  });

  it("keeps repeated route-free history as context rather than strong evidence", () => {
    const sessions = [1, 2, 3, 4].map((index) => (
      makeSession(`legacy_session_${index}`, "Active recall")
    ));
    const plan = makePlan(sessions);
    const [signal] = buildMethodSignals(
      [plan],
      sessions.map((session, index) => makeCompletion(session.id, {
        id: `legacy_completion_${index}`,
        completedAt: `2026-08-${String(20 + index).padStart(2, "0")}T18:25:00.000Z`,
      })),
      [],
    );

    expect(signal).toMatchObject({
      sessions: 4,
      distinctStudyDays: 4,
      status: "early_signal",
    });
    expect(signal.summary).toContain("without an exact committed route");
  });

  it("counts one completion per immutable route revision", () => {
    const history = routedHistory([
      "Active recall",
      "Active recall",
      "Active recall",
      "Active recall",
    ]);
    const replay = {
      ...history.completions[0]!,
      id: uuid(999),
      completedAt: "2026-08-24T18:25:00.000Z",
    };
    const [signal] = buildMethodSignals(
      [history.plan],
      [...history.completions, replay],
      [],
    );

    expect(signal).toMatchObject({
      sessions: 4,
      checkedAnswers: 20,
      status: "promising",
    });
  });

  it("marks repeated difficult, low-accuracy work as needing more support", () => {
    const { plan, completions } = routedHistory([
      "Mixed practice",
      "Mixed practice",
      "Mixed practice",
      "Mixed practice",
    ], {
      correctAnswers: 1,
      feedback: "too_difficult",
    });
    const signals = buildMethodSignals(
      [plan],
      completions,
      [],
    );

    expect(signals[0]).toMatchObject({
      family: "practice",
      averageAccuracy: 20,
      difficultRatings: 4,
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

  it("uses the committed route for method family and comparison scope and rejects stale evidence", () => {
    const sessionId = "00000000-0000-4000-8000-000000000071";
    const planId = "00000000-0000-4000-8000-000000000072";
    const routeRevisionId = "00000000-0000-4000-8000-000000000073";
    const session = makeSession(sessionId, "Active recall");
    const routedPlan: LearningPlan = {
      ...makePlan([session]),
      id: planId,
      learningItemId: "00000000-0000-4000-8000-000000000074",
    };
    const route = legacyPlanSessionToStudyRoute({
      plan: routedPlan,
      session,
      adaptedAt: "2026-08-05T17:00:00.000Z",
      identity: {
        routeLineageId: "00000000-0000-4000-8000-000000000075",
        routeRevisionId,
        lifecycleStatus: "committed",
        createdAt: "2026-08-05T16:59:00.000Z",
        committedAt: "2026-08-05T17:00:00.000Z",
      },
    });
    if (!route) throw new Error("Expected a route for the method-signal test.");
    session.studyRoute = route;
    // Route authority wins even if an old scalar label becomes stale.
    session.method = "Worked examples";
    const exact = {
      ...makeCompletion(sessionId),
      planId,
      routeRevisionId,
    };

    const [signal] = buildMethodSignals([routedPlan], [
      exact,
      {
        ...exact,
        id: "00000000-0000-4000-8000-000000000076",
        routeRevisionId: "00000000-0000-4000-8000-000000000077",
      },
    ], []);

    expect(signal).toMatchObject({
      family: "retrieval",
      sessions: 1,
      taskType: route.target.taskFamily,
    });
  });
});

function routedHistory(
  methods: string[],
  completionOverrides: Partial<SessionCompletion> = {},
) {
  const sessions = methods.map((method, index) => (
    makeSession(uuid(100 + index), method)
  ));
  const routeFreePlan: LearningPlan = {
    ...makePlan(sessions),
    id: ROUTED_PLAN_ID,
    learningItemId: uuid(2),
  };
  const routedSessions = sessions.map((session, index) => {
    const routeRevisionId = uuid(300 + index);
    const route = legacyPlanSessionToStudyRoute({
      plan: routeFreePlan,
      session,
      adaptedAt: "2026-08-01T18:00:00.000Z",
      identity: {
        routeLineageId: uuid(200 + index),
        routeRevisionId,
        lifecycleStatus: "committed",
        createdAt: "2026-08-01T17:59:00.000Z",
        committedAt: "2026-08-01T18:00:00.000Z",
      },
    });
    if (!route) throw new Error("Expected an exact routed method-history fixture.");
    return { ...session, studyRoute: route };
  });
  const plan = { ...routeFreePlan, sessions: routedSessions };
  const completions = routedSessions.map((session, index) => ({
    ...makeCompletion(session.id, {
      id: uuid(400 + index),
      planId: plan.id,
      routeRevisionId: session.studyRoute!.identity.routeRevisionId,
      startedAt: `2026-08-${String(20 + index).padStart(2, "0")}T18:00:00.000Z`,
      completedAt: `2026-08-${String(20 + index).padStart(2, "0")}T18:25:00.000Z`,
    }),
    ...completionOverrides,
  }));
  return { plan, completions };
}
