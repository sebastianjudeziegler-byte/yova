import {
  STUDY_PROFILE_ANSWER_IDS,
  STUDY_PROFILE_MODEL_VERSION,
  STUDY_PROFILE_QUESTION_IDS,
  type StudyProfileAnswerId,
  type StudyProfileAnswers,
  type StudyProfileQuestionId,
  type StudyProfileSnapshot,
} from "@/lib/study-profile/types";
import { scoreStudyProfile } from "@/lib/study-profile/scoring";
import {
  CORE_METHOD_IDS,
  type CoreMethodId,
} from "@/lib/learning/method-catalog";

export const PERSONALIZATION_STATE_VERSION = 1 as const;
export const PERSONALIZATION_STATE_ANSWER_INDEX = 16;
export const PERSONALIZATION_STATE_MAX_LENGTH = 24_000;

export type PersonalizationControls = {
  selfReport: boolean;
  behavior: boolean;
  timing: boolean;
  experiments: boolean;
  optionalQuestions: boolean;
  receipts: boolean;
};

export type PersonalizationWorkspaceSettings = {
  layout: "automatic" | "one_step" | "full_path";
  textDensity: "automatic" | "standard" | "reduced";
  motion: "automatic" | "standard" | "reduced";
  visualStructure: "automatic" | "standard" | "more";
  checkIns: "automatic" | "standard" | "more";
};

export type PersonalizationSignalCorrection = {
  signalId: string;
  correctedValue: string | null;
  note: string | null;
  doNotInfer: boolean;
  updatedAt: string;
};

export const PERSONALIZATION_EXPERIMENT_VARIABLES = [
  "presentation",
  "workspace",
  "support",
  "first_action",
  "energy_window",
  "method_tie",
] as const;

export type PersonalizationExperimentVariable =
  (typeof PERSONALIZATION_EXPERIMENT_VARIABLES)[number];

export type ActivePersonalizationExperiment = {
  id: string;
  variable: PersonalizationExperimentVariable;
  variantA: string;
  variantB: string;
  startedAt: string;
  taskType: string | null;
  knowledgeStage: string | null;
  minimumSessionsPerVariant: number;
  userApproved: true;
  nextVariant: "a" | "b";
  observations: PersonalizationExperimentObservation[];
};

export type PersonalizationExperimentObservation = {
  completionId: string;
  variant: "a" | "b";
  correctAnswers: number;
  totalAnswers: number;
  feedback: "too_easy" | "about_right" | "too_difficult";
  recordedAt: string;
};

export type PersonalizationExperimentHistoryItem = {
  id: string;
  variable: PersonalizationExperimentVariable;
  variantA: string;
  variantB: string;
  taskType: string | null;
  knowledgeStage: string | null;
  result: "promising_a" | "promising_b" | "mixed" | "stopped";
  summary: string;
  sessionsA: number;
  sessionsB: number;
  checkedAnswers: number;
  accuracyA: number | null;
  accuracyB: number | null;
  completedAt: string;
};

export type PersonalizationExperimentEvaluation = {
  ready: boolean;
  sessionsA: number;
  sessionsB: number;
  checkedAnswers: number;
  accuracyA: number | null;
  accuracyB: number | null;
  difficultA: number;
  difficultB: number;
  result: "promising_a" | "promising_b" | "mixed" | null;
  summary: string;
};

export type PersonalizationReceiptHistoryItem = {
  key: string;
  shownAt: string;
};

export type PersonalizationChangeHistoryItem = {
  id: string;
  area: "workspace" | "control";
  setting: string;
  previousValue: string;
  nextValue: string;
  title: string;
  reason: string;
  occurredAt: string;
  undoneAt: string | null;
};

export type PersonalizationWeeklyReviewHistoryItem = {
  key: string;
  reviewedAt: string;
};

export type PersonalizationState = {
  version: typeof PERSONALIZATION_STATE_VERSION;
  studyProfile: {
    modelVersion: typeof STUDY_PROFILE_MODEL_VERSION;
    answers: Partial<StudyProfileAnswers>;
    completedAt: string | null;
  };
  controls: PersonalizationControls;
  /**
   * Methods the learner would like YOVA to favor when they are already valid
   * for the current task. Absence and an empty list are intentionally the
   * same so pre-feature v1 states retain their byte-canonical serialization.
   */
  preferredMethodIds?: CoreMethodId[];
  pausedSignalIds: string[];
  excludedEvidenceRefs: string[];
  corrections: PersonalizationSignalCorrection[];
  workspace: PersonalizationWorkspaceSettings;
  activeExperiment: ActivePersonalizationExperiment | null;
  experimentHistory: PersonalizationExperimentHistoryItem[];
  receiptHistory: PersonalizationReceiptHistoryItem[];
  changeHistory: PersonalizationChangeHistoryItem[];
  weeklyReviewHistory: PersonalizationWeeklyReviewHistoryItem[];
};

const DEFAULT_CONTROLS: PersonalizationControls = {
  selfReport: true,
  behavior: true,
  timing: true,
  experiments: false,
  optionalQuestions: true,
  receipts: true,
};

