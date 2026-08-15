import { describe, expect, it } from "vitest";
import type {
  LearningPlan,
  SessionCompletion,
  SessionInterruption,
} from "@/lib/domain";
import {
  buildPersonalizationWeeklyReview,
  recordPersonalizationReceipt,
  resolveLearnerPersonalization,
  selectNextOptionalPersonalizationQuestion,
  selectPersonalizationReceipt,
  selectPersonalizedMethodTie,
  validMethodIdsFromPlan,
} from "@/lib/personalization/personalization-evidence";
import {
  defaultPersonalizationState,
  finishPersonalizationExperiment,
  recordPersonalizationExperimentCompletion,
  recordPersonalizationWeeklyReview,
  setPersonalizationEvidenceRefExcluded,
  startPersonalizationExperiment,
  withStudyProfileAnswer,
  writePersonalizationStateToAnswers,
} from "@/lib/personalization/personalization-state";

describe("personalization evidence", () => {
  it("turns two optional answers into a visible self-report signal and a concrete opening", () => {
    const answers = answersWithState(highStartingFrictionState());
    const result = resolve(answers);

    expect(signal(result, "starting_friction")).toMatchObject({
      value: "High",
      evidenceLabel: "You told YOVA",
      source: "self_report",
    });
    expect(result.decisions).toContainEqual(expect.objectContaining({
      artifact: "session_opening",
      setting: "first_action",
      value: "small_active_start",
    }));
  });

  it("labels one observation cautiously and repeated matching observations more strongly", () => {
    const once = resolve([], [], [interruption("exit-one")]);
    expect(signal(once, "starting_friction")?.evidenceLabel).toBe("Seen once");
    expect(once.decisions.some((decision) => decision.setting === "first_action")).toBe(false);

    const repeated = resolve([], [], [interruption("exit-one"), interruption("exit-two")]);
    expect(signal(repeated, "starting_friction")?.evidenceLabel).toBe("Repeated pattern");

    const agreeing = resolve(
      answersWithState(highStartingFrictionState()),
      [],
      [interruption("exit-one"), interruption("exit-two")],
    );
    expect(signal(agreeing, "starting_friction")?.evidenceLabel).toBe(
      "Self-report and behavior agree",
    );
  });

  it("does not treat a learner-classified app problem as starting-friction evidence", () => {
    const state = setPersonalizationEvidenceRefExcluded(
      defaultPersonalizationState(),
      "app-problem-exit",
      true,
    );
    const result = resolve(
      answersWithState(state),
      [],
      [interruption("app-problem-exit"), interruption("learner-exit")],
    );

    expect(signal(result, "starting_friction")).toMatchObject({
      evidenceCount: 1,
      evidenceLabel: "Seen once",
      evidenceRefs: ["learner-exit"],
    });
  });

  it("keeps conflicting self-report and behavior mixed instead of silently adapting", () => {
    let state = defaultPersonalizationState();
    state = withStudyProfileAnswer(state, "q1", "a");
    state = withStudyProfileAnswer(state, "q2", "a");
    const result = resolve(
      answersWithState(state),
      [],
      [interruption("exit-one"), interruption("exit-two")],
    );

    expect(signal(result, "starting_friction")?.evidenceLabel).toBe("Mixed evidence");
    expect(result.decisions.some((decision) => decision.setting === "first_action")).toBe(false);
  });

  it("honors a learner pause and correction before it creates artifacts", () => {
    const base = highStartingFrictionState();
    const paused = {
      ...base,
      pausedSignalIds: ["signal:starting_friction"],
    };
    const pausedResult = resolve(answersWithState(paused));
    expect(signal(pausedResult, "starting_friction")?.evidenceLabel).toBe("Paused by you");
    expect(pausedResult.decisions.some((decision) => decision.setting === "first_action")).toBe(false);

    const corrected = {
      ...base,
      corrections: [{
        signalId: "signal:starting_friction",
        correctedValue: "Only difficult writing tasks",
        note: "Easy tasks are different.",
        doNotInfer: false,
        updatedAt: "2026-08-14T18:00:00.000Z",
      }],
    };
    const correctedResult = resolve(answersWithState(corrected));
    expect(signal(correctedResult, "starting_friction")).toMatchObject({
      value: "High",
      evidenceLabel: "Mixed evidence",
      source: "correction",
    });
    expect(correctedResult.decisions.some((decision) => decision.setting === "first_action"))
      .toBe(false);
  });

  it("applies a supported concrete correction but not a note by itself", () => {
    const base = highStartingFrictionState();
    const noteOnly = resolve(answersWithState({
      ...base,
      corrections: [{
        signalId: "signal:starting_friction",
        correctedValue: null,
        note: "That interruption was caused by class ending.",
        doNotInfer: false,
        updatedAt: "2026-08-14T18:00:00.000Z",
      }],
    }));
    expect(signal(noteOnly, "starting_friction")).toMatchObject({
      evidenceLabel: "Mixed evidence",
      source: "correction",
    });
    expect(noteOnly.decisions.some((decision) => decision.setting === "first_action"))
      .toBe(false);

    const corrected = {
      ...base,
      corrections: [{
        signalId: "signal:starting_friction",
        correctedValue: "Moderate",
        note: "Starting is manageable when the first action is clear.",
        doNotInfer: false,
        updatedAt: "2026-08-14T18:00:00.000Z",
      }],
    };
    const result = resolve(answersWithState(corrected));

    expect(signal(result, "starting_friction")).toMatchObject({
      value: "Moderate",
      evidenceLabel: "You told YOVA",
      source: "correction",
    });
    expect(result.decisions.some((decision) => decision.setting === "first_action"))
      .toBe(false);
  });

  it("maps direct preferences to delivery while allowing only task-valid method ties", () => {
    const answers: string[] = [];
    answers[10] = "Start with a concrete example.";
    answers[11] = "I understand it now but forget it after a few days.";
    const result = resolve(answers);

    expect(result.decisions).toEqual(expect.arrayContaining([
      expect.objectContaining({ setting: "presentation", value: "example_first" }),
      expect.objectContaining({ setting: "retention", value: "delayed_retrieval" }),
    ]));
    expect(selectPersonalizedMethodTie(
      ["spaced_retrieval", "self_explanation"],
      result,
    )).toMatchObject({ value: "spaced_retrieval", artifact: "method_tie" });
    expect(selectPersonalizedMethodTie(
      ["self_explanation", "worked_example_fading"],
      result,
    )).toBeNull();
  });

  it("requires two comparable sessions in each of two windows before suggesting timing", () => {
    const tooEarly = resolve([], [
      completion("morning-one", "2026-08-10T08:00:00.000Z", 5, 5),
      completion("evening-one", "2026-08-10T18:00:00.000Z", 2, 5),
    ]);
    expect(signal(tooEarly, "energy_window")).toBeUndefined();

    const compared = resolve([], [
      completion("morning-one", "2026-08-10T08:00:00.000Z", 5, 5),
      completion("morning-two", "2026-08-11T08:00:00.000Z", 4, 5),
      completion("evening-one", "2026-08-10T18:00:00.000Z", 2, 5),
      completion("evening-two", "2026-08-11T18:00:00.000Z", 3, 5),
    ]);
    expect(signal(compared, "energy_window")).toMatchObject({
      value: "Morning is currently stronger",
      evidenceLabel: "Repeated pattern",
      evidenceCount: 4,
    });
    expect(compared.decisions).toContainEqual(expect.objectContaining({
      artifact: "schedule",
      setting: "recommended_window",
      value: "morning",
    }));
  });

  it("offers one optional question at a time and respects the control", () => {
    const partial = withStudyProfileAnswer(defaultPersonalizationState(), "q1", "d");
    expect(selectNextOptionalPersonalizationQuestion(partial, [])).toMatchObject({
      question: { id: "q2" },
      changes: expect.stringContaining("opening"),
    });

    const disabled = {
      ...partial,
      controls: { ...partial.controls, optionalQuestions: false },
    };
    expect(selectNextOptionalPersonalizationQuestion(disabled, [])).toBeNull();
  });

  it("exposes the current approved experiment option as an active artifact", () => {
    const defaults = defaultPersonalizationState();
    const enabled = { ...defaults, controls: { ...defaults.controls, experiments: true } };
    const started = startPersonalizationExperiment(enabled, {
      id: "presentation-test",
      variable: "presentation",
      variantA: "example_first",
      variantB: "overview_first",
      startedAt: "2026-08-14T18:00:00.000Z",
      taskType: "conceptual_learning",
      knowledgeStage: "novice",
    });
    const result = resolve(answersWithState(started));

    expect(result.decisions).toContainEqual(expect.objectContaining({
      artifact: "method_delivery",
      setting: "presentation",
      value: "example_first",
      experimental: true,
    }));
  });

  it("surfaces completed personal tests with the exact cautious evidence labels", () => {
    let state = defaultPersonalizationState();
    state = { ...state, controls: { ...state.controls, experiments: true } };
    state = startPersonalizationExperiment(state, {
      id: "support-test",
      variable: "support",
      variantA: "hint_first",
      variantB: "direct_correction",
      startedAt: "2026-08-13T18:00:00.000Z",
      taskType: "problem_solving",
      knowledgeStage: "developing",
    });
    state = addExperimentResult(state, "one", 2, 2);
    state = addExperimentResult(state, "two", 0, 2);
    state = addExperimentResult(state, "three", 2, 2);
    state = addExperimentResult(state, "four", 1, 2);
    state = finishPersonalizationExperiment(state, "2026-08-14T18:00:00.000Z");

    const result = resolve(answersWithState(state));
    expect(result.signals).toContainEqual(expect.objectContaining({
      id: "experiment:support-test",
      evidenceLabel: "Tested and promising",
      value: "hint_first is promising",
    }));
  });

  it("shows a completed workspace winner as a scoped, reversible applied rule", () => {
    let state = defaultPersonalizationState();
    state = { ...state, controls: { ...state.controls, experiments: true } };
    state = startPersonalizationExperiment(state, {
      id: "workspace-test",
      variable: "workspace",
      variantA: "one_step",
      variantB: "full_path",
      startedAt: "2026-08-13T18:00:00.000Z",
      taskType: "conceptual_learning",
      knowledgeStage: "novice",
    });
    state = addExperimentResult(state, "one", 2, 2);
    state = addExperimentResult(state, "two", 0, 2);
    state = addExperimentResult(state, "three", 2, 2);
    state = addExperimentResult(state, "four", 1, 2);
    state = finishPersonalizationExperiment(state, "2026-08-14T18:00:00.000Z");

    const result = resolve(answersWithState(state));
    expect(result.decisions).toContainEqual(expect.objectContaining({
      id: "decision:experiment-result:workspace-test",
      artifact: "workspace",
      setting: "layout",
      value: "one_step",
      evidenceLabel: "Tested and promising",
      experimental: false,
    }));
    expect(result.decisions.find((item) => item.id === "decision:experiment-result:workspace-test")
      ?.explanation).toContain("conceptual learning work at the novice stage");
  });

  it("selects receipts sparingly and produces a weekly review from recent evidence", () => {
    const now = new Date("2026-08-17T20:00:00.000Z");
    const completions = [
      completion("recent-one", "2026-08-13T08:00:00.000Z", 4, 5),
      completion("recent-two", "2026-08-14T08:00:00.000Z", 5, 5),
    ];
    const result = resolve(
      [],
      completions,
      [interruption("exit-one"), interruption("exit-two")],
      now,
    );
    const receipt = selectPersonalizationReceipt({
      state: result.state,
      decisions: result.decisions,
      now,
    });
    expect(receipt).toMatchObject({ evidenceLabel: "Repeated pattern" });

    const shown = recordPersonalizationReceipt(
      result.state,
      receipt!,
      "2026-08-17T20:00:00.000Z",
    );
    expect(selectPersonalizationReceipt({
      state: shown,
      decisions: result.decisions,
      now: new Date("2026-08-18T20:00:00.000Z"),
    })).toBeNull();

    const weekly = buildPersonalizationWeeklyReview({
      state: result.state,
      signals: result.signals,
      decisions: result.decisions,
      completions,
      interruptions: [interruption("exit-one"), interruption("exit-two")],
      now,
    });
    expect(weekly).toMatchObject({
      key: "week:2026-08-10",
      ready: true,
      completedSessions: 2,
      interruptedSessions: 2,
      studiedMinutes: 44,
      accuracyPercent: 90,
    });

    const reviewed = recordPersonalizationWeeklyReview(
      result.state,
      weekly.key,
      "2026-08-17T20:00:00.000Z",
    );
    expect(buildPersonalizationWeeklyReview({
      state: reviewed,
      signals: result.signals,
      decisions: result.decisions,
      completions,
      interruptions: [interruption("exit-one"), interruption("exit-two")],
      now,
    }).ready).toBe(false);
  });

  it("extracts plan methods only as task-valid candidates", () => {
    const plan = makePlan();
    expect(validMethodIdsFromPlan(plan)).toEqual([
      "retrieval_practice",
      "worked_example_fading",
    ]);
  });
});

