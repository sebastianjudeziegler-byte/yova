import {
  onboardingAnswerId,
  onboardingAnswerLabel,
} from "@/lib/sample-data";
import {
  completedStudyProfileSnapshot,
  PERSONALIZATION_STATE_ANSWER_INDEX,
  readPersonalizationStateFromAnswers,
  readPersonalizationStateValue,
  serializePersonalizationState,
} from "@/lib/personalization/personalization-state";
import { STUDY_PROFILE_QUESTIONS } from "@/lib/study-profile/questions";
import { classifyStudyProfileScore } from "@/lib/study-profile/scoring";
import type {
  PersonalizationSignalCorrection,
  PersonalizationState,
} from "@/lib/personalization/personalization-state";
import type {
  StudyProfileCalibrationDirection,
  StudyProfileClassification,
  StudyProfileDimension,
} from "@/lib/study-profile/types";

export const DEEP_PROFILE_QUESTIONS = [
  {
    answerIndex: 10,
    prompt: "When information is new, what usually helps it click?",
    description: "YOVA uses this to choose how an explanation begins, then checks whether the approach actually helps.",
    options: [
      { id: "concrete_example", label: "A concrete example before the rule" },
      { id: "big_picture", label: "The big picture before the details" },
      { id: "small_steps", label: "A clear sequence of small steps" },
      { id: "try_first", label: "Trying it before seeing an explanation" },
      { id: "compare_similar", label: "Comparing similar ideas side by side" },
      { id: "depends", label: "It depends on the task" },
    ],
  },
  {
    answerIndex: 11,
    prompt: "What most often goes wrong after you study something?",
    description: "This changes what YOVA checks for, not the evidence-backed method selected for the task.",
    options: [
      { id: "recognition_without_recall", label: "I recognize it but cannot recall it" },
      { id: "delayed_forgetting", label: "I forget it after a few days" },
      { id: "similar_idea_confusion", label: "I confuse similar ideas" },
      { id: "application_gap", label: "I understand it but cannot apply it" },
      { id: "support_dependence", label: "I can do it with help but not independently" },
      { id: "depends", label: "It depends on the topic" },
    ],
  },
  {
    answerIndex: 12,
    prompt: "When you struggle, how should YOVA help first?",
    description: "YOVA can change the amount and kind of support without lowering the learning target.",
    options: [
      { id: "hint_first", label: "Give me a small hint first" },
      { id: "alternate_example", label: "Show me a different example" },
      { id: "direct_correction", label: "Explain the mistake directly" },
      { id: "smaller_steps", label: "Break it into smaller steps" },
      { id: "retry_independently", label: "Let me try again without help" },
      { id: "depends", label: "It depends on the task" },
    ],
  },
  {
    answerIndex: 13,
    prompt: "How should a session organize the work on screen?",
    description: "This affects navigation and visible structure, not what counts as learning.",
    options: [
      { id: "one_step", label: "Show one step at a time" },
      { id: "full_path", label: "Keep the full path visible" },
      { id: "learner_choice", label: "Give me choices and let me decide" },
      { id: "minimal_guidance", label: "Use the least guidance that works" },
      { id: "depends", label: "It depends on the session" },
    ],
  },
] as const;

export const FREEFORM_LEARNING_CONTEXT_INDEX = 14;
export const OBSERVATION_CORRECTION_INDEX = 15;
export const LEARNER_ANSWER_COUNT = PERSONALIZATION_STATE_ANSWER_INDEX + 1;

export type DeepProfileAnswerId =
  (typeof DEEP_PROFILE_QUESTIONS)[number]["options"][number]["id"];

const LEGACY_DEEP_PROFILE_LABEL_IDS: Readonly<Record<number, Readonly<Record<string, DeepProfileAnswerId>>>> = {
  10: { "A concrete example before the rule": "concrete_example", "The big picture before the details": "big_picture", "A clear sequence of small steps": "small_steps", "Trying it before seeing an explanation": "try_first", "Comparing similar ideas side by side": "compare_similar", "It depends on the task": "depends" },
  11: { "I recognize it but cannot recall it": "recognition_without_recall", "I forget it after a few days": "delayed_forgetting", "I confuse similar ideas": "similar_idea_confusion", "I understand it but cannot apply it": "application_gap", "I can do it with help but not independently": "support_dependence", "It depends on the topic": "depends" },
  12: { "Give me a small hint first": "hint_first", "Show me a different example": "alternate_example", "Explain the mistake directly": "direct_correction", "Break it into smaller steps": "smaller_steps", "Let me try again without help": "retry_independently", "It depends on the task": "depends" },
  13: { "Show one step at a time": "one_step", "Keep the full path visible": "full_path", "Give me choices and let me decide": "learner_choice", "Use the least guidance that works": "minimal_guidance", "It depends on the session": "depends" },
};