const DEFAULT_WORKSPACE: PersonalizationWorkspaceSettings = {
  layout: "automatic",
  textDensity: "automatic",
  motion: "automatic",
  visualStructure: "automatic",
  checkIns: "automatic",
};

const QUESTION_IDS = new Set<string>(STUDY_PROFILE_QUESTION_IDS);
const ANSWER_IDS = new Set<string>(STUDY_PROFILE_ANSWER_IDS);
const EXPERIMENT_VARIABLES = new Set<string>(PERSONALIZATION_EXPERIMENT_VARIABLES);

export function defaultPersonalizationState(): PersonalizationState {
  return {
    version: PERSONALIZATION_STATE_VERSION,
    studyProfile: {
      modelVersion: STUDY_PROFILE_MODEL_VERSION,
      answers: {},
      completedAt: null,
    },
    controls: { ...DEFAULT_CONTROLS },
    pausedSignalIds: [],
    excludedEvidenceRefs: [],
    corrections: [],
    workspace: { ...DEFAULT_WORKSPACE },
    activeExperiment: null,
    experimentHistory: [],
    receiptHistory: [],
    changeHistory: [],
    weeklyReviewHistory: [],
  };
}

/**
 * Parses the reserved profile value without trusting its shape. Invalid,
 * oversized, or future-version data falls back to a clean state.
 */
export function readPersonalizationStateValue(
  value: string | null | undefined,
): PersonalizationState {
  if (!value || value.length > PERSONALIZATION_STATE_MAX_LENGTH) {
    return defaultPersonalizationState();
  }

  try {
    return normalizePersonalizationState(JSON.parse(value));
  } catch {
    return defaultPersonalizationState();
  }
}

export function readPersonalizationStateFromAnswers(
  answers: readonly string[],
): PersonalizationState {
  return readPersonalizationStateValue(answers[PERSONALIZATION_STATE_ANSWER_INDEX]);
}

export function serializePersonalizationState(state: PersonalizationState): string {
  const serialized = JSON.stringify(compactPersonalizationState(
    normalizePersonalizationState(state),
  ));
  if (serialized.length > PERSONALIZATION_STATE_MAX_LENGTH) {
    throw new RangeError("The personalization state is too large to store safely.");
  }
  return serialized;
}

export function writePersonalizationStateToAnswers(
  answers: readonly string[],
  state: PersonalizationState,
): string[] {
  const next = Array.from(
    { length: Math.max(answers.length, PERSONALIZATION_STATE_ANSWER_INDEX + 1) },
    (_, index) => answers[index] ?? "",
  );
  next[PERSONALIZATION_STATE_ANSWER_INDEX] = serializePersonalizationState(state);
  return next;
}

export function updatePersonalizationStateInAnswers(
  answers: readonly string[],
  update: (current: PersonalizationState) => PersonalizationState,
): string[] {
  return writePersonalizationStateToAnswers(
    answers,
    update(readPersonalizationStateFromAnswers(answers)),
  );
}

/** Returns a scored snapshot only after all twelve optional questions exist. */
export function completedStudyProfileSnapshot(
  state: PersonalizationState,
): StudyProfileSnapshot | null {
  const complete = Object.fromEntries(STUDY_PROFILE_QUESTION_IDS.flatMap((questionId) => {
    const answer = state.studyProfile.answers[questionId];
    return answer ? [[questionId, answer]] : [];
  }));
  if (Object.keys(complete).length !== STUDY_PROFILE_QUESTION_IDS.length) return null;

  try {
    return scoreStudyProfile(complete as StudyProfileAnswers);
  } catch {
    return null;
  }
}

export function withStudyProfileAnswer(
  state: PersonalizationState,
  questionId: StudyProfileQuestionId,
  answer: StudyProfileAnswerId | null,
): PersonalizationState {
  const nextAnswers = { ...state.studyProfile.answers };
  if (answer) nextAnswers[questionId] = answer;
  else delete nextAnswers[questionId];
  const complete = STUDY_PROFILE_QUESTION_IDS.every((id) => Boolean(nextAnswers[id]));

  return normalizePersonalizationState({
    ...state,
    studyProfile: {
      ...state.studyProfile,
      answers: nextAnswers,
      completedAt: complete ? state.studyProfile.completedAt : null,
    },
  });
}

/**
 * Returns the learner's bounded preference set without exposing the optional
 * storage representation to callers.
 */
export function preferredMethodIds(state: PersonalizationState): CoreMethodId[] {
  return sanitizePreferredMethodIds(state.preferredMethodIds);
}

/**
 * Stores at most three unique catalog methods in canonical catalog order.
 * These IDs are preferences only; the method selector must still intersect
 * them with the server-computed task/stage/mode eligibility set.
 */
export function setPreferredMethodIds(
  state: PersonalizationState,
  methodIds: readonly CoreMethodId[],
): PersonalizationState {
  const withoutPreferences = { ...state };
  delete withoutPreferences.preferredMethodIds;
  const normalized = sanitizePreferredMethodIds(methodIds);
  return normalizePersonalizationState({
    ...withoutPreferences,
    ...(normalized.length > 0 ? { preferredMethodIds: normalized } : {}),
  });
}