function resolve(
  answers: readonly string[],
  completions: readonly SessionCompletion[] = [],
  interruptions: readonly SessionInterruption[] = [],
  now = new Date("2026-08-14T20:00:00.000Z"),
) {
  return resolveLearnerPersonalization({
    answers,
    completions,
    interruptions,
    plans: [],
    now,
    timeZone: "UTC",
  });
}

function signal(
  result: ReturnType<typeof resolveLearnerPersonalization>,
  key: string,
) {
  return result.signals.find((item) => item.key === key);
}

function highStartingFrictionState() {
  let state = withStudyProfileAnswer(defaultPersonalizationState(), "q1", "d");
  state = withStudyProfileAnswer(state, "q2", "d");
  return state;
}

function answersWithState(state: ReturnType<typeof defaultPersonalizationState>) {
  return writePersonalizationStateToAnswers([], state);
}

function completion(
  id: string,
  startedAt: string,
  correctAnswers: number,
  totalAnswers: number,
): SessionCompletion {
  return {
    id,
    planId: "plan-one",
    planSessionId: `session-${id}`,
    startedAt,
    completedAt: new Date(Date.parse(startedAt) + 22 * 60 * 1_000).toISOString(),
    plannedMinutes: 25,
    actualMinutes: 22,
    correctAnswers,
    totalAnswers,
    feedback: "about_right",
    observedGap: "",
    conceptEvidence: [],
    confidenceEvidence: [],
  };
}