/**
 * Profiles saved before stable option IDs store the learner-facing label.
 * Keep that read boundary backward compatible while all behavioral routing
 * uses the option ID returned here.
 */
export function deepProfileAnswerId(
  answerIndex: number,
  value: string | null | undefined,
): DeepProfileAnswerId | null {
  const normalized = value?.trim() ?? "";
  if (!normalized) return null;
  const question = DEEP_PROFILE_QUESTIONS.find((item) => item.answerIndex === answerIndex);
  if (!question) return null;
  const directId = question.options.find((option) => option.id === normalized)?.id;
  return directId ?? LEGACY_DEEP_PROFILE_LABEL_IDS[answerIndex]?.[normalized] ?? null;
}

export function deepProfileAnswerLabel(
  answerIndex: number,
  value: string | null | undefined,
) {
  const answerId = deepProfileAnswerId(answerIndex, value);
  return DEEP_PROFILE_QUESTIONS.find((item) => item.answerIndex === answerIndex)
    ?.options.find((option) => option.id === answerId)?.label ?? null;
}

const ONBOARDING_SIGNAL_KEYS: Partial<Record<number, readonly string[]>> = {
  0: ["starting_friction", "structure_need", "mistake_sensitivity"],
  1: ["structure_need"],
  3: ["processing_entry"],
  4: ["attention_variability"],
  5: ["starting_friction"],
  6: ["energy_window"],
};

export type ExpandedLearnerContext = {
  functionalSupportNeed: string | null;
  processingPreference: string | null;
  memoryChallenge: string | null;
  supportPreference: string | null;
  workspacePreference: string | null;
  freeformContext: string | null;
  observationCorrection: string | null;
};

type StoredAdditionalContext = {
  schemaVersion: 3;
  functionalSupportNeed: string;
  initialContext: string;
  processingPreference: string;
  memoryChallenge: string;
  supportPreference: string;
  workspacePreference: string;
  freeformContext: string;
  observationCorrection: string;
  personalizationState: string;
  generationContext: ReturnType<typeof personalizationGenerationContext>;
};

export function expandedLearnerContextFromAnswers(answers: string[]): ExpandedLearnerContext {
  const state = readPersonalizationStateFromAnswers(answers);
  const observationCorrection = boundedLearnerCorrection(answers, state);
  if (!state.controls.selfReport) {
    return {
      functionalSupportNeed: null,
      processingPreference: null,
      memoryChallenge: null,
      supportPreference: null,
      workspacePreference: null,
      freeformContext: null,
      observationCorrection,
    };
  }

  const studyProfile = studyProfileDerivedContext(state);
  const memoryPreferenceBlocked = directSignalBlocksPreference(state, "memory_breakdown");
  const supportPreferenceBlocked = directSignalBlocksPreference(state, "repair_preference");
  const workspacePreferenceBlocked = directSignalBlocksPreference(state, "workspace_preference");
  return {
    functionalSupportNeed: functionalSupportNeedFromAnswer(answers[8])
      ?? studyProfile.functionalSupportNeed,
    processingPreference: controlledDirectPreference(answers[10], 10, "processing_entry", state),
    memoryChallenge: memoryPreferenceBlocked
      ? null
      : controlledDirectPreference(answers[11], 11, "memory_breakdown", state)
        ?? studyProfile.memoryChallenge,
    supportPreference: supportPreferenceBlocked
      ? null
      : controlledDirectPreference(answers[12], 12, "repair_preference", state)
        ?? studyProfile.supportPreference,
    workspacePreference: workspacePreferenceBlocked
      ? null
      : controlledDirectPreference(answers[13], 13, "workspace_preference", state)
        ?? studyProfile.workspacePreference,
    freeformContext: boundedAnswer(answers[FREEFORM_LEARNING_CONTEXT_INDEX], 800),
    observationCorrection,
  };
}