export function upsertPersonalizationCorrection(
  state: PersonalizationState,
  correction: PersonalizationSignalCorrection,
): PersonalizationState {
  return normalizePersonalizationState({
    ...state,
    corrections: [
      ...state.corrections.filter((item) => item.signalId !== correction.signalId),
      correction,
    ],
  });
}

export function setPersonalizationEvidenceRefExcluded(
  state: PersonalizationState,
  evidenceRef: string,
  excluded: boolean,
): PersonalizationState {
  const safeRef = boundedString(evidenceRef, 120);
  if (!safeRef) return state;
  return normalizePersonalizationState({
    ...state,
    excludedEvidenceRefs: excluded
      ? [...new Set([...state.excludedEvidenceRefs, safeRef])]
      : state.excludedEvidenceRefs.filter((item) => item !== safeRef),
  });
}

export function setPersonalizationWorkspaceSetting<K extends keyof PersonalizationWorkspaceSettings>(
  state: PersonalizationState,
  key: K,
  value: PersonalizationWorkspaceSettings[K],
  occurredAt: string,
): PersonalizationState {
  if (state.workspace[key] === value) return state;
  const safeOccurredAt = nullableIsoDate(occurredAt);
  if (!safeOccurredAt) return state;
  return normalizePersonalizationState({
    ...state,
    workspace: { ...state.workspace, [key]: value },
    changeHistory: appendChange(state.changeHistory, {
      id: `workspace:${key}:${safeOccurredAt}`,
      area: "workspace",
      setting: key,
      previousValue: state.workspace[key],
      nextValue: value,
      title: workspaceChangeTitle(key, value),
      reason: "You changed this workspace setting directly.",
      occurredAt: safeOccurredAt,
      undoneAt: null,
    }),
  });
}

export function setPersonalizationControl<K extends keyof PersonalizationControls>(
  state: PersonalizationState,
  key: K,
  enabled: PersonalizationControls[K],
  occurredAt: string,
): PersonalizationState {
  if (state.controls[key] === enabled) return state;
  const safeOccurredAt = nullableIsoDate(occurredAt);
  if (!safeOccurredAt) return state;
  return normalizePersonalizationState({
    ...state,
    controls: { ...state.controls, [key]: enabled },
    changeHistory: appendChange(state.changeHistory, {
      id: `control:${key}:${safeOccurredAt}`,
      area: "control",
      setting: key,
      previousValue: String(state.controls[key]),
      nextValue: String(enabled),
      title: `${controlTitle(key)} turned ${enabled ? "on" : "off"}`,
      reason: "You changed this personalization control directly.",
      occurredAt: safeOccurredAt,
      undoneAt: null,
    }),
  });
}

export function undoPersonalizationChange(
  state: PersonalizationState,
  changeId: string,
  undoneAt: string,
): PersonalizationState {
  const change = state.changeHistory.find((item) => item.id === changeId && !item.undoneAt);
  const safeUndoneAt = nullableIsoDate(undoneAt);
  if (!change || !safeUndoneAt) return state;
  const nextHistory = state.changeHistory.map((item) => (
    item.id === changeId ? { ...item, undoneAt: safeUndoneAt } : item
  ));
  const next = {
    ...state,
    changeHistory: nextHistory,
  };
  if (change.area === "workspace" && isWorkspaceSetting(change.setting)) {
    const replayed = replayWorkspaceSetting(nextHistory, change.setting);
    if (replayed !== null) {
      return normalizePersonalizationState({
        ...next,
        workspace: { ...state.workspace, [change.setting]: replayed },
      });
    }
  }
  if (change.area === "control" && isControlSetting(change.setting)) {
    const replayed = replayControlSetting(nextHistory, change.setting);
    if (replayed === null) return state;
    return normalizePersonalizationState({
      ...next,
      controls: { ...state.controls, [change.setting]: replayed },
    });
  }
  return state;
}

export function recordPersonalizationWeeklyReview(
  state: PersonalizationState,
  key: string,
  reviewedAt: string,
): PersonalizationState {
  const safeKey = boundedString(key, 80);
  const safeReviewedAt = nullableIsoDate(reviewedAt);
  if (!safeKey || !safeReviewedAt) return state;
  return normalizePersonalizationState({
    ...state,
    weeklyReviewHistory: [
      ...state.weeklyReviewHistory.filter((item) => item.key !== safeKey),
      { key: safeKey, reviewedAt: safeReviewedAt },
    ].slice(-12),
  });
}

export function startPersonalizationExperiment(
  state: PersonalizationState,
  experiment: Omit<
    ActivePersonalizationExperiment,
    "minimumSessionsPerVariant" | "userApproved" | "nextVariant" | "observations"
  > & { minimumSessionsPerVariant?: number },
): PersonalizationState {
  if (!state.controls.experiments || state.activeExperiment) return state;
  return normalizePersonalizationState({
    ...state,
    activeExperiment: {
      ...experiment,
      minimumSessionsPerVariant: experiment.minimumSessionsPerVariant ?? 2,
      userApproved: true,
      nextVariant: "a",
      observations: [],
    },
  });
}