function interruption(id: string): SessionInterruption {
  return {
    id,
    planId: "plan-one",
    planSessionId: `session-${id}`,
    startedAt: "2026-08-14T18:00:00.000Z",
    interruptedAt: "2026-08-14T18:06:00.000Z",
    plannedMinutes: 25,
    actualMinutes: 6,
    completedSteps: 1,
    totalSteps: 5,
  };
}

function addExperimentResult(
  state: ReturnType<typeof defaultPersonalizationState>,
  id: string,
  correctAnswers: number,
  totalAnswers: number,
) {
  return recordPersonalizationExperimentCompletion(state, {
    completionId: id,
    correctAnswers,
    totalAnswers,
    feedback: "about_right",
    recordedAt: "2026-08-14T18:00:00.000Z",
  });
}

function makePlan(): LearningPlan {
  return {
    id: "plan-one",
    learningItemId: "item-one",
    title: "Biology",
    topic: "Cell division",
    kind: "test",
    deadline: null,
    status: "active",
    sourceMode: "yova_generated",
    studyMode: "inside_yova",
    learningIntent: "study",
    rationale: "Prepare for a test.",
    createdAt: "2026-08-14T18:00:00.000Z",
    sessions: [
      {
        id: "session-one",
        sequence: 1,
        title: "Recall the stages",
        objective: "Recall each stage without notes.",
        method: "Retrieval practice",
        methodReason: "The task requires recall.",
        scheduledFor: "2026-08-15",
        estimatedMinutes: 25,
        amountLabel: "25 minutes",
        learningMode: "study",
        status: "ready",
      },
      {
        id: "session-two",
        sequence: 2,
        title: "Work through mitosis",
        objective: "Apply the stage model.",
        method: "Worked example fading",
        methodReason: "The task requires application.",
        scheduledFor: "2026-08-16",
        estimatedMinutes: 25,
        amountLabel: "25 minutes",
        learningMode: "study",
        status: "upcoming",
      },
    ],
  };
}