export function encodeAdditionalLearnerContext(answers: string[]) {
  const stored: StoredAdditionalContext = {
    schemaVersion: 3,
    // Keep explicit answers distinct from state-derived runtime defaults. If
    // the learner later disables self-report personalization, an inference
    // must not survive as though they had selected it directly.
    functionalSupportNeed: onboardingAnswerId(8, answers[8]) ?? "",
    initialContext: boundedAnswer(answers[9], 300) ?? "",
    processingPreference: deepProfileAnswerId(10, answers[10]) ?? "",
    memoryChallenge: deepProfileAnswerId(11, answers[11]) ?? "",
    supportPreference: deepProfileAnswerId(12, answers[12]) ?? "",
    workspacePreference: deepProfileAnswerId(13, answers[13]) ?? "",
    freeformContext: boundedAnswer(answers[FREEFORM_LEARNING_CONTEXT_INDEX], 800) ?? "",
    observationCorrection: boundedAnswer(answers[OBSERVATION_CORRECTION_INDEX], 500) ?? "",
    personalizationState: normalizedPersonalizationStateValue(
      answers[PERSONALIZATION_STATE_ANSWER_INDEX],
    ),
    generationContext: personalizationGenerationContext(
      readPersonalizationStateFromAnswers(answers),
    ),
  };
  return JSON.stringify(stored);
}

/**
 * Stable projection of state that can change lesson generation. The complete
 * state is still persisted for the learner-facing history, but receipt,
 * change, and weekly-review metadata must not evict unfinished lesson caches.
 */
export function personalizationGenerationContext(state: PersonalizationState) {
  const studyProfileAnswers = Object.fromEntries(
    STUDY_PROFILE_QUESTIONS.flatMap((question) => {
      const answer = state.studyProfile.answers[question.id];
      return answer ? [[question.id, answer]] : [];
    }),
  );
  return {
    version: 1,
    studyProfile: {
      modelVersion: state.studyProfile.modelVersion,
      answers: studyProfileAnswers,
    },
    controls: {
      selfReport: state.controls.selfReport,
      behavior: state.controls.behavior,
      timing: state.controls.timing,
      experiments: state.controls.experiments,
    },
    pausedSignalIds: [...state.pausedSignalIds].sort(),
    excludedEvidenceRefs: [...state.excludedEvidenceRefs].sort(),
    corrections: [...state.corrections]
      .sort((left, right) => left.signalId.localeCompare(right.signalId))
      .map((correction) => ({
        signalId: correction.signalId,
        correctedValue: correction.correctedValue,
        note: correction.note,
        doNotInfer: correction.doNotInfer,
      })),
    activeExperiment: state.activeExperiment ? {
      id: state.activeExperiment.id,
      variable: state.activeExperiment.variable,
      variantA: state.activeExperiment.variantA,
      variantB: state.activeExperiment.variantB,
      taskType: state.activeExperiment.taskType,
      knowledgeStage: state.activeExperiment.knowledgeStage,
      minimumSessionsPerVariant: state.activeExperiment.minimumSessionsPerVariant,
      userApproved: state.activeExperiment.userApproved,
      nextVariant: state.activeExperiment.nextVariant,
      observations: state.activeExperiment.observations.map((observation) => ({
        variant: observation.variant,
        correctAnswers: observation.correctAnswers,
        totalAnswers: observation.totalAnswers,
        feedback: observation.feedback,
      })),
    } : null,
    experimentHistory: state.experimentHistory.map((experiment) => ({
      id: experiment.id,
      variable: experiment.variable,
      variantA: experiment.variantA,
      variantB: experiment.variantB,
      taskType: experiment.taskType,
      knowledgeStage: experiment.knowledgeStage,
      result: experiment.result,
    })),
  };
}

export function mergeStoredAdditionalContext(answers: string[], value: string | null) {
  const merged = Array.from({ length: LEARNER_ANSWER_COUNT }, (_, index) => answers[index] ?? "");
  if (!value) return merged;

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    merged[9] = value.slice(0, 300);
    return merged;
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    merged[9] = value.slice(0, 300);
    return merged;
  }

  const stored = parsed as Record<string, unknown>;
  merged[8] = onboardingAnswerId(8, readStoredText(stored, "functionalSupportNeed", 240)) ?? "";
  merged[9] = readStoredText(stored, "initialContext", 300);
  merged[10] = deepProfileAnswerId(10, readStoredText(stored, "processingPreference", 240)) ?? "";
  merged[11] = deepProfileAnswerId(11, readStoredText(stored, "memoryChallenge", 240)) ?? "";
  merged[12] = deepProfileAnswerId(12, readStoredText(stored, "supportPreference", 240)) ?? "";
  merged[13] = deepProfileAnswerId(13, readStoredText(stored, "workspacePreference", 240)) ?? "";
  merged[FREEFORM_LEARNING_CONTEXT_INDEX] = readStoredText(stored, "freeformContext", 800);
  merged[OBSERVATION_CORRECTION_INDEX] = readStoredText(stored, "observationCorrection", 500);
  merged[PERSONALIZATION_STATE_ANSWER_INDEX] = normalizedPersonalizationStateValue(
    readStoredText(stored, "personalizationState"),
  );
  return merged;
}