export function recordPersonalizationExperimentCompletion(
  state: PersonalizationState,
  completion: Omit<PersonalizationExperimentObservation, "variant"> & {
    variant?: "a" | "b";
  },
): PersonalizationState {
  const active = state.activeExperiment;
  if (!state.controls.experiments || !active) return state;
  if (active.observations.some((item) => item.completionId === completion.completionId)) {
    return state;
  }
  const variant = completion.variant ?? active.nextVariant;
  return normalizePersonalizationState({
    ...state,
    activeExperiment: {
      ...active,
      nextVariant: variant === "a" ? "b" : "a",
      observations: [...active.observations, { ...completion, variant }],
    },
  });
}

export function personalizationExperimentAcceptsCompletion(
  experiment: ActivePersonalizationExperiment | null,
  comparison: { taskType: string; knowledgeStage: string },
) {
  return Boolean(
    experiment?.taskType
    && experiment.knowledgeStage
    && experiment.taskType === comparison.taskType
    && experiment.knowledgeStage === comparison.knowledgeStage,
  );
}

export function effectivePersonalizationWorkspaceSettings(
  state: PersonalizationState,
  comparison: { taskType: string; knowledgeStage: string } | null = null,
): PersonalizationWorkspaceSettings {
  const experiment = state.controls.experiments ? state.activeExperiment : null;
  if (
    experiment?.variable === "workspace"
    && comparison
    && personalizationExperimentAcceptsCompletion(experiment, comparison)
    && personalizationExperimentResultAllowsInference(state, experiment.id)
  ) {
    const variant = experiment.nextVariant === "a" ? experiment.variantA : experiment.variantB;
    if (variant === "one_step" || variant === "full_path") {
      return { ...state.workspace, layout: variant };
    }
  }
  if (state.workspace.layout !== "automatic") return state.workspace;
  if (!state.controls.experiments) return state.workspace;
  if (!comparison) return state.workspace;
  const tested = [...state.experimentHistory].reverse().find((item) => (
    item.variable === "workspace"
    && item.taskType === comparison.taskType
    && item.knowledgeStage === comparison.knowledgeStage
  ));
  if (!tested || (tested.result !== "promising_a" && tested.result !== "promising_b")) {
    return state.workspace;
  }
  if (!personalizationExperimentResultAllowsInference(state, tested.id)) return state.workspace;
  const winner = tested.result === "promising_a" ? tested.variantA : tested.variantB;
  return winner === "one_step" || winner === "full_path"
    ? { ...state.workspace, layout: winner }
    : state.workspace;
}

export function evaluateActivePersonalizationExperiment(
  experiment: ActivePersonalizationExperiment | null,
): PersonalizationExperimentEvaluation {
  if (!experiment) return emptyExperimentEvaluation();
  const a = experiment.observations.filter((item) => item.variant === "a");
  const b = experiment.observations.filter((item) => item.variant === "b");
  const checkedAnswers = [...a, ...b].reduce((sum, item) => sum + item.totalAnswers, 0);
  const accuracyA = experimentAccuracy(a);
  const accuracyB = experimentAccuracy(b);
  const difficultA = a.filter((item) => item.feedback === "too_difficult").length;
  const difficultB = b.filter((item) => item.feedback === "too_difficult").length;
  const ready = a.length >= experiment.minimumSessionsPerVariant
    && b.length >= experiment.minimumSessionsPerVariant
    && checkedAnswers >= 8
    && accuracyA !== null
    && accuracyB !== null;
  const difference = ready ? accuracyA - accuracyB : 0;
  const result = !ready
    ? null
    : difference >= 15 && difficultA <= difficultB
      ? "promising_a" as const
      : difference <= -15 && difficultB <= difficultA
        ? "promising_b" as const
        : "mixed" as const;
  const summary = !ready
    ? `Keep testing until both options have at least ${experiment.minimumSessionsPerVariant} comparable sessions and there are at least 8 checked answers.`
    : result === "promising_a"
      ? `${experiment.variantA} is promising in this personal test. Keep treating it as a changeable result, not a permanent learning type.`
      : result === "promising_b"
        ? `${experiment.variantB} is promising in this personal test. Keep treating it as a changeable result, not a permanent learning type.`
        : "The two options produced mixed results, so YOVA should not prefer either one yet.";

  return {
    ready,
    sessionsA: a.length,
    sessionsB: b.length,
    checkedAnswers,
    accuracyA,
    accuracyB,
    difficultA,
    difficultB,
    result,
    summary,
  };
}

export function finishPersonalizationExperiment(
  state: PersonalizationState,
  completedAt: string,
): PersonalizationState {
  const active = state.activeExperiment;
  const evaluation = evaluateActivePersonalizationExperiment(active);
  if (!active || !evaluation.ready || !evaluation.result) return state;
  return moveExperimentToHistory(state, active, evaluation, evaluation.result, completedAt);
}

export function stopPersonalizationExperiment(
  state: PersonalizationState,
  completedAt: string,
): PersonalizationState {
  const active = state.activeExperiment;
  if (!active) return state;
  const evaluation = evaluateActivePersonalizationExperiment(active);
  return moveExperimentToHistory(state, active, evaluation, "stopped", completedAt);
}

