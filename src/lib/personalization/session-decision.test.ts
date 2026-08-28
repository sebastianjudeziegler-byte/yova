import { describe, expect, it } from "vitest";
import type { LearningPlan, SessionCompletion, SessionInterruption } from "@/lib/domain";
import { buildSessionDecisionSignals } from "@/lib/personalization/session-decision";
import { legacyPlanSessionToStudyRoute } from "@/lib/study-route/adapters";
import { StudyRouteSchema } from "@/lib/study-route/schema";
import {
  defaultPersonalizationState,
  setPersonalizationEvidenceRefExcluded,
  writePersonalizationStateToAnswers,
} from "@/lib/personalization/personalization-state";

const plan: LearningPlan = {
  id: "00000000-0000-4000-8000-000000000001",
  learningItemId: "00000000-0000-4000-8000-000000000002",
  title: "Calculus product rule",
  topic: "Differentiate products of functions",
  kind: "topic",
  deadline: null,
  status: "active",
  sourceMode: "yova_generated",
  studyMode: "inside_yova",
  learningIntent: "learn",
  rationale: "Build the procedure and then fade support.",
  createdAt: "2026-08-06T18:00:00.000Z",
  sessions: [{
    id: "00000000-0000-4000-8000-000000000003",
    sequence: 1,
    title: "Build the product-rule model",
    objective: "Understand why the product rule has two terms.",
    method: "Worked example fading",
    methodReason: "A model supports first-time problem solving.",
    scheduledFor: "2026-08-06T19:00:00.000Z",
    estimatedMinutes: 25,
    amountLabel: "One model and one independent check",
    learningMode: "learn",
    contentTargets: ["Explain why the product rule has two terms"],
    completionEvidence: ["Explain the two-term structure independently"],
    status: "ready",
  }],
};

function completion(overrides: Partial<SessionCompletion> = {}): SessionCompletion {
  return {
    id: "00000000-0000-4000-8000-000000000004",
    planId: plan.id,
    planSessionId: plan.sessions[0].id,
    startedAt: "2026-08-06T18:00:00.000Z",
    completedAt: "2026-08-06T18:25:00.000Z",
    plannedMinutes: 25,
    actualMinutes: 25,
    correctAnswers: 1,
    totalAnswers: 1,
    feedback: "about_right",
    observedGap: "No major gap detected",
    conceptEvidence: [],
    confidenceEvidence: [],
    ...overrides,
  };
}

describe("session decision preview", () => {
  it("shows task, learner, evidence, and source decisions without inventing a brain type", () => {
    const answers: string[] = [];
    answers[10] = "A concrete example before the rule";
    const signals = buildSessionDecisionSignals({
      plan,
      session: plan.sessions[0],
      answers,
      completions: [],
      interruptions: [],
    });

    expect(signals.map((signal) => signal.kind)).toEqual(["task", "learner", "evidence", "source"]);
    expect(signals[1].title).toBe("A concrete example before the rule");
    expect(signals[2].title).toBe("No completed-session evidence yet");
    expect(signals.map((signal) => signal.detail).join(" ")).not.toMatch(/brain type|learns best/i);
  });

  it("prioritizes a high-confidence miss over a generic performance summary", () => {
    const signals = buildSessionDecisionSignals({
      plan,
      session: plan.sessions[0],
      answers: [],
      completions: [completion({
        confidenceEvidence: [{
          concept: "Product rule structure",
          confidence: "very_sure",
          correct: false,
          activityType: "multiple_choice",
        }],
      })],
      interruptions: [],
    });

    expect(signals.find((signal) => signal.kind === "evidence")?.title).toContain("confident miss");
  });

  it("omits the learner-preference card when self-report personalization is off", () => {
    const defaults = defaultPersonalizationState();
    const answers = writePersonalizationStateToAnswers([
      "I struggle to start",
      "Tell me exactly what to do",
    ], {
      ...defaults,
      controls: { ...defaults.controls, selfReport: false },
    });
    answers[10] = "A concrete example before the rule";

    const signals = buildSessionDecisionSignals({
      plan,
      session: plan.sessions[0],
      answers,
      completions: [],
      interruptions: [],
    });

    expect(signals.some((signal) => signal.kind === "learner")).toBe(false);
  });

  it("does not infer a session-length tendency when the learner supplied a correction", () => {
    const answers: string[] = [];
    answers[15] = "Those sessions ended because class finished.";
    const interruption: SessionInterruption = {
      id: "00000000-0000-4000-8000-000000000005",
      planId: plan.id,
      planSessionId: plan.sessions[0].id,
      startedAt: "2026-08-06T18:00:00.000Z",
      interruptedAt: "2026-08-06T18:10:00.000Z",
      plannedMinutes: 25,
      actualMinutes: 10,
      completedSteps: 1,
      totalSteps: 4,
    };
    const signals = buildSessionDecisionSignals({
      plan,
      session: plan.sessions[0],
      answers,
      completions: [],
      interruptions: [interruption, { ...interruption, id: "00000000-0000-4000-8000-000000000006" }],
    });

    expect(signals.find((signal) => signal.kind === "evidence")?.title).toBe("No completed-session evidence yet");
  });

  it("does not present an app-problem interruption as a learner tendency", () => {
    const interruption: SessionInterruption = {
      id: "00000000-0000-4000-8000-000000000015",
      planId: plan.id,
      planSessionId: plan.sessions[0].id,
      startedAt: "2026-08-06T18:00:00.000Z",
      interruptedAt: "2026-08-06T18:10:00.000Z",
      plannedMinutes: 25,
      actualMinutes: 10,
      completedSteps: 1,
      totalSteps: 4,
    };
    const state = setPersonalizationEvidenceRefExcluded(
      defaultPersonalizationState(),
      interruption.id,
      true,
    );
    const signals = buildSessionDecisionSignals({
      plan,
      session: plan.sessions[0],
      answers: writePersonalizationStateToAnswers([], state),
      completions: [],
      interruptions: [
        interruption,
        { ...interruption, id: "00000000-0000-4000-8000-000000000016" },
      ],
    });

    expect(signals.find((signal) => signal.kind === "evidence")?.title)
      .toBe("No completed-session evidence yet");
  });

  it("uses the committed recipe reason instead of implying every profile signal changed the method", () => {
    const route = legacyPlanSessionToStudyRoute({
      plan,
      session: plan.sessions[0],
      adaptedAt: "2026-08-06T18:00:00.000Z",
    });
    if (!route) throw new Error("The decision fixture must produce a route.");
    const routed = StudyRouteSchema.parse({
      ...route,
      explanation: {
        ...route.explanation,
        shortReason: "You told YOVA that examples help you build a new procedure.",
        learnerDeclarations: [
          "You told YOVA that examples help you build a new procedure.",
        ],
      },
    });
    const routedSession = { ...plan.sessions[0], studyRoute: routed };

    const signals = buildSessionDecisionSignals({
      plan: { ...plan, sessions: [routedSession] },
      session: routedSession,
      answers: [],
      completions: [],
      interruptions: [],
    });

    expect(signals[0]).toMatchObject({
      kind: "task",
      title: routed.approach.visibleMethodName,
      detail: routed.explanation.taskRequirements[0],
    });
    expect(signals.find((signal) => signal.kind === "learner")).toMatchObject({
      title: routed.explanation.shortReason,
      detail: routed.explanation.learnerDeclarations[0],
    });
  });
});