export function functionalSupportNeedFromAnswer(value: string | undefined) {
  return onboardingAnswerLabel(8, boundedAnswer(value, 240));
}

export function expandedLearnerContextFromStored(value: string | null) {
  return expandedLearnerContextFromAnswers(mergeStoredAdditionalContext([], value));
}

export function statedOnboardingAnswerForRuntime(
  answers: readonly string[],
  answerIndex: number,
  state = readPersonalizationStateFromAnswers(answers),
) {
  if (!state.controls.selfReport) return null;
  if (answerIndex === 6 && !state.controls.timing) return null;
  const signalKeys = ONBOARDING_SIGNAL_KEYS[answerIndex] ?? [];
  if (signalKeys.some((key) => !signalAllowsInference(state, key))) return null;
  if (answerIndex < 10) {
    return onboardingAnswerLabel(answerIndex, boundedAnswer(answers[answerIndex], 300));
  }
  return boundedAnswer(answers[answerIndex], 300);
}

export function personalizationSignalAllowsRuntimeInference(
  state: PersonalizationState,
  key: string,
) {
  return signalAllowsInference(state, key);
}

export function deepProfileAnswerCount(answers: string[]) {
  return DEEP_PROFILE_QUESTIONS.filter((question) => Boolean(answers[question.answerIndex]?.trim())).length
    + (answers[FREEFORM_LEARNING_CONTEXT_INDEX]?.trim() ? 1 : 0);
}

function readStoredText(value: Record<string, unknown>, key: string, maxLength?: number) {
  if (typeof value[key] !== "string") return "";
  const normalized = value[key].trim();
  return maxLength === undefined ? normalized : normalized.slice(0, maxLength);
}

function studyProfileDerivedContext(state: PersonalizationState): Pick<
  ExpandedLearnerContext,
  "functionalSupportNeed" | "memoryChallenge" | "supportPreference" | "workspacePreference"
> {
  const classifications = resolvedStudyProfileClassifications(state);
  if (!classifications) {
    return {
      functionalSupportNeed: null,
      memoryChallenge: null,
      supportPreference: null,
      workspacePreference: null,
    };
  }

  const high = (dimension: StudyProfileDimension) => (
    signalAllowsInference(state, dimension)
    && classifications[dimension] === "high"
  );
  const calibrationDirection = resolvedStudyProfileCalibrationDirection(state);
  return {
    functionalSupportNeed: high("starting_friction") || high("cognitive_stamina")
      ? "Shorter sections with fewer steps at once"
      : null,
    memoryChallenge: high("calibration_risk")
      && calibrationDirection === "overconfidence_risk"
      ? "I recognize it but cannot recall it"
      : null,
    supportPreference: high("mistake_sensitivity")
      ? "Give me a small hint first"
      : null,
    workspacePreference: high("structure_need")
      ? "Show one step at a time"
      : null,
  };
}

function controlledDirectPreference(
  answer: string | undefined,
  answerIndex: number,
  signalKey: string,
  state: PersonalizationState,
) {
  const signalId = `signal:${signalKey}`;
  if (state.pausedSignalIds.includes(signalId)) return null;
  const correction = state.corrections.find((item) => item.signalId === signalId);
  if (!correction) return deepProfileAnswerLabel(answerIndex, answer);
  if (correction.doNotInfer) return null;

  const correctedValue = boundedAnswer(correction.correctedValue ?? undefined, 240);
  // A note supplies context for the generator, but it is not itself a new
  // preference. Keep the learner's explicit answer unless they either stop
  // this inference or provide a concrete supported replacement.
  return correctedValue && isSupportedDeepProfileAnswer(answerIndex, correctedValue)
    ? deepProfileAnswerLabel(answerIndex, correctedValue)
    : deepProfileAnswerLabel(answerIndex, answer);
}

function directSignalBlocksPreference(
  state: PersonalizationState,
  signalKey: string,
) {
  const signalId = `signal:${signalKey}`;
  if (state.pausedSignalIds.includes(signalId)) return true;
  const correction = state.corrections.find((item) => item.signalId === signalId);
  if (!correction) return false;
  return correction.doNotInfer;
}

function isSupportedDeepProfileAnswer(answerIndex: number, value: string) {
  const answerId = deepProfileAnswerId(answerIndex, value);
  return answerId !== null && answerId !== "depends";
}

