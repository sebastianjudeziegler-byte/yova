import { describe, expect, it } from "vitest";
import {
  DEEP_PROFILE_QUESTIONS,
  deepProfileAnswerId,
  deepProfileAnswerCount,
  encodeAdditionalLearnerContext,
  expandedLearnerContextFromAnswers,
  expandedLearnerContextFromStored,
  LEARNER_ANSWER_COUNT,
  mergeStoredAdditionalContext,
  personalizationGenerationContext,
  statedOnboardingAnswerForRuntime,
} from "@/lib/personalization/learner-profile";
import { buildPlanProfileSummary } from "@/lib/personalization/profile-summary";
import {
  defaultPersonalizationState,
  PERSONALIZATION_STATE_ANSWER_INDEX,
  readPersonalizationStateFromAnswers,
  serializePersonalizationState,
  writePersonalizationStateToAnswers,
} from "@/lib/personalization/personalization-state";
import {
  STUDY_PROFILE_QUESTION_IDS,
  type StudyProfileAnswers,
} from "@/lib/study-profile/types";
import {
  onboardingAnswerId,
  onboardingAnswerLabel,
  onboardingQuestions,
} from "@/lib/sample-data";

describe("expanded learner profile", () => {
  it("uses stable onboarding option IDs as the source of truth", () => {
    onboardingQuestions.forEach((question, questionIndex) => {
      expect(new Set(question.options.map((option) => option.id)).size)
        .toBe(question.options.length);
      question.options.forEach((option) => {
        expect(onboardingAnswerId(questionIndex, option.id)).toBe(option.id);
        expect(onboardingAnswerLabel(questionIndex, option.id)).toBe(option.label);
        expect(onboardingAnswerId(questionIndex, option.label)).toBe(option.id);
      });
    });

    expect(onboardingAnswerId(3, "I feel confident with one concrete example first"))
      .toBeNull();
  });

  it("keeps legacy labels at storage boundaries while exposing stable option IDs", () => {
    expect(DEEP_PROFILE_QUESTIONS.map((question) => (
      question.options.map((option) => option.label)
    ))).toEqual([
      [
        "A concrete example before the rule",
        "The big picture before the details",
        "A clear sequence of small steps",
        "Trying it before seeing an explanation",
        "Comparing similar ideas side by side",
        "It depends on the task",
      ],
      [
        "I recognize it but cannot recall it",
        "I forget it after a few days",
        "I confuse similar ideas",
        "I understand it but cannot apply it",
        "I can do it with help but not independently",
        "It depends on the topic",
      ],
      [
        "Give me a small hint first",
        "Show me a different example",
        "Explain the mistake directly",
        "Break it into smaller steps",
        "Let me try again without help",
        "It depends on the task",
      ],
      [
        "Show one step at a time",
        "Keep the full path visible",
        "Give me choices and let me decide",
        "Use the least guidance that works",
        "It depends on the session",
      ],
    ]);
    expect(deepProfileAnswerId(10, "A concrete example before the rule"))
      .toBe("concrete_example");
    expect(deepProfileAnswerId(11, "I recognize it but cannot recall it"))
      .toBe("recognition_without_recall");
    expect(deepProfileAnswerId(11, "I confidently cannot recall it"))
      .toBeNull();
  });

  it("migrates legacy deeper-answer labels to stable IDs in additional context", () => {
    const answers = Array.from({ length: LEARNER_ANSWER_COUNT }, () => "");
    answers[8] = "Less text and more visual structure";
    answers[9] = "I need to understand why a formula works.";
    answers[10] = "A concrete example before the rule";
    answers[11] = "I understand it but cannot apply it";
    answers[12] = "Give me a small hint first";
    answers[13] = "Show one step at a time";
    answers[14] = "I copy algebra steps unless I explain the reason for each one.";
    answers[15] = "My recent interruption was caused by practice ending, not the session length.";

    const stored = encodeAdditionalLearnerContext(answers);
    const restored = mergeStoredAdditionalContext([], stored);

    expect(restored[9]).toBe(answers[9]);
    expect(restored[8]).toBe("reduced_text_visual_structure");
    expect(restored.slice(10, 14)).toEqual([
      "concrete_example",
      "application_gap",
      "hint_first",
      "one_step",
    ]);
    expect(restored.slice(14, 16)).toEqual(answers.slice(14, 16));
    expect(deepProfileAnswerCount(restored)).toBe(5);
  });

  it("drops legacy diagnosis labels instead of turning them into model context", () => {
    const answers = Array.from({ length: LEARNER_ANSWER_COUNT }, () => "");
    answers[8] = "ADHD";

    const restored = mergeStoredAdditionalContext([], encodeAdditionalLearnerContext(answers));

    expect(restored[8]).toBe("");
    expect(expandedLearnerContextFromStored(encodeAdditionalLearnerContext(answers)).functionalSupportNeed).toBeNull();
  });

  it("keeps older plain-text profile context backward compatible", () => {
    const restored = mergeStoredAdditionalContext([], "Examples make difficult ideas less abstract.");

    expect(restored[9]).toBe("Examples make difficult ideas less abstract.");
    expect(expandedLearnerContextFromStored("Examples make difficult ideas less abstract.").freeformContext).toBeNull();
  });

  it("reads schema-v2 additional context and leaves the new state slot empty", () => {
    const stored = JSON.stringify({
      schemaVersion: 2,
      functionalSupportNeed: "Less text and more visual structure",
      initialContext: "Examples help me start.",
      processingPreference: "The big picture before the details",
      memoryChallenge: "I forget it after a few days",
      supportPreference: "Give me a small hint first",
      workspacePreference: "Show one step at a time",
      freeformContext: "Connect formulas to the underlying idea.",
      observationCorrection: "A class ending caused the interruption.",
    });

    const restored = mergeStoredAdditionalContext([], stored);

    expect(restored).toHaveLength(LEARNER_ANSWER_COUNT);
    expect(restored[10]).toBe("big_picture");
    expect(restored[PERSONALIZATION_STATE_ANSWER_INDEX]).toBe("");
  });

  it("round-trips the serialized personalization state in schema v3", () => {
    const answers = completedStudyProfileAnswers();
    const serialized = answers[PERSONALIZATION_STATE_ANSWER_INDEX];

    const stored = encodeAdditionalLearnerContext(answers);
    const decoded = JSON.parse(stored) as Record<string, unknown>;
    const restored = mergeStoredAdditionalContext([], stored);

    expect(decoded.schemaVersion).toBe(3);
    expect(decoded.personalizationState).toBe(serialized);
    expect(decoded.generationContext).toEqual(personalizationGenerationContext(
      readPersonalizationStateFromAnswers(answers),
    ));
    expect(restored[PERSONALIZATION_STATE_ANSWER_INDEX]).toBe(serialized);
    expect(readPersonalizationStateFromAnswers(restored)).toEqual(
      readPersonalizationStateFromAnswers(answers),
    );
    expect(expandedLearnerContextFromStored(stored).workspacePreference)
      .toBe("Show one step at a time");
  });

  it("keeps cache-relevant context stable when only display history changes", () => {
    const state = defaultPersonalizationState();
    const baselineAnswers = writePersonalizationStateToAnswers([], state);
    const displayHistoryAnswers = writePersonalizationStateToAnswers([], {
      ...state,
      receiptHistory: [{
        key: "receipt:opening",
        shownAt: "2026-08-14T20:00:00.000Z",
      }],
      changeHistory: [{
        id: "control:receipts:2026-08-14T20:00:00.000Z",
        area: "control",
        setting: "receipts",
        previousValue: "true",
        nextValue: "false",
        title: "Receipts turned off",
        reason: "You changed this personalization control directly.",
        occurredAt: "2026-08-14T20:00:00.000Z",
        undoneAt: null,
      }],
      weeklyReviewHistory: [{
        key: "week:2026-08-10",
        reviewedAt: "2026-08-14T20:00:00.000Z",
      }],
    });
    const baseline = JSON.parse(encodeAdditionalLearnerContext(baselineAnswers)) as Record<string, unknown>;
    const withHistory = JSON.parse(encodeAdditionalLearnerContext(displayHistoryAnswers)) as Record<string, unknown>;

    expect(withHistory.personalizationState).not.toBe(baseline.personalizationState);
    expect(withHistory.generationContext).toEqual(baseline.generationContext);
  });

  it("changes cache-relevant context when an instructional control changes", () => {
    const state = defaultPersonalizationState();
    const enabled = JSON.parse(encodeAdditionalLearnerContext(
      writePersonalizationStateToAnswers([], state),
    )) as Record<string, unknown>;
    const disabled = JSON.parse(encodeAdditionalLearnerContext(
      writePersonalizationStateToAnswers([], {
        ...state,
        controls: { ...state.controls, behavior: false },
      }),
    )) as Record<string, unknown>;

    expect(disabled.generationContext).not.toEqual(enabled.generationContext);
  });

  it("replaces malformed stored state with safe defaults", () => {
    const stored = JSON.stringify({
      schemaVersion: 3,
      personalizationState: "not valid personalization JSON",
    });

    const restored = mergeStoredAdditionalContext([], stored);

    expect(restored[PERSONALIZATION_STATE_ANSWER_INDEX]).toBe(
      serializePersonalizationState(defaultPersonalizationState()),
    );
    expect(readPersonalizationStateFromAnswers(restored)).toEqual(defaultPersonalizationState());
  });

  it("derives safe unset preferences from a completed Study Profile", () => {
    const answers = completedStudyProfileAnswers();

    expect(expandedLearnerContextFromAnswers(answers)).toMatchObject({
      functionalSupportNeed: "Shorter sections with fewer steps at once",
      memoryChallenge: "I recognize it but cannot recall it",
      supportPreference: "Give me a small hint first",
      workspacePreference: "Show one step at a time",
    });
  });

  it("uses a completed dimension pair but not a single Study Profile answer", () => {
    const oneStructureAnswer = studyProfileStateAnswers({ q3: "d" });
    const completeStructurePair = studyProfileStateAnswers({ q3: "d", q4: "d" });

    expect(expandedLearnerContextFromAnswers(oneStructureAnswer).workspacePreference).toBeNull();
    expect(expandedLearnerContextFromAnswers(completeStructurePair).workspacePreference)
      .toBe("Show one step at a time");
  });

  it("keeps explicit deep answers ahead of Study Profile defaults", () => {
    const answers = completedStudyProfileAnswers();
    answers[11] = "I understand it but cannot apply it";
    answers[12] = "Explain the mistake directly";
    answers[13] = "Keep the full path visible";

    expect(expandedLearnerContextFromAnswers(answers)).toMatchObject({
      memoryChallenge: "I understand it but cannot apply it",
      supportPreference: "Explain the mistake directly",
      workspacePreference: "Keep the full path visible",
    });
  });

  it("does not derive Study Profile preferences when self-report is disabled", () => {
    const answers = completedStudyProfileAnswers(false);
    answers[0] = "I struggle to start";
    answers[8] = "Less text and more visual structure";
    answers[10] = "A concrete example before the rule";
    answers[11] = "I understand it but cannot apply it";
    answers[12] = "Explain the mistake directly";
    answers[13] = "Keep the full path visible";
    answers[14] = "I want every explanation to start with an analogy.";
    answers[15] = "Those sessions ended because class finished.";

    expect(expandedLearnerContextFromAnswers(answers)).toMatchObject({
      functionalSupportNeed: null,
      processingPreference: null,
      memoryChallenge: null,
      supportPreference: null,
      workspacePreference: null,
      freeformContext: null,
      observationCorrection: "Those sessions ended because class finished.",
    });
    expect(buildPlanProfileSummary(answers)).toBe(
      "Learner correction to YOVA's observations: Those sessions ended because class finished.",
    );
  });

  it("does not turn underconfidence into a recall-deficit preference", () => {
    const underconfident = studyProfileStateAnswers({ q7: "d", q8: "d" });
    const overconfident = studyProfileStateAnswers({ q7: "d", q8: "c" });

    expect(expandedLearnerContextFromAnswers(underconfident).memoryChallenge).toBeNull();
    expect(expandedLearnerContextFromAnswers(overconfident).memoryChallenge)
      .toBe("I recognize it but cannot recall it");
  });

  it("keeps learner corrections while pausing the matching stated preferences", () => {
    let answers = completedStudyProfileAnswers();
    answers[10] = "A concrete example before the rule";
    answers[11] = "I understand it but cannot apply it";
    answers[12] = "Explain the mistake directly";
    const state = readPersonalizationStateFromAnswers(answers);
    answers = writePersonalizationStateToAnswers(answers, {
      ...state,
      pausedSignalIds: ["signal:processing_entry"],
      corrections: [{
        signalId: "signal:memory_breakdown",
        correctedValue: null,
        note: "That only happened in one unusually hard class.",
        doNotInfer: true,
        updatedAt: "2026-08-14T19:00:00.000Z",
      }, {
        signalId: "signal:mistake_sensitivity",
        correctedValue: null,
        note: "A timed test caused that answer.",
        doNotInfer: false,
        updatedAt: "2026-08-14T19:00:00.000Z",
      }],
    });

    expect(expandedLearnerContextFromAnswers(answers)).toMatchObject({
      processingPreference: null,
      memoryChallenge: null,
      supportPreference: "Explain the mistake directly",
      observationCorrection: expect.stringContaining(
        "That only happened in one unusually hard class.",
      ),
    });
    expect(expandedLearnerContextFromAnswers(answers).observationCorrection)
      .toContain("A timed test caused that answer.");
  });

  it("keeps note-only context advisory while honoring an explicit do-not-infer choice", () => {
    const baseAnswers: string[] = [];
    baseAnswers[3] = "A concrete example first";
    baseAnswers[10] = "A concrete example before the rule";
    const defaults = defaultPersonalizationState();
    const noteOnly = writePersonalizationStateToAnswers(baseAnswers, {
      ...defaults,
      corrections: [{
        signalId: "signal:processing_entry",
        correctedValue: null,
        note: "Examples help less when I already know the vocabulary.",
        doNotInfer: false,
        updatedAt: "2026-08-14T19:00:00.000Z",
      }],
    });

    expect(statedOnboardingAnswerForRuntime(noteOnly, 3)).toBe("A concrete example first");
    expect(expandedLearnerContextFromAnswers(noteOnly).processingPreference)
      .toBe("A concrete example before the rule");

    const stopped = writePersonalizationStateToAnswers(noteOnly, {
      ...readPersonalizationStateFromAnswers(noteOnly),
      corrections: [{
        signalId: "signal:processing_entry",
        correctedValue: null,
        note: "Do not use this as a usual preference.",
        doNotInfer: true,
        updatedAt: "2026-08-14T19:01:00.000Z",
      }],
    });
    expect(statedOnboardingAnswerForRuntime(stopped, 3)).toBeNull();
    expect(expandedLearnerContextFromAnswers(stopped).processingPreference).toBeNull();
  });

  it("keeps paused tendency answers out of legacy runtime fields", () => {
    const defaults = defaultPersonalizationState();
    const answers = writePersonalizationStateToAnswers([
      "I struggle to start",
      "Give me clear structure with flexibility",
      "20 to 30 minutes",
      "A concrete example first",
      "Often",
      "I intend to begin but often delay",
    ], {
      ...defaults,
      pausedSignalIds: ["signal:starting_friction", "signal:processing_entry"],
    });

    expect(statedOnboardingAnswerForRuntime(answers, 0)).toBeNull();
    expect(statedOnboardingAnswerForRuntime(answers, 3)).toBeNull();
    expect(statedOnboardingAnswerForRuntime(answers, 5)).toBeNull();
    expect(statedOnboardingAnswerForRuntime(answers, 1))
      .toBe("Give me clear structure with flexibility");
    expect(buildPlanProfileSummary(answers)).not.toMatch(
      /I struggle to start|concrete example|often delay/,
    );
  });

  it("exposes only bounded derived fields to plan prompts, never the serialized state", () => {
    const answers = completedStudyProfileAnswers();
    const summary = buildPlanProfileSummary(answers);

    expect(summary).toContain("I recognize it but cannot recall it");
    expect(summary).toContain("Show one step at a time");
    expect(summary).not.toContain("profile_model_v1");
    expect(summary).not.toContain("\"studyProfile\"");
  });
});

function completedStudyProfileAnswers(selfReport = true) {
  const state = defaultPersonalizationState();
  const studyProfileAnswers = Object.fromEntries(
    STUDY_PROFILE_QUESTION_IDS.map((questionId) => [questionId, questionId === "q8" ? "c" : "d"]),
  ) as StudyProfileAnswers;
  return writePersonalizationStateToAnswers([], {
    ...state,
    studyProfile: {
      ...state.studyProfile,
      answers: studyProfileAnswers,
      completedAt: "2026-08-14T18:00:00.000Z",
    },
    controls: {
      ...state.controls,
      selfReport,
    },
  });
}

function studyProfileStateAnswers(studyProfileAnswers: Partial<StudyProfileAnswers>) {
  const state = defaultPersonalizationState();
  return writePersonalizationStateToAnswers([], {
    ...state,
    studyProfile: {
      ...state.studyProfile,
      answers: studyProfileAnswers,
    },
  });
}