function normalizePersonalizationState(value: unknown): PersonalizationState {
  const defaults = defaultPersonalizationState();
  if (!isRecord(value) || value.version !== PERSONALIZATION_STATE_VERSION) return defaults;

  const studyProfile = isRecord(value.studyProfile) ? value.studyProfile : {};
  const controls = isRecord(value.controls) ? value.controls : {};
  const workspace = isRecord(value.workspace) ? value.workspace : {};
  const answers = sanitizeStudyProfileAnswers(studyProfile.answers);
  const normalizedPreferredMethodIds = sanitizePreferredMethodIds(
    value.preferredMethodIds,
  );
  const complete = STUDY_PROFILE_QUESTION_IDS.every((id) => Boolean(answers[id]));

  return {
    version: PERSONALIZATION_STATE_VERSION,
    studyProfile: {
      modelVersion: STUDY_PROFILE_MODEL_VERSION,
      answers,
      completedAt: complete ? nullableIsoDate(studyProfile.completedAt) : null,
    },
    controls: {
      selfReport: booleanOr(controls.selfReport, defaults.controls.selfReport),
      behavior: booleanOr(controls.behavior, defaults.controls.behavior),
      timing: booleanOr(controls.timing, defaults.controls.timing),
      experiments: booleanOr(controls.experiments, defaults.controls.experiments),
      optionalQuestions: booleanOr(
        controls.optionalQuestions,
        defaults.controls.optionalQuestions,
      ),
      receipts: booleanOr(controls.receipts, defaults.controls.receipts),
    },
    ...(normalizedPreferredMethodIds.length > 0
      ? { preferredMethodIds: normalizedPreferredMethodIds }
      : {}),
    pausedSignalIds: uniqueBoundedStrings(value.pausedSignalIds, 50, 120),
    excludedEvidenceRefs: uniqueBoundedStrings(value.excludedEvidenceRefs, 50, 120),
    corrections: sanitizeCorrections(value.corrections),
    workspace: {
      layout: enumOr(workspace.layout, ["automatic", "one_step", "full_path"], defaults.workspace.layout),
      textDensity: enumOr(workspace.textDensity, ["automatic", "standard", "reduced"], defaults.workspace.textDensity),
      motion: enumOr(workspace.motion, ["automatic", "standard", "reduced"], defaults.workspace.motion),
      visualStructure: enumOr(workspace.visualStructure, ["automatic", "standard", "more"], defaults.workspace.visualStructure),
      checkIns: enumOr(workspace.checkIns, ["automatic", "standard", "more"], defaults.workspace.checkIns),
    },
    activeExperiment: sanitizeActiveExperiment(value.activeExperiment),
    experimentHistory: sanitizeExperimentHistory(value.experimentHistory),
    receiptHistory: sanitizeReceiptHistory(value.receiptHistory),
    changeHistory: sanitizeChangeHistory(value.changeHistory),
    weeklyReviewHistory: sanitizeWeeklyReviewHistory(value.weeklyReviewHistory),
  };
}

function sanitizePreferredMethodIds(value: unknown): CoreMethodId[] {
  if (!Array.isArray(value)) return [];
  const requested = new Set(value.filter((item): item is CoreMethodId => (
    typeof item === "string"
    && (CORE_METHOD_IDS as readonly string[]).includes(item)
  )));
  return CORE_METHOD_IDS.filter((methodId) => requested.has(methodId)).slice(0, 3);
}

function sanitizeStudyProfileAnswers(value: unknown): Partial<StudyProfileAnswers> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([questionId, answer]) => (
    QUESTION_IDS.has(questionId) && typeof answer === "string" && ANSWER_IDS.has(answer)
      ? [[questionId, answer]]
      : []
  ))) as Partial<StudyProfileAnswers>;
}

function sanitizeCorrections(value: unknown): PersonalizationSignalCorrection[] {
  if (!Array.isArray(value)) return [];
  const bySignal = new Map<string, PersonalizationSignalCorrection>();
  for (const item of value.slice(-50)) {
    if (!isRecord(item)) continue;
    const signalId = boundedString(item.signalId, 120);
    const updatedAt = nullableIsoDate(item.updatedAt);
    if (!signalId || !updatedAt) continue;
    bySignal.set(signalId, {
      signalId,
      correctedValue: nullableBoundedString(item.correctedValue, 200),
      note: nullableBoundedString(item.note, 500),
      doNotInfer: item.doNotInfer === true,
      updatedAt,
    });
  }
  return [...bySignal.values()];
}

function sanitizeActiveExperiment(value: unknown): ActivePersonalizationExperiment | null {
  if (!isRecord(value)) return null;
  const id = boundedString(value.id, 120);
  const variable = typeof value.variable === "string" && EXPERIMENT_VARIABLES.has(value.variable)
    ? value.variable as PersonalizationExperimentVariable
    : null;
  const variantA = boundedString(value.variantA, 120);
  const variantB = boundedString(value.variantB, 120);
  const startedAt = nullableIsoDate(value.startedAt);
  const taskType = nullableBoundedString(value.taskType, 80);
  const knowledgeStage = nullableBoundedString(value.knowledgeStage, 80);
  if (
    !id
    || !variable
    || !variantA
    || !variantB
    || variantA === variantB
    || !startedAt
    || !taskType
    || !knowledgeStage
    || value.userApproved !== true
  ) return null;

  return {
    id,
    variable,
    variantA,
    variantB,
    startedAt,
    taskType,
    knowledgeStage,
    minimumSessionsPerVariant: boundedInteger(value.minimumSessionsPerVariant, 2, 10, 2),
    userApproved: true,
    nextVariant: value.nextVariant === "b" ? "b" : "a",
    observations: sanitizeExperimentObservations(value.observations),
  };
}