function signalAllowsInference(state: PersonalizationState, key: string) {
  const signalId = `signal:${key}`;
  if (state.pausedSignalIds.includes(signalId)) return false;
  const correction = state.corrections.find((item) => item.signalId === signalId);
  if (!correction) return true;
  if (correction.doNotInfer) return false;
  const correctedValue = boundedAnswer(correction.correctedValue ?? undefined, 240);
  return !correctedValue || !isSupportedRuntimeCorrection(key, correctedValue);
}

function isSupportedRuntimeCorrection(key: string, value: string) {
  const directAnswerIndex: Partial<Record<string, number>> = {
    processing_entry: 10,
    memory_breakdown: 11,
    repair_preference: 12,
    workspace_preference: 13,
  };
  const answerIndex = directAnswerIndex[key];
  if (answerIndex !== undefined) return isSupportedDeepProfileAnswer(answerIndex, value);

  const normalized = value.toLowerCase();
  const supportedStudyProfileValues: Partial<Record<StudyProfileDimension, readonly string[]>> = {
    starting_friction: ["low", "moderate", "high", "higher starting friction"],
    structure_need: ["flexible", "balanced", "high-structure"],
    attention_variability: ["steady", "variable", "highly variable"],
    calibration_risk: [
      "relatively calibrated",
      "mixed",
      "needs more checking",
      "overconfidence risk",
      "underconfidence risk",
    ],
    mistake_sensitivity: ["low", "moderate", "high", "higher mistake sensitivity"],
    cognitive_stamina: ["stable", "moderate decline", "fast decline"],
  };
  return supportedStudyProfileValues[key as StudyProfileDimension]?.includes(normalized) === true;
}

function boundedLearnerCorrection(answers: string[], state: PersonalizationState) {
  const corrections = [
    boundedAnswer(answers[OBSERVATION_CORRECTION_INDEX], 500),
    ...state.corrections.map(correctionContext).filter((value): value is string => Boolean(value)),
  ].filter((value): value is string => Boolean(value));
  const unique = [...new Set(corrections)];
  return boundedAnswer(unique.join(" "), 500);
}

function correctionContext(correction: PersonalizationSignalCorrection) {
  if (correction.note) return correction.note;
  if (!correction.doNotInfer) return null;
  const label = correction.signalId
    .replace(/^signal:/, "")
    .replaceAll("_", " ");
  return `Do not infer ${label} from my activity.`;
}

function resolvedStudyProfileCalibrationDirection(
  state: PersonalizationState,
): StudyProfileCalibrationDirection | null {
  const completed = completedStudyProfileSnapshot(state);
  if (completed) return completed.calibrationDirection;
  const q7 = state.studyProfile.answers.q7;
  const q8 = state.studyProfile.answers.q8;
  if (!q7 || !q8) return null;
  if (q8 === "d") return "underconfidence_risk";
  if (q8 === "c" || q7 === "d") return "overconfidence_risk";
  if (q8 === "b") return "mixed";
  return "relatively_calibrated";
}

function resolvedStudyProfileClassifications(
  state: ReturnType<typeof readPersonalizationStateFromAnswers>,
): Partial<Record<StudyProfileDimension, StudyProfileClassification>> | null {
  const completed = completedStudyProfileSnapshot(state);
  if (completed) return completed.classifications;

  const classifications: Partial<Record<StudyProfileDimension, StudyProfileClassification>> = {};
  for (const question of STUDY_PROFILE_QUESTIONS) {
    if (classifications[question.dimension]) continue;
    const pair = STUDY_PROFILE_QUESTIONS.filter((candidate) => (
      candidate.dimension === question.dimension
    ));
    const scores = pair.flatMap((candidate) => {
      const answer = state.studyProfile.answers[candidate.id];
      const option = candidate.options.find((candidateOption) => candidateOption.id === answer);
      return option ? [option.score] : [];
    });
    // Each dimension is intentionally based on two answers. A lone response
    // is useful UI progress, but not enough evidence to affect a lesson.
    if (scores.length !== pair.length || pair.length !== 2) continue;
    classifications[question.dimension] = classifyStudyProfileScore(
      scores.reduce<number>((sum, score) => sum + score, 0),
    );
  }
  return Object.keys(classifications).length > 0 ? classifications : null;
}

function normalizedPersonalizationStateValue(value: string | null | undefined) {
  if (!value?.trim()) return "";
  return serializePersonalizationState(readPersonalizationStateValue(value));
}

function boundedAnswer(value: string | undefined, maxLength: number) {
  const normalized = value?.trim().slice(0, maxLength) ?? "";
  return normalized || null;
}
