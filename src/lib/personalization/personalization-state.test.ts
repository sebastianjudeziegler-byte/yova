import { describe, expect, it } from "vitest";
import {
  PERSONALIZATION_STATE_ANSWER_INDEX,
  PERSONALIZATION_STATE_MAX_LENGTH,
  completedStudyProfileSnapshot,
  defaultPersonalizationState,
  effectivePersonalizationWorkspaceSettings,
  evaluateActivePersonalizationExperiment,
  finishPersonalizationExperiment,
  personalizationExperimentAcceptsCompletion,
  readPersonalizationStateFromAnswers,
  readPersonalizationStateValue,
  recordPersonalizationWeeklyReview,
  recordPersonalizationExperimentCompletion,
  setPersonalizationControl,
  setPersonalizationWorkspaceSetting,
  serializePersonalizationState,
  setPersonalizationEvidenceRefExcluded,
  startPersonalizationExperiment,
  stopPersonalizationExperiment,
  undoPersonalizationChange,
  withStudyProfileAnswer,
  writePersonalizationStateToAnswers,
} from "@/lib/personalization/personalization-state";
import {
  STUDY_PROFILE_QUESTION_IDS,
  type StudyProfileAnswerId,
} from "@/lib/study-profile/types";

describe("personalization state", () => {
  it("uses conservative controls and keeps personal tests off by default", () => {
    expect(defaultPersonalizationState()).toMatchObject({
      version: 1,
      controls: {
        selfReport: true,
        behavior: true,
        timing: true,
        experiments: false,
        optionalQuestions: true,
        receipts: true,
      },
      studyProfile: { answers: {}, completedAt: null },
      activeExperiment: null,
    });
  });

  it("round trips a partial profile at the reserved answer index without changing earlier answers", () => {
    const original = Array.from({ length: 16 }, (_, index) => `answer-${index}`);
    let state = withStudyProfileAnswer(defaultPersonalizationState(), "q1", "d");
    state = {
      ...state,
      pausedSignalIds: ["signal:starting_friction"],
      workspace: { ...state.workspace, layout: "one_step", motion: "reduced" },
      corrections: [{
        signalId: "signal:starting_friction",
        correctedValue: "Only hard tasks",
        note: "This changes by course.",
        doNotInfer: false,
        updatedAt: "2026-08-14T18:00:00.000Z",
      }],
    };

    const written = writePersonalizationStateToAnswers(original, state);

    expect(written.slice(0, 16)).toEqual(original);
    expect(written).toHaveLength(PERSONALIZATION_STATE_ANSWER_INDEX + 1);
    expect(written[PERSONALIZATION_STATE_ANSWER_INDEX]).not.toContain("\n");
    expect(readPersonalizationStateFromAnswers(written)).toMatchObject({
      studyProfile: { answers: { q1: "d" } },
      pausedSignalIds: ["signal:starting_friction"],
      workspace: { layout: "one_step", motion: "reduced" },
      corrections: [{ correctedValue: "Only hard tasks" }],
    });
  });

  it("falls back safely for malformed, oversized, and unknown-version values", () => {
    expect(readPersonalizationStateValue("not-json")).toEqual(defaultPersonalizationState());
    expect(readPersonalizationStateValue("x".repeat(24_001))).toEqual(defaultPersonalizationState());
    expect(readPersonalizationStateValue(JSON.stringify({ version: 2 }))).toEqual(
      defaultPersonalizationState(),
    );
  });

  it("compacts bounded long-lived state instead of failing a current preference save", () => {
    const defaults = defaultPersonalizationState();
    const crowded = {
      ...defaults,
      workspace: { ...defaults.workspace, layout: "one_step" as const },
      corrections: Array.from({ length: 50 }, (_, index) => ({
        signalId: `signal:${index}:${"s".repeat(100)}`,
        correctedValue: "v".repeat(200),
        note: "n".repeat(500),
        doNotInfer: false,
        updatedAt: "2026-08-14T18:00:00.000Z",
      })),
    };

    const serialized = serializePersonalizationState(crowded);
    const restored = readPersonalizationStateValue(serialized);

    expect(serialized.length).toBeLessThanOrEqual(PERSONALIZATION_STATE_MAX_LENGTH);
    expect(restored.workspace.layout).toBe("one_step");
    expect(restored.controls).toEqual(defaults.controls);
  });

  it("fails closed rather than losing many explicit do-not-infer protections", () => {
    const defaults = defaultPersonalizationState();
    const crowded = {
      ...defaults,
      pausedSignalIds: Array.from({ length: 50 }, (_, index) => (
        `signal:paused:${index}:${"p".repeat(90)}`
      )),
      corrections: Array.from({ length: 50 }, (_, index) => ({
        signalId: `signal:blocked:${index}:${"s".repeat(85)}`,
        correctedValue: null,
        note: "n".repeat(500),
        doNotInfer: true,
        updatedAt: "2026-08-14T18:00:00.000Z",
      })),
    };

    const restored = readPersonalizationStateValue(serializePersonalizationState(crowded));

    expect(restored.controls).toMatchObject({
      selfReport: false,
      behavior: false,
      timing: false,
      experiments: false,
    });
  });

  it("persists bounded evidence exclusions without duplicates", () => {
    let state = setPersonalizationEvidenceRefExcluded(
      defaultPersonalizationState(),
      " interruption-one ",
      true,
    );
    state = setPersonalizationEvidenceRefExcluded(state, "interruption-one", true);
    expect(state.excludedEvidenceRefs).toEqual(["interruption-one"]);

    state = setPersonalizationEvidenceRefExcluded(state, "interruption-one", false);
    expect(state.excludedEvidenceRefs).toEqual([]);
  });

  it("does not expose a scored Study Profile until all optional answers exist", () => {
    let state = withStudyProfileAnswer(defaultPersonalizationState(), "q1", "d");
    expect(completedStudyProfileSnapshot(state)).toBeNull();

    for (const questionId of STUDY_PROFILE_QUESTION_IDS) {
      state = withStudyProfileAnswer(state, questionId, answerFor(questionId));
    }

    expect(completedStudyProfileSnapshot(state)).toMatchObject({
      modelVersion: "profile_model_v1",
      classifications: { starting_friction: "high" },
    });
  });

  it("requires permission, permits one personal test, and alternates its next option", () => {
    const disabled = defaultPersonalizationState();
    const request = {
      id: "test-presentation",
      variable: "presentation" as const,
      variantA: "example_first",
      variantB: "overview_first",
      startedAt: "2026-08-14T18:00:00.000Z",
      taskType: "conceptual_learning",
      knowledgeStage: "novice",
    };
    expect(startPersonalizationExperiment(disabled, request)).toBe(disabled);

    const enabled = {
      ...disabled,
      controls: { ...disabled.controls, experiments: true },
    };
    const started = startPersonalizationExperiment(enabled, request);
    expect(started.activeExperiment).toMatchObject({
      nextVariant: "a",
      minimumSessionsPerVariant: 2,
      observations: [],
    });
    expect(startPersonalizationExperiment(started, { ...request, id: "second" })).toBe(started);

    expect(personalizationExperimentAcceptsCompletion(started.activeExperiment, {
      taskType: "conceptual_learning",
      knowledgeStage: "novice",
    })).toBe(true);
    expect(personalizationExperimentAcceptsCompletion(started.activeExperiment, {
      taskType: "problem_solving",
      knowledgeStage: "novice",
    })).toBe(false);

    const afterA = recordPersonalizationExperimentCompletion(started, observation("one", 2, 2));
    const afterB = recordPersonalizationExperimentCompletion(afterA, observation("two", 1, 2));
    expect(afterA.activeExperiment?.observations[0].variant).toBe("a");
    expect(afterA.activeExperiment?.nextVariant).toBe("b");
    expect(afterB.activeExperiment?.observations[1].variant).toBe("b");
    expect(afterB.activeExperiment?.nextVariant).toBe("a");
    expect(recordPersonalizationExperimentCompletion(afterB, observation("two", 0, 2))).toBe(afterB);
  });

  it("waits for two sessions per option and eight checked answers before a cautious result", () => {
    let state = defaultPersonalizationState();
    state = { ...state, controls: { ...state.controls, experiments: true } };
    state = startPersonalizationExperiment(state, {
      id: "test-support",
      variable: "support",
      variantA: "hint_first",
      variantB: "direct_correction",
      startedAt: "2026-08-14T18:00:00.000Z",
      taskType: "problem_solving",
      knowledgeStage: "developing",
    });
    state = recordPersonalizationExperimentCompletion(state, observation("one", 2, 2));
    state = recordPersonalizationExperimentCompletion(state, observation("two", 1, 2));
    state = recordPersonalizationExperimentCompletion(state, observation("three", 2, 2));
    expect(evaluateActivePersonalizationExperiment(state.activeExperiment).ready).toBe(false);
    expect(finishPersonalizationExperiment(state, "2026-08-14T20:00:00.000Z")).toBe(state);

    state = recordPersonalizationExperimentCompletion(state, observation("four", 1, 2));
    expect(evaluateActivePersonalizationExperiment(state.activeExperiment)).toMatchObject({
      ready: true,
      sessionsA: 2,
      sessionsB: 2,
      checkedAnswers: 8,
      accuracyA: 100,
      accuracyB: 50,
      result: "promising_a",
    });

    const finished = finishPersonalizationExperiment(state, "2026-08-14T20:00:00.000Z");
    expect(finished.activeExperiment).toBeNull();
    expect(finished.experimentHistory.at(-1)).toMatchObject({
      id: "test-support",
      result: "promising_a",
      sessionsA: 2,
      sessionsB: 2,
      checkedAnswers: 8,
    });
    expect(finished.experimentHistory.at(-1)?.summary).toContain("changeable result");
  });

  it("lets a learner stop a personal test without creating a winner", () => {
    const defaults = defaultPersonalizationState();
    const enabled = { ...defaults, controls: { ...defaults.controls, experiments: true } };
    const started = startPersonalizationExperiment(enabled, {
      id: "test-workspace",
      variable: "workspace",
      variantA: "one_step",
      variantB: "full_path",
      startedAt: "2026-08-14T18:00:00.000Z",
      taskType: "conceptual_learning",
      knowledgeStage: "novice",
    });

    const stopped = stopPersonalizationExperiment(started, "2026-08-14T19:00:00.000Z");
    expect(stopped.activeExperiment).toBeNull();
    expect(stopped.experimentHistory.at(-1)).toMatchObject({ result: "stopped" });
    expect(serializePersonalizationState(stopped)).toContain('"result":"stopped"');
  });

  it("records direct settings and lets the learner undo the latest change", () => {
    let state = setPersonalizationWorkspaceSetting(
      defaultPersonalizationState(),
      "layout",
      "one_step",
      "2026-08-14T18:00:00.000Z",
    );
    state = setPersonalizationControl(
      state,
      "behavior",
      false,
      "2026-08-14T18:01:00.000Z",
    );

    expect(state.workspace.layout).toBe("one_step");
    expect(state.controls.behavior).toBe(false);
    expect(state.changeHistory).toHaveLength(2);

    const undone = undoPersonalizationChange(
      state,
      state.changeHistory[0].id,
      "2026-08-14T18:02:00.000Z",
    );
    expect(undone.workspace.layout).toBe("automatic");
    expect(undone.controls.behavior).toBe(false);
    expect(undone.changeHistory[0].undoneAt).toBe("2026-08-14T18:02:00.000Z");
  });

  it("replays same-setting history so undoing an older change cannot clobber a newer choice", () => {
    let state = setPersonalizationWorkspaceSetting(
      defaultPersonalizationState(),
      "layout",
      "one_step",
      "2026-08-14T18:00:00.000Z",
    );
    state = setPersonalizationWorkspaceSetting(
      state,
      "layout",
      "full_path",
      "2026-08-14T18:01:00.000Z",
    );

    state = undoPersonalizationChange(
      state,
      state.changeHistory[0].id,
      "2026-08-14T18:02:00.000Z",
    );
    expect(state.workspace.layout).toBe("full_path");

    state = undoPersonalizationChange(
      state,
      state.changeHistory[1].id,
      "2026-08-14T18:03:00.000Z",
    );
    expect(state.workspace.layout).toBe("automatic");
  });

  it("remembers which fixed weekly review the learner already saw", () => {
    const state = recordPersonalizationWeeklyReview(
      defaultPersonalizationState(),
      "week:2026-08-03",
      "2026-08-10T12:00:00.000Z",
    );
    const restored = readPersonalizationStateValue(serializePersonalizationState(state));
    expect(restored.weeklyReviewHistory).toEqual([{
      key: "week:2026-08-03",
      reviewedAt: "2026-08-10T12:00:00.000Z",
    }]);
  });

  it("uses a promising workspace winner only while layout remains automatic", () => {
    const defaults = defaultPersonalizationState();
    let state = startPersonalizationExperiment(
      { ...defaults, controls: { ...defaults.controls, experiments: true } },
      {
        id: "workspace-result",
        variable: "workspace",
        variantA: "one_step",
        variantB: "full_path",
        startedAt: "2026-08-14T18:00:00.000Z",
        taskType: "conceptual_learning",
        knowledgeStage: "novice",
      },
    );
    state = recordPersonalizationExperimentCompletion(state, observation("a-one", 2, 2));
    state = recordPersonalizationExperimentCompletion(state, observation("b-one", 0, 2));
    state = recordPersonalizationExperimentCompletion(state, observation("a-two", 2, 2));
    state = recordPersonalizationExperimentCompletion(state, observation("b-two", 1, 2));
    state = finishPersonalizationExperiment(state, "2026-08-14T20:00:00.000Z");

    const matching = { taskType: "conceptual_learning", knowledgeStage: "novice" };
    expect(effectivePersonalizationWorkspaceSettings(state).layout).toBe("automatic");
    expect(effectivePersonalizationWorkspaceSettings(state, matching).layout).toBe("one_step");
    expect(effectivePersonalizationWorkspaceSettings(state, {
      taskType: "problem_solving",
      knowledgeStage: "novice",
    }).layout).toBe("automatic");
    const explicit = { ...state, workspace: { ...state.workspace, layout: "full_path" as const } };
    expect(effectivePersonalizationWorkspaceSettings(explicit, matching).layout).toBe("full_path");

    const paused = { ...state, pausedSignalIds: ["experiment:workspace-result"] };
    expect(effectivePersonalizationWorkspaceSettings(paused, matching).layout).toBe("automatic");
    const disabled = {
      ...state,
      controls: { ...state.controls, experiments: false },
    };
    expect(effectivePersonalizationWorkspaceSettings(disabled, matching).layout).toBe("automatic");

    const mixedRetest = {
      ...state,
      experimentHistory: [
        ...state.experimentHistory,
        {
          ...state.experimentHistory.at(-1)!,
          id: "workspace-retest",
          result: "mixed" as const,
          summary: "The retest was mixed.",
          completedAt: "2026-08-14T21:00:00.000Z",
        },
      ],
    };
    expect(effectivePersonalizationWorkspaceSettings(mixedRetest, matching).layout).toBe("automatic");
  });

  it("rejects malformed promising history that has no comparable evidence", () => {
    const defaults = defaultPersonalizationState();
    const restored = readPersonalizationStateValue(JSON.stringify({
      ...defaults,
      experimentHistory: [{
        id: "forged-result",
        variable: "workspace",
        variantA: "one_step",
        variantB: "full_path",
        taskType: "conceptual_learning",
        knowledgeStage: "novice",
        result: "promising_a",
        summary: "A result with no evidence.",
        sessionsA: 0,
        sessionsB: 0,
        checkedAnswers: 0,
        accuracyA: null,
        accuracyB: null,
        completedAt: "2026-08-14T20:00:00.000Z",
      }],
    }));

    expect(restored.experimentHistory).toEqual([]);
  });
});

function answerFor(questionId: (typeof STUDY_PROFILE_QUESTION_IDS)[number]): StudyProfileAnswerId {
  return questionId === "q1" || questionId === "q2" ? "d" : "a";
}

function observation(completionId: string, correctAnswers: number, totalAnswers: number) {
  return {
    completionId,
    correctAnswers,
    totalAnswers,
    feedback: "about_right" as const,
    recordedAt: "2026-08-14T18:30:00.000Z",
  };
}