function sanitizeExperimentHistory(value: unknown): PersonalizationExperimentHistoryItem[] {
  if (!Array.isArray(value)) return [];
  return value.slice(-12).flatMap((item) => {
    if (!isRecord(item)) return [];
    const id = boundedString(item.id, 120);
    const variable = typeof item.variable === "string" && EXPERIMENT_VARIABLES.has(item.variable)
      ? item.variable as PersonalizationExperimentVariable
      : null;
    const result = enumOr(item.result, ["promising_a", "promising_b", "mixed", "stopped"], null);
    const variantA = boundedString(item.variantA, 120);
    const variantB = boundedString(item.variantB, 120);
    const taskType = nullableBoundedString(item.taskType, 80);
    const knowledgeStage = nullableBoundedString(item.knowledgeStage, 80);
    const summary = boundedString(item.summary, 500);
    const completedAt = nullableIsoDate(item.completedAt);
    const sessionsA = boundedInteger(item.sessionsA, 0, 100, 0);
    const sessionsB = boundedInteger(item.sessionsB, 0, 100, 0);
    const checkedAnswers = boundedInteger(item.checkedAnswers, 0, 10_000, 0);
    const accuracyA = nullablePercentage(item.accuracyA);
    const accuracyB = nullablePercentage(item.accuracyB);
    const promising = result === "promising_a" || result === "promising_b";
    const supportedPromisingResult = !promising || (
      sessionsA >= 2
      && sessionsB >= 2
      && checkedAnswers >= 8
      && accuracyA !== null
      && accuracyB !== null
      && (result === "promising_a" ? accuracyA - accuracyB >= 15 : accuracyB - accuracyA >= 15)
    );
    return id
      && variable
      && variantA
      && variantB
      && variantA !== variantB
      && taskType
      && knowledgeStage
      && result
      && summary
      && completedAt
      && supportedPromisingResult
      ? [{
          id,
          variable,
          variantA,
          variantB,
          taskType,
          knowledgeStage,
          result,
          summary,
          sessionsA,
          sessionsB,
          checkedAnswers,
          accuracyA,
          accuracyB,
          completedAt,
        }]
      : [];
  });
}

function sanitizeExperimentObservations(value: unknown): PersonalizationExperimentObservation[] {
  if (!Array.isArray(value)) return [];
  const byCompletion = new Map<string, PersonalizationExperimentObservation>();
  for (const item of value.slice(-40)) {
    if (!isRecord(item)) continue;
    const completionId = boundedString(item.completionId, 120);
    const variant = item.variant === "a" || item.variant === "b" ? item.variant : null;
    const feedback = enumOr(item.feedback, ["too_easy", "about_right", "too_difficult"], null);
    const recordedAt = nullableIsoDate(item.recordedAt);
    const totalAnswers = boundedInteger(item.totalAnswers, 0, 1_000, -1);
    const correctAnswers = boundedInteger(item.correctAnswers, 0, Math.max(0, totalAnswers), -1);
    if (!completionId || !variant || !feedback || !recordedAt || totalAnswers < 0 || correctAnswers < 0) continue;
    byCompletion.set(completionId, {
      completionId,
      variant,
      correctAnswers,
      totalAnswers,
      feedback,
      recordedAt,
    });
  }
  return [...byCompletion.values()];
}

function sanitizeReceiptHistory(value: unknown): PersonalizationReceiptHistoryItem[] {
  if (!Array.isArray(value)) return [];
  const byKey = new Map<string, PersonalizationReceiptHistoryItem>();
  for (const item of value.slice(-24)) {
    if (!isRecord(item)) continue;
    const key = boundedString(item.key, 160);
    const shownAt = nullableIsoDate(item.shownAt);
    if (key && shownAt) byKey.set(key, { key, shownAt });
  }
  return [...byKey.values()];
}

function sanitizeChangeHistory(value: unknown): PersonalizationChangeHistoryItem[] {
  if (!Array.isArray(value)) return [];
  const byId = new Map<string, PersonalizationChangeHistoryItem>();
  for (const item of value.slice(-24)) {
    if (!isRecord(item)) continue;
    const id = boundedString(item.id, 160);
    const area = enumOr(item.area, ["workspace", "control"], null);
    const setting = boundedString(item.setting, 80);
    const previousValue = boundedString(item.previousValue, 120);
    const nextValue = boundedString(item.nextValue, 120);
    const title = boundedString(item.title, 160);
    const reason = boundedString(item.reason, 300);
    const occurredAt = nullableIsoDate(item.occurredAt);
    if (!id || !area || !setting || !previousValue || !nextValue || !title || !reason || !occurredAt) continue;
    byId.set(id, {
      id,
      area,
      setting,
      previousValue,
      nextValue,
      title,
      reason,
      occurredAt,
      undoneAt: nullableIsoDate(item.undoneAt),
    });
  }
  return [...byId.values()];
}

function sanitizeWeeklyReviewHistory(value: unknown): PersonalizationWeeklyReviewHistoryItem[] {
  if (!Array.isArray(value)) return [];
  const byKey = new Map<string, PersonalizationWeeklyReviewHistoryItem>();
  for (const item of value.slice(-12)) {
    if (!isRecord(item)) continue;
    const key = boundedString(item.key, 80);
    const reviewedAt = nullableIsoDate(item.reviewedAt);
    if (key && reviewedAt) byKey.set(key, { key, reviewedAt });
  }
  return [...byKey.values()];
}

function appendChange(
  history: PersonalizationChangeHistoryItem[],
  item: PersonalizationChangeHistoryItem,
) {
  return [...history, item].slice(-24);
}

function workspaceChangeTitle<K extends keyof PersonalizationWorkspaceSettings>(
  key: K,
  value: PersonalizationWorkspaceSettings[K],
) {
  const names: Record<keyof PersonalizationWorkspaceSettings, string> = {
    layout: "Session path",
    textDensity: "Text amount",
    motion: "Motion",
    visualStructure: "Visual emphasis",
    checkIns: "Progress emphasis",
  };
  return `${names[key]} changed to ${String(value).replaceAll("_", " ")}`;
}

function controlTitle(key: keyof PersonalizationControls) {
  const names: Record<keyof PersonalizationControls, string> = {
    selfReport: "Use what I tell YOVA",
    behavior: "Behavior-based suggestions",
    timing: "Timing suggestions",
    experiments: "Personal tests",
    optionalQuestions: "Optional questions",
    receipts: "Personalization proof",
  };
  return names[key];
}

function isWorkspaceSetting(value: string): value is keyof PersonalizationWorkspaceSettings {
  return ["layout", "textDensity", "motion", "visualStructure", "checkIns"].includes(value);
}

function isControlSetting(value: string): value is keyof PersonalizationControls {
  return ["selfReport", "behavior", "timing", "experiments", "optionalQuestions", "receipts"].includes(value);
}

function workspaceSettingValue<K extends keyof PersonalizationWorkspaceSettings>(
  key: K,
  value: string,
): PersonalizationWorkspaceSettings[K] | null {
  const allowed: { [P in keyof PersonalizationWorkspaceSettings]: readonly PersonalizationWorkspaceSettings[P][] } = {
    layout: ["automatic", "one_step", "full_path"],
    textDensity: ["automatic", "standard", "reduced"],
    motion: ["automatic", "standard", "reduced"],
    visualStructure: ["automatic", "standard", "more"],
    checkIns: ["automatic", "standard", "more"],
  };
  return (allowed[key] as readonly string[]).includes(value)
    ? value as PersonalizationWorkspaceSettings[K]
    : null;
}

function replayWorkspaceSetting<K extends keyof PersonalizationWorkspaceSettings>(
  history: PersonalizationChangeHistoryItem[],
  setting: K,
): PersonalizationWorkspaceSettings[K] | null {
  const relevant = history.filter((item) => (
    item.area === "workspace" && item.setting === setting
  ));
  const first = relevant[0];
  if (!first) return null;
  let value = workspaceSettingValue(setting, first.previousValue);
  if (value === null) return null;
  for (const item of relevant) {
    if (item.undoneAt) continue;
    const next = workspaceSettingValue(setting, item.nextValue);
    if (next !== null) value = next;
  }
  return value;
}

function replayControlSetting(
  history: PersonalizationChangeHistoryItem[],
  setting: keyof PersonalizationControls,
): boolean | null {
  const relevant = history.filter((item) => (
    item.area === "control" && item.setting === setting
  ));
  const first = relevant[0];
  if (!first || (first.previousValue !== "true" && first.previousValue !== "false")) return null;
  let value = first.previousValue === "true";
  for (const item of relevant) {
    if (item.undoneAt || (item.nextValue !== "true" && item.nextValue !== "false")) continue;
    value = item.nextValue === "true";
  }
  return value;
}

function moveExperimentToHistory(
  state: PersonalizationState,
  active: ActivePersonalizationExperiment,
  evaluation: PersonalizationExperimentEvaluation,
  result: PersonalizationExperimentHistoryItem["result"],
  completedAt: string,
) {
  const safeCompletedAt = nullableIsoDate(completedAt);
  if (!safeCompletedAt) return state;
  const historyItem: PersonalizationExperimentHistoryItem = {
    id: active.id,
    variable: active.variable,
    variantA: active.variantA,
    variantB: active.variantB,
    taskType: active.taskType,
    knowledgeStage: active.knowledgeStage,
    result,
    summary: result === "stopped" ? "You stopped this personal test before YOVA chose an option." : evaluation.summary,
    sessionsA: evaluation.sessionsA,
    sessionsB: evaluation.sessionsB,
    checkedAnswers: evaluation.checkedAnswers,
    accuracyA: evaluation.accuracyA,
    accuracyB: evaluation.accuracyB,
    completedAt: safeCompletedAt,
  };
  return normalizePersonalizationState({
    ...state,
    activeExperiment: null,
    experimentHistory: [...state.experimentHistory, historyItem],
  });
}

/**
 * Keeps the state within the single-field storage budget without allowing a
 * long display history to block a current preference save. Old receipts and
 * audit summaries go first. If malformed data still cannot fit, optional
 * experiments and old non-blocking corrections are discarded before a final
 * fail-closed fallback disables inferred personalization.
 */
function compactPersonalizationState(state: PersonalizationState): PersonalizationState {
  let next: PersonalizationState = {
    ...state,
    pausedSignalIds: [...state.pausedSignalIds],
    excludedEvidenceRefs: [...state.excludedEvidenceRefs],
    corrections: [...state.corrections],
    experimentHistory: [...state.experimentHistory],
    receiptHistory: [...state.receiptHistory],
    changeHistory: [...state.changeHistory],
    weeklyReviewHistory: [...state.weeklyReviewHistory],
  };
  const fits = () => JSON.stringify(next).length <= PERSONALIZATION_STATE_MAX_LENGTH;
  if (fits()) return next;

  const trimOldest = (key: "receiptHistory" | "weeklyReviewHistory" | "changeHistory" | "experimentHistory") => {
    while (next[key].length && !fits()) {
      next = { ...next, [key]: next[key].slice(1) };
    }
  };
  trimOldest("receiptHistory");
  trimOldest("weeklyReviewHistory");
  trimOldest("changeHistory");
  trimOldest("experimentHistory");
  if (fits()) return next;

  next = {
    ...next,
    corrections: next.corrections.map((item) => ({
      ...item,
      correctedValue: item.correctedValue?.slice(0, 120) ?? null,
      note: item.note?.slice(0, 160) ?? null,
    })),
  };
  while (!fits()) {
    const removable = next.corrections.findIndex((item) => !item.doNotInfer);
    if (removable < 0) break;
    next = {
      ...next,
      corrections: next.corrections.filter((_, index) => index !== removable),
    };
  }
  if (fits()) return next;

  const protectedSignalIds = next.corrections.flatMap((item) => (
    item.doNotInfer ? [item.signalId] : []
  ));
  const combinedPausedSignalIds = [...new Set([
    ...next.pausedSignalIds,
    ...protectedSignalIds,
  ])];
  if (combinedPausedSignalIds.length > 50) {
    return failClosedCompactedState(next);
  }
  next = {
    ...next,
    pausedSignalIds: combinedPausedSignalIds,
    corrections: [],
  };
  if (fits()) return next;

  next = { ...next, activeExperiment: null };
  if (fits()) return next;

  return failClosedCompactedState(next);
}

function failClosedCompactedState(state: PersonalizationState): PersonalizationState {
  return {
    ...state,
    controls: {
      ...state.controls,
      selfReport: false,
      behavior: false,
      timing: false,
      experiments: false,
    },
    pausedSignalIds: [],
    corrections: [],
    activeExperiment: null,
  };
}

function personalizationExperimentResultAllowsInference(
  state: PersonalizationState,
  experimentId: string,
) {
  const signalId = `experiment:${experimentId}`;
  if (state.pausedSignalIds.includes(signalId)) return false;
  return !state.corrections.some((item) => (
    item.signalId === signalId && item.doNotInfer
  ));
}

function emptyExperimentEvaluation(): PersonalizationExperimentEvaluation {
  return {
    ready: false,
    sessionsA: 0,
    sessionsB: 0,
    checkedAnswers: 0,
    accuracyA: null,
    accuracyB: null,
    difficultA: 0,
    difficultB: 0,
    result: null,
    summary: "No personal test is active.",
  };
}

function experimentAccuracy(observations: PersonalizationExperimentObservation[]) {
  const total = observations.reduce((sum, item) => sum + item.totalAnswers, 0);
  if (total === 0) return null;
  const correct = observations.reduce((sum, item) => (
    sum + Math.min(item.correctAnswers, item.totalAnswers)
  ), 0);
  return Math.round((correct / total) * 100);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function booleanOr(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function enumOr<T extends string>(value: unknown, values: readonly T[], fallback: T): T;
function enumOr<T extends string>(value: unknown, values: readonly T[], fallback: null): T | null;
function enumOr<T extends string>(value: unknown, values: readonly T[], fallback: T | null) {
  return typeof value === "string" && values.includes(value as T) ? value as T : fallback;
}

function boundedString(value: unknown, maximum: number) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function nullableBoundedString(value: unknown, maximum: number) {
  return boundedString(value, maximum) || null;
}

function nullableIsoDate(value: unknown) {
  if (typeof value !== "string" || !value.trim() || Number.isNaN(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

function boundedInteger(value: unknown, minimum: number, maximum: number, fallback: number) {
  return typeof value === "number" && Number.isInteger(value)
    ? Math.max(minimum, Math.min(maximum, value))
    : fallback;
}

function nullablePercentage(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(100, Math.round(value)))
    : null;
}

function uniqueBoundedStrings(value: unknown, maximumItems: number, maximumLength: number) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.flatMap((item) => {
    const bounded = boundedString(item, maximumLength);
    return bounded ? [bounded] : [];
  }))].slice(-maximumItems);
}
