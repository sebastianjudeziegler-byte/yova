import type {
  LearningPlan,
  SessionCompletion,
  SessionInterruption,
} from "@/lib/domain";
import {
  CORE_METHOD_IDS,
  type CoreMethodId,
} from "@/lib/learning/method-catalog";
import { methodIdFromText } from "@/lib/learning/method-router";
import { onboardingAnswerId } from "@/lib/sample-data";
import {
  deepProfileAnswerId,
  deepProfileAnswerLabel,
} from "@/lib/personalization/learner-profile";
import type { PersonalizationDecisionSetting } from "@/lib/personalization/personalization-decision";
import {
  STUDY_PROFILE_DIMENSION_NAMES,
  STUDY_PROFILE_USER_FACING_LABELS,
} from "@/lib/study-profile/config";
import { STUDY_PROFILE_QUESTIONS } from "@/lib/study-profile/questions";
import { classifyStudyProfileScore } from "@/lib/study-profile/scoring";
import type {
  StudyProfileCalibrationDirection,
  StudyProfileDimension,
  StudyProfileQuestion,
} from "@/lib/study-profile/types";
import {
  type PersonalizationReceiptHistoryItem,
  type ActivePersonalizationExperiment,
  type PersonalizationExperimentHistoryItem,
  type PersonalizationState,
  readPersonalizationStateFromAnswers,
} from "@/lib/personalization/personalization-state";

export const PERSONALIZATION_EVIDENCE_LABELS = [
  "You told YOVA",
  "Seen once",
  "Repeated pattern",
  "Self-report and behavior agree",
  "Tested and promising",
  "Mixed evidence",
  "Paused by you",
] as const;

export type PersonalizationEvidenceLabel =
  (typeof PERSONALIZATION_EVIDENCE_LABELS)[number];

export type PersonalizationSignalKey =
  | StudyProfileDimension
  | "processing_entry"
  | "memory_breakdown"
  | "repair_preference"
  | "workspace_preference"
  | "workspace_settings"
  | "energy_window"
  | "experiment_result";

export type LearnerPersonalizationSignal = {
  id: string;
  key: PersonalizationSignalKey;
  title: string;
  value: string;
  code: string;
  explanation: string;
  evidenceLabel: PersonalizationEvidenceLabel;
  evidenceCount: number;
  source: "self_report" | "observation" | "blended" | "correction" | "experiment";
  evidenceRefs: string[];
  paused: boolean;
};

export type PersonalizationArtifact =
  | "method_tie"
  | "method_delivery"
  | "session_opening"
  | "workspace"
  | "support"
  | "schedule"
  | "recovery";

export type PersonalizationDecision = {
  id: string;
  artifact: PersonalizationArtifact;
  setting: PersonalizationDecisionSetting;
  value: string;
  title: string;
  explanation: string;
  signalIds: string[];
  evidenceLabel: PersonalizationEvidenceLabel;
  methodCandidates: CoreMethodId[];
  experimental: boolean;
};

export type PersonalizationWeeklyReview = {
  key: string;
  ready: boolean;
  periodStart: string;
  periodEnd: string;
  completedSessions: number;
  interruptedSessions: number;
  studiedMinutes: number;
  accuracyPercent: number | null;
  evidenceHighlights: string[];
  activeChanges: string[];
  nextSuggestion: string | null;
};

export type PersonalizationResolution = {
  state: PersonalizationState;
  signals: LearnerPersonalizationSignal[];
  decisions: PersonalizationDecision[];
  weeklyReview: PersonalizationWeeklyReview;
};

export type PersonalizedMethodTieResolution = {
  state: {
    controls: { experiments: boolean };
    activeExperiment: Pick<
      ActivePersonalizationExperiment,
      "id" | "variable" | "variantA" | "variantB" | "nextVariant" | "taskType" | "knowledgeStage"
    > | null;
    experimentHistory: readonly Pick<
      PersonalizationExperimentHistoryItem,
      "id" | "variable" | "variantA" | "variantB" | "result" | "taskType" | "knowledgeStage"
    >[];
  };
  signals: readonly Pick<
    LearnerPersonalizationSignal,
    "id" | "key" | "title" | "code" | "evidenceLabel" | "paused"
  >[];
};

export type OptionalPersonalizationQuestion = {
  question: StudyProfileQuestion;
  reason: string;
  changes: string;
};

type Candidate = {
  key: PersonalizationSignalKey;
  title: string;
  value: string;
  code: string;
  explanation: string;
  count: number;
  refs: string[];
};

const CORE_METHOD_SET = new Set<string>(CORE_METHOD_IDS);
const RECEIPT_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1_000;

export function resolveLearnerPersonalization({
  answers,
  completions,
  interruptions,
  plans,
  now = new Date(),
  timeZone = "UTC",
}: {
  answers: readonly string[];
  completions: readonly SessionCompletion[];
  interruptions: readonly SessionInterruption[];
  plans: readonly LearningPlan[];
  now?: Date;
  timeZone?: string;
}): PersonalizationResolution {
  const state = readPersonalizationStateFromAnswers(answers);
  const selfReports = state.controls.selfReport
    ? buildSelfReportCandidates(answers, state)
    : new Map<PersonalizationSignalKey, Candidate>();
  const observations = state.controls.behavior
    ? buildObservationCandidates(completions, interruptions, plans, state, timeZone)
    : new Map<PersonalizationSignalKey, Candidate>();
  const signals = mergeCandidates(selfReports, observations, state);
  signals.push(...experimentSignals(state));
  const correctedSignals = signals.map((signal) => applySignalControl(signal, state));
  const decisions = buildPersonalizationDecisions(correctedSignals, state);

  return {
    state,
    signals: correctedSignals,
    decisions,
    weeklyReview: buildPersonalizationWeeklyReview({
      state,
      signals: correctedSignals,
      decisions,
      completions,
      interruptions,
      now,
    }),
  };
}

/**
 * Learner evidence may break a tie only after the task router supplies the
 * valid methods. This helper can never return a method outside that list.
 */
export function selectPersonalizedMethodTie(
  validMethodIds: readonly CoreMethodId[],
  resolution: PersonalizedMethodTieResolution,
  comparison?: { taskType: string; knowledgeStage: string },
): PersonalizationDecision | null {
  const valid = [...new Set(validMethodIds)];
  if (valid.length < 2) return null;

  const experiment = resolution.state.activeExperiment;
  if (
    resolution.state.controls.experiments
    && experiment?.variable === "method_tie"
    && isCoreMethodId(experiment.variantA)
    && isCoreMethodId(experiment.variantB)
    && valid.includes(experiment.variantA)
    && valid.includes(experiment.variantB)
    && experimentMatchesComparison(experiment, comparison)
  ) {
    const methodId = experiment.nextVariant === "a" ? experiment.variantA : experiment.variantB;
    return methodTieDecision(
      methodId,
      `YOVA is testing ${methodId.replaceAll("_", " ")} as one of two task-valid options.`,
      `experiment:${experiment.id}`,
      "You told YOVA",
      true,
    );
  }

  const tested = resolution.state.controls.experiments
    ? [...resolution.state.experimentHistory].reverse().find((item) => (
      item.variable === "method_tie"
      && (item.result === "promising_a" || item.result === "promising_b")
      && experimentMatchesComparison(item, comparison)
      && resolution.signals.some((signal) => (
        signal.id === `experiment:${item.id}` && signalCanCreateDecision(signal)
      ))
    ))
    : undefined;
  if (tested) {
    const winner = tested.result === "promising_a" ? tested.variantA : tested.variantB;
    if (isCoreMethodId(winner) && valid.includes(winner)) {
      return methodTieDecision(
        winner,
        `${winner.replaceAll("_", " ")} is promising from a completed personal test between task-valid methods.`,
        `experiment:${tested.id}`,
        "Tested and promising",
        false,
      );
    }
  }

  const preferenceOrder = methodPreferenceOrder(resolution.signals);
  const selected = preferenceOrder.find((methodId) => valid.includes(methodId));
  if (!selected) return null;
  const signal = resolution.signals.find((item) => methodPreferenceOrder([item]).includes(selected));
  if (!signal || !signalCanCreateDecision(signal)) return null;
  return methodTieDecision(
    selected,
    `Both methods fit the task. ${selected.replaceAll("_", " ")} better matches the current ${signal.title.toLowerCase()} signal.`,
    signal.id,
    signal.evidenceLabel,
    false,
  );
}

function experimentMatchesComparison(
  experiment: { taskType: string | null; knowledgeStage: string | null },
  comparison: { taskType: string; knowledgeStage: string } | undefined,
) {
  return Boolean(
    comparison
    && experiment.taskType === comparison.taskType
    && experiment.knowledgeStage === comparison.knowledgeStage,
  );
}

export function selectNextOptionalPersonalizationQuestion(
  state: PersonalizationState,
  signals: readonly LearnerPersonalizationSignal[],
): OptionalPersonalizationQuestion | null {
  if (!state.controls.selfReport || !state.controls.optionalQuestions) return null;
  const unanswered = STUDY_PROFILE_QUESTIONS.filter((question) => !state.studyProfile.answers[question.id]);
  if (!unanswered.length) return null;

  const partialDimension = unanswered.find((question) => STUDY_PROFILE_QUESTIONS.some((candidate) => (
    candidate.dimension === question.dimension
    && candidate.id !== question.id
    && Boolean(state.studyProfile.answers[candidate.id])
  )));
  const observedKeys = signals
    .filter((signal) => signal.source === "observation" || signal.source === "blended")
    .map((signal) => signal.key);
  const relevant = unanswered.find((question) => observedKeys.includes(question.dimension));
  const question = partialDimension ?? relevant ?? unanswered[0];
  return {
    question,
    reason: questionReason(question.dimension),
    changes: questionChange(question.dimension),
  };
}

export function selectPersonalizationReceipt({
  state,
  decisions,
  now = new Date(),
}: {
  state: PersonalizationState;
  decisions: readonly PersonalizationDecision[];
  now?: Date;
}): PersonalizationDecision | null {
  if (!state.controls.receipts) return null;
  const mostRecent = state.receiptHistory.reduce<number | null>((latest, item) => {
    const time = Date.parse(item.shownAt);
    return Number.isNaN(time) ? latest : latest === null ? time : Math.max(latest, time);
  }, null);
  if (mostRecent !== null && now.getTime() - mostRecent < RECEIPT_COOLDOWN_MS) return null;

  const shown = new Set(state.receiptHistory.map((item) => item.key));
  return decisions
    .filter((decision) => (
      decision.evidenceLabel === "Repeated pattern"
      || decision.evidenceLabel === "Self-report and behavior agree"
      || decision.evidenceLabel === "Tested and promising"
    ))
    .filter((decision) => !shown.has(receiptKey(decision)))
    .sort((left, right) => receiptPriority(right.evidenceLabel) - receiptPriority(left.evidenceLabel))[0]
    ?? null;
}

export function recordPersonalizationReceipt(
  state: PersonalizationState,
  decision: PersonalizationDecision,
  shownAt: string,
): PersonalizationState {
  if (Number.isNaN(Date.parse(shownAt))) return state;
  const item: PersonalizationReceiptHistoryItem = {
    key: receiptKey(decision),
    shownAt: new Date(shownAt).toISOString(),
  };
  return {
    ...state,
    receiptHistory: [
      ...state.receiptHistory.filter((current) => current.key !== item.key),
      item,
    ].slice(-24),
  };
}

export function buildPersonalizationWeeklyReview({
  state,
  signals,
  decisions,
  completions,
  interruptions,
  now = new Date(),
}: {
  state: PersonalizationState;
  signals: readonly LearnerPersonalizationSignal[];
  decisions: readonly PersonalizationDecision[];
  completions: readonly SessionCompletion[];
  interruptions: readonly SessionInterruption[];
  now?: Date;
}): PersonalizationWeeklyReview {
  const currentWeekStart = utcMondayStart(now);
  const periodEnd = currentWeekStart;
  const periodStart = periodEnd - 7 * 24 * 60 * 60 * 1_000;
  const reviewKey = `week:${new Date(periodStart).toISOString().slice(0, 10)}`;
  const recentCompletions = completions.filter((item) => inPeriod(item.completedAt, periodStart, periodEnd));
  const recentInterruptions = interruptions.filter((item) => inPeriod(item.interruptedAt, periodStart, periodEnd));
  const totalAnswers = recentCompletions.reduce((sum, item) => sum + item.totalAnswers, 0);
  const correctAnswers = recentCompletions.reduce((sum, item) => (
    sum + Math.min(item.correctAnswers, item.totalAnswers)
  ), 0);
  const usefulSignals = signals.filter((signal) => (
    !signal.paused
    && signal.evidenceLabel !== "You told YOVA"
    && signal.evidenceLabel !== "Seen once"
  ));
  const activeDecisions = decisions.filter((decision) => (
    personalizationDecisionHasVisibleArtifact(decision, signals)
  )).slice(0, 3);
  const nextSuggestion = decisions.find((decision) => (
    !personalizationDecisionHasVisibleArtifact(decision, signals)
  ));

  return {
    key: reviewKey,
    ready: recentCompletions.length + recentInterruptions.length >= 2
      && !state.weeklyReviewHistory.some((item) => item.key === reviewKey),
    periodStart: new Date(periodStart).toISOString(),
    periodEnd: new Date(periodEnd).toISOString(),
    completedSessions: recentCompletions.length,
    interruptedSessions: recentInterruptions.length,
    studiedMinutes: recentCompletions.reduce((sum, item) => sum + item.actualMinutes, 0),
    accuracyPercent: totalAnswers ? Math.round((correctAnswers / totalAnswers) * 100) : null,
    evidenceHighlights: usefulSignals.slice(0, 3).map((signal) => (
      `${signal.title}: ${signal.value} (${signal.evidenceLabel.toLowerCase()}).`
    )),
    activeChanges: activeDecisions.map((decision) => decision.title),
    nextSuggestion: nextSuggestion?.explanation ?? null,
  };
}

function utcMondayStart(now: Date) {
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const day = new Date(start).getUTCDay();
  return start - ((day + 6) % 7) * 24 * 60 * 60 * 1_000;
}

function personalizationDecisionHasVisibleArtifact(
  decision: PersonalizationDecision,
  signals: readonly LearnerPersonalizationSignal[],
) {
  if (decision.experimental) return false;
  const signal = signals.find((candidate) => decision.signalIds.includes(candidate.id));
  if (!signal || signal.paused || signal.source === "observation") return false;
  if (decision.setting === "path_visibility") return decision.value === "one_step";
  if (decision.setting === "knowledge_check") return decision.value === "closed_note_first";
  return [
    "first_action",
    "block_length",
    "presentation",
    "retention",
    "first_repair",
    "layout",
    "text_density",
    "motion",
    "visual_structure",
    "check_ins",
  ].includes(decision.setting);
}

function buildSelfReportCandidates(
  answers: readonly string[],
  state: PersonalizationState,
) {
  const candidates = studyProfileCandidates(state);
  addLegacyDimensionCandidates(candidates, answers);
  addDirectCandidate(candidates, "processing_entry", "How teaching begins", answers[10], 10);
  addDirectCandidate(candidates, "memory_breakdown", "What YOVA checks for", answers[11], 11);
  addDirectCandidate(candidates, "repair_preference", "First help after a miss", answers[12], 12);
  addDirectCandidate(candidates, "workspace_preference", "Preferred session view", answers[13], 13);

  const workspaceParts = [
    state.workspace.layout !== "automatic" ? state.workspace.layout.replaceAll("_", " ") : null,
    state.workspace.textDensity === "reduced" ? "less text" : null,
    state.workspace.motion === "reduced" ? "reduced motion" : null,
    state.workspace.visualStructure === "more" ? "more visual structure" : null,
    state.workspace.checkIns === "more" ? "more check-ins" : null,
  ].filter((value): value is string => Boolean(value));
  if (workspaceParts.length) {
    candidates.set("workspace_settings", {
      key: "workspace_settings",
      title: "Workspace settings",
      value: workspaceParts.join(", "),
      code: workspaceParts.join("|"),
      explanation: "These are interface choices you made directly.",
      count: 1,
      refs: ["workspace settings"],
    });
  }
  return candidates;
}

function studyProfileCandidates(state: PersonalizationState) {
  const candidates = new Map<PersonalizationSignalKey, Candidate>();
  const byDimension = new Map<StudyProfileDimension, typeof STUDY_PROFILE_QUESTIONS[number][]>();
  for (const question of STUDY_PROFILE_QUESTIONS) {
    const list = byDimension.get(question.dimension) ?? [];
    list.push(question);
    byDimension.set(question.dimension, list);
  }

  for (const [dimension, questions] of byDimension) {
    if (!questions.every((question) => Boolean(state.studyProfile.answers[question.id]))) continue;
    const rawScore = questions.reduce((sum, question) => {
      const answer = state.studyProfile.answers[question.id];
      return sum + (question.options.find((option) => option.id === answer)?.score ?? 0);
    }, 0);
    const classification = classifyStudyProfileScore(rawScore);
    const calibrationDirection = dimension === "calibration_risk"
      ? partialCalibrationDirection(state)
      : null;
    const code = calibrationDirection ?? classification;
    const value = dimension === "calibration_risk" && calibrationDirection
      ? calibrationLabel(calibrationDirection)
      : STUDY_PROFILE_USER_FACING_LABELS[dimension][classification];
    candidates.set(dimension, {
      key: dimension,
      title: STUDY_PROFILE_DIMENSION_NAMES[dimension],
      value,
      code,
      explanation: `Two optional Study Profile answers currently suggest ${value.toLowerCase()}.`,
      count: questions.length,
      refs: questions.map((question) => `Study Profile ${question.id}`),
    });
  }
  return candidates;
}

function addLegacyDimensionCandidates(
  candidates: Map<PersonalizationSignalKey, Candidate>,
  answers: readonly string[],
) {
  const blocker = onboardingAnswerId(0, answers[0]);
  const starting = onboardingAnswerId(5, answers[5]);
  const startingFrictionIsHigh = blocker === "struggle_to_start"
    || blocker === "unclear_first_step"
    || blocker === "overwhelmed"
    || starting === "often_delay"
    || starting === "deadline_pressure"
    || starting === "planning_avoidance";
  if (!candidates.has("starting_friction") && startingFrictionIsHigh) {
    candidates.set("starting_friction", selfCandidate("starting_friction", "Starting Friction", "Higher starting friction", "high", ["onboarding blocker", "starting pattern"]));
  }
  const guidance = onboardingAnswerId(1, answers[1]);
  if (
    !candidates.has("structure_need")
    && (
      blocker === "unclear_first_step"
      || guidance === "exact_guidance"
      || guidance === "structured_flexibility"
    )
  ) {
    const high = blocker === "unclear_first_step" || guidance === "exact_guidance";
    candidates.set("structure_need", selfCandidate("structure_need", "Structure Need", high ? "High-structure" : "Balanced", high ? "high" : "moderate", ["onboarding guidance"]));
  }
  const focus = onboardingAnswerId(4, answers[4]);
  if (!candidates.has("attention_variability") && focus) {
    const code = focus === "often" || focus === "very_often"
      ? "high"
      : focus === "sometimes" ? "moderate" : "low";
    candidates.set("attention_variability", selfCandidate("attention_variability", "Attention Variability", code === "high" ? "Highly variable" : code === "moderate" ? "Variable" : "Steady", code, ["onboarding focus answer"]));
  }
  if (!candidates.has("mistake_sensitivity") && blocker === "perfectionism") {
    candidates.set("mistake_sensitivity", selfCandidate("mistake_sensitivity", "Mistake Sensitivity", "Higher mistake sensitivity", "high", ["onboarding blocker"]));
  }
}

function buildObservationCandidates(
  completions: readonly SessionCompletion[],
  interruptions: readonly SessionInterruption[],
  plans: readonly LearningPlan[],
  state: PersonalizationState,
  timeZone: string,
) {
  const candidates = new Map<PersonalizationSignalKey, Candidate>();
  const knownSessionIds = new Set(plans.flatMap((plan) => (
    plan.sessions.map((session) => session.id)
  )));
  const behaviorInterruptions = interruptions.filter((item) => (
    !state.excludedEvidenceRefs.includes(item.id)
  ));
  const comparableCompletions = knownSessionIds.size
    ? completions.filter((item) => knownSessionIds.has(item.planSessionId))
    : completions;
  const comparableInterruptions = knownSessionIds.size
    ? behaviorInterruptions.filter((item) => knownSessionIds.has(item.planSessionId))
    : behaviorInterruptions;
  const early = [...comparableInterruptions]
    .sort((left, right) => right.interruptedAt.localeCompare(left.interruptedAt))
    .slice(0, 6)
    .filter(isEarlyInterruption);
  if (early.length) {
    candidates.set("starting_friction", {
      key: "starting_friction",
      title: "Starting and continuation",
      value: early.length === 1 ? "One session ended early" : `${early.length} recent sessions ended early`,
      code: "high",
      explanation: "YOVA can try a smaller opening, but it should not treat an interruption as proof about ability.",
      count: early.length,
      refs: early.map((item) => item.id),
    });
  }

  const confidence = comparableCompletions.flatMap((completion) => completion.confidenceEvidence.map((evidence) => ({
    completionId: completion.id,
    ...evidence,
  })));
  const confidentMisses = confidence.filter((item) => item.confidence === "very_sure" && !item.correct);
  const unsureSuccesses = confidence.filter((item) => item.confidence !== "very_sure" && item.correct);
  if (confidentMisses.length || unsureSuccesses.length) {
    const code = confidentMisses.length && unsureSuccesses.length
      ? "mixed"
      : confidentMisses.length
        ? "overconfidence_risk"
        : "underconfidence_risk";
    const relevant = code === "mixed" ? [...confidentMisses, ...unsureSuccesses] : confidentMisses.length ? confidentMisses : unsureSuccesses;
    candidates.set("calibration_risk", {
      key: "calibration_risk",
      title: "Confidence Calibration",
      value: code === "mixed" ? "Confidence and results vary" : calibrationLabel(code),
      code,
      explanation: code === "overconfidence_risk"
        ? "Some confident answers were incorrect, so YOVA should use objective checks before more review."
        : code === "underconfidence_risk"
          ? "Some correct answers felt uncertain, so YOVA should keep successful retrieval visible."
          : "Confidence has been above and below demonstrated performance in different checks.",
      count: relevant.length,
      refs: [...new Set(relevant.map((item) => item.completionId))],
    });
  }

  if (state.controls.timing) {
    const energy = observedEnergyCandidate(comparableCompletions, timeZone);
    if (energy) candidates.set("energy_window", energy);
  }
  return candidates;
}

function observedEnergyCandidate(
  completions: readonly SessionCompletion[],
  timeZone: string,
): Candidate | null {
  const grouped = new Map<string, SessionCompletion[]>();
  for (const completion of completions) {
    if (completion.totalAnswers <= 0) continue;
    const window = studyWindow(completion.startedAt, timeZone);
    const list = grouped.get(window) ?? [];
    list.push(completion);
    grouped.set(window, list);
  }
  const comparable = [...grouped.entries()].filter(([, items]) => items.length >= 2);
  if (comparable.length < 2) return null;
  const ranked = comparable.map(([window, items]) => ({
    window,
    items,
    accuracy: answerAccuracy(items),
  })).sort((left, right) => right.accuracy - left.accuracy || left.window.localeCompare(right.window));
  const first = ranked[0];
  const second = ranked[1];
  const count = ranked.reduce((sum, item) => sum + item.items.length, 0);
  const mixed = first.accuracy - second.accuracy < 10;
  return {
    key: "energy_window",
    title: "Observed study window",
    value: mixed ? "Results are similar across time windows" : `${windowLabel(first.window)} is currently stronger`,
    code: mixed ? "mixed" : first.window,
    explanation: mixed
      ? `YOVA compared ${ranked.length} time windows and does not have a clear timing recommendation yet.`
      : `${windowLabel(first.window)} checks are at least 10 points stronger than the next comparable window. YOVA should recommend this time, not move sessions automatically.`,
    count,
    refs: ranked.flatMap((item) => item.items.map((completion) => completion.id)),
  };
}

function mergeCandidates(
  selfReports: Map<PersonalizationSignalKey, Candidate>,
  observations: Map<PersonalizationSignalKey, Candidate>,
  state: PersonalizationState,
) {
  const keys = [...new Set([...selfReports.keys(), ...observations.keys()])];
  return keys.map((key): LearnerPersonalizationSignal => {
    const self = selfReports.get(key);
    const observed = observations.get(key);
    const agrees = self && observed ? candidatesAgree(self, observed) : false;
    const evidenceLabel: PersonalizationEvidenceLabel = self && observed
      ? agrees ? "Self-report and behavior agree" : "Mixed evidence"
      : observed
        ? observed.code === "mixed" ? "Mixed evidence" : observed.count >= 2 ? "Repeated pattern" : "Seen once"
        : "You told YOVA";
    const selected = observed && (!self || agrees) ? observed : self ?? observed;
    if (!selected) throw new Error(`Personalization signal ${key} has no evidence.`);
    return {
      id: `signal:${key}`,
      key,
      title: selected.title,
      value: self && observed && !agrees ? `${self.value}; observed results differ` : selected.value,
      code: selected.code,
      explanation: self && observed
        ? agrees
          ? `${self.explanation} ${observed.explanation}`
          : `${self.explanation} ${observed.explanation} YOVA should keep testing instead of choosing a stronger setting.`
        : selected.explanation,
      evidenceLabel,
      evidenceCount: (self?.count ?? 0) + (observed?.count ?? 0),
      source: self && observed ? "blended" : observed ? "observation" : "self_report",
      evidenceRefs: [...new Set([...(self?.refs ?? []), ...(observed?.refs ?? [])])],
      paused: state.pausedSignalIds.includes(`signal:${key}`),
    };
  });
}

function experimentSignals(state: PersonalizationState): LearnerPersonalizationSignal[] {
  return state.experimentHistory.slice(-4).flatMap((experiment) => {
    if (experiment.result === "stopped") return [];
    const winner = experiment.result === "promising_a"
      ? experiment.variantA
      : experiment.result === "promising_b"
        ? experiment.variantB
        : null;
    return [{
      id: `experiment:${experiment.id}`,
      key: "experiment_result" as const,
      title: "Personal test",
      value: winner ? `${winner} is promising` : "The tested options were mixed",
      code: winner ?? "mixed",
      explanation: experiment.summary,
      evidenceLabel: winner ? "Tested and promising" as const : "Mixed evidence" as const,
      evidenceCount: experiment.sessionsA + experiment.sessionsB,
      source: "experiment" as const,
      evidenceRefs: [experiment.id],
      paused: state.pausedSignalIds.includes(`experiment:${experiment.id}`),
    }];
  });
}

function applySignalControl(
  signal: LearnerPersonalizationSignal,
  state: PersonalizationState,
): LearnerPersonalizationSignal {
  const correction = state.corrections.find((item) => item.signalId === signal.id);
  const paused = signal.paused || correction?.doNotInfer === true;
  if (paused) return { ...signal, paused: true, evidenceLabel: "Paused by you" };
  if (!correction) return signal;
  const correctedValue = correction.correctedValue?.trim() ?? "";
  const correctedCode = correctedValue
    ? correctedSignalCode(signal.key, correctedValue)
    : null;
  const supportedCorrection = correctedCode !== null;
  return {
    ...signal,
    value: supportedCorrection ? correctedValue : signal.value,
    code: correctedCode ?? signal.code,
    explanation: correction.note
      ? `You added this context: ${correction.note}${supportedCorrection ? "" : " YOVA will keep this signal unapplied until there is a concrete replacement or new evidence."}`
      : signal.explanation,
    evidenceLabel: supportedCorrection ? "You told YOVA" : "Mixed evidence",
    source: "correction",
  };
}

function buildPersonalizationDecisions(
  signals: readonly LearnerPersonalizationSignal[],
  state: PersonalizationState,
) {
  const decisions: PersonalizationDecision[] = [];
  for (const signal of signals) {
    if (!signalCanCreateDecision(signal)) continue;
    const code = signal.code;
    if (signal.key === "starting_friction" && code === "high") {
      decisions.push(decision(signal, "session_opening", "first_action", "small_active_start", "A smaller active start", "Begin with one concrete action that takes about two minutes, then expand without lowering the learning target."));
    }
    if (signal.key === "structure_need" && (code === "high" || code === "moderate")) {
      decisions.push(decision(signal, "workspace", "path_visibility", code === "high" ? "one_step" : "current_and_next", "A clearer path", "Choose the steps in advance and keep the current action obvious."));
    }
    if (signal.key === "attention_variability" && (code === "high" || code === "moderate")) {
      decisions.push(decision(signal, "method_delivery", "activity_cadence", "short_active_rounds", "Controlled activity changes", "Use short active rounds and change the activity only at planned checkpoints while keeping the same objective."));
    }
    if (signal.key === "calibration_risk" && code === "overconfidence_risk") {
      decisions.push(decision(signal, "method_delivery", "knowledge_check", "closed_note_first", "Check before more review", "Ask for a closed-note answer before showing more explanation or notes.", ["retrieval_practice", "practice_test_error_repair"]));
    } else if (signal.key === "calibration_risk" && code === "underconfidence_risk") {
      decisions.push(decision(signal, "method_delivery", "confidence_check", "show_success_evidence", "Keep successful recall visible", "Compare confidence with correct independent answers so doubt can update from evidence."));
    }
    if (signal.key === "mistake_sensitivity" && code === "high") {
      decisions.push(decision(signal, "support", "attempt_safety", "private_revisable_attempt", "A low-stakes first attempt", "Make the first answer private and revisable, then use feedback as information rather than a verdict."));
    }
    if (signal.key === "cognitive_stamina" && code === "high") {
      decisions.push(decision(signal, "method_delivery", "block_length", "shorter_rounds", "Shorter demanding rounds", "Use a bounded active round and offer a reset before quality drops."));
    }
    if (signal.key === "processing_entry") {
      const presentation = presentationSetting(code);
      if (presentation) decisions.push(decision(signal, "method_delivery", "presentation", presentation.value, presentation.title, presentation.explanation));
    }
    if (signal.key === "memory_breakdown") {
      const retention = retentionSetting(code);
      if (retention) decisions.push(decision(signal, "method_delivery", "retention", retention.value, retention.title, retention.explanation, retention.methods));
    }
    if (signal.key === "repair_preference") {
      const repair = repairSetting(code);
      if (repair) decisions.push(decision(signal, "support", "first_repair", repair.value, repair.title, repair.explanation));
    }
    if (signal.key === "workspace_preference") {
      const workspace = workspaceSetting(code);
      if (workspace) decisions.push(decision(signal, "workspace", "layout", workspace.value, workspace.title, workspace.explanation));
    }
    if (signal.key === "energy_window" && code !== "mixed") {
      decisions.push(decision(signal, "schedule", "recommended_window", code, "A stronger observed study window", "Recommend this window for demanding work, but do not move anything without approval."));
    }
  }

  for (const tested of state.experimentHistory.slice(-4)) {
    if (
      tested.variable !== "workspace"
      || !tested.taskType
      || !tested.knowledgeStage
      || (tested.result !== "promising_a" && tested.result !== "promising_b")
    ) continue;
    const signal = signals.find((item) => item.id === `experiment:${tested.id}`);
    if (!signal || !signalCanCreateDecision(signal)) continue;
    const winner = tested.result === "promising_a" ? tested.variantA : tested.variantB;
    if (winner !== "one_step" && winner !== "full_path") continue;
    decisions.push({
      id: `decision:experiment-result:${tested.id}`,
      artifact: "workspace",
      setting: "layout",
      value: winner,
      title: `${winner.replaceAll("_", " ")} is promising for similar sessions`,
      explanation: `YOVA will use this tested view for ${tested.taskType.replaceAll("_", " ")} work at the ${tested.knowledgeStage.replaceAll("_", " ")} stage while your workspace layout remains automatic. You can pause this result at any time.`,
      signalIds: [signal.id],
      evidenceLabel: "Tested and promising",
      methodCandidates: [],
      experimental: false,
    });
  }

  const workspaceSignal = signals.find((signal) => (
    signal.key === "workspace_settings" && signalCanCreateDecision(signal)
  ));
  if (workspaceSignal) {
    if (state.workspace.textDensity === "reduced") decisions.push(decision(workspaceSignal, "workspace", "text_density", "reduced", "Less text on screen", "Keep instructions concise and reveal extra detail on request."));
    if (state.workspace.motion === "reduced") decisions.push(decision(workspaceSignal, "workspace", "motion", "reduced", "Reduced motion", "Avoid non-essential animation and movement."));
    if (state.workspace.visualStructure === "more") decisions.push(decision(workspaceSignal, "workspace", "visual_structure", "more", "Stronger visual emphasis", "Increase contrast around the current section and important headings without changing the lesson."));
    if (state.workspace.checkIns === "more") decisions.push(decision(workspaceSignal, "workspace", "check_ins", "more", "A stronger progress marker", "Make the existing progress and current-step markers easier to notice without adding extra required work."));
  }

  const experiment = state.controls.experiments ? state.activeExperiment : null;
  if (experiment) {
    const value = experiment.nextVariant === "a" ? experiment.variantA : experiment.variantB;
    const artifact: PersonalizationArtifact = experiment.variable === "method_tie"
      ? "method_tie"
      : experiment.variable === "workspace" ? "workspace"
        : experiment.variable === "support" ? "support"
          : experiment.variable === "energy_window" ? "schedule"
            : experiment.variable === "first_action" ? "session_opening"
              : "method_delivery";
    decisions.push({
      id: `decision:experiment:${experiment.id}:${experiment.nextVariant}`,
      artifact,
      setting: canonicalExperimentSetting(experiment.variable),
      value,
      title: `Personal test: ${value}`,
      explanation: `YOVA is using ${value} for the next comparable session, then it will alternate and compare results cautiously.`,
      signalIds: [`experiment:${experiment.id}`],
      evidenceLabel: "You told YOVA",
      methodCandidates: isCoreMethodId(value) ? [value] : [],
      experimental: true,
    });
  }
  return deduplicateDecisions(decisions);
}

function decision(
  signal: LearnerPersonalizationSignal,
  artifact: PersonalizationArtifact,
  setting: PersonalizationDecisionSetting,
  value: string,
  title: string,
  explanation: string,
  methods: CoreMethodId[] = [],
): PersonalizationDecision {
  return {
    id: `decision:${artifact}:${setting}:${value}`,
    artifact,
    setting,
    value,
    title,
    explanation,
    signalIds: [signal.id],
    evidenceLabel: signal.evidenceLabel,
    methodCandidates: methods,
    experimental: false,
  };
}

function methodTieDecision(
  methodId: CoreMethodId,
  explanation: string,
  signalId: string,
  evidenceLabel: PersonalizationEvidenceLabel,
  experimental: boolean,
): PersonalizationDecision {
  return {
    id: `decision:method_tie:${methodId}`,
    artifact: "method_tie",
    setting: "method_id",
    value: methodId,
    title: `Use ${methodId.replaceAll("_", " ")} for this tie`,
    explanation,
    signalIds: [signalId],
    evidenceLabel,
    methodCandidates: [methodId],
    experimental,
  };
}

function methodPreferenceOrder(
  signals: readonly Pick<LearnerPersonalizationSignal, "key" | "code" | "paused">[],
): CoreMethodId[] {
  const memory = signals.find((signal) => (
    signal.key === "memory_breakdown" && !signal.paused
  ))?.code;
  const calibration = signals.find((signal) => (
    signal.key === "calibration_risk" && !signal.paused
  ))?.code;
  if (memory === "recognition_without_recall") return ["retrieval_practice", "spaced_retrieval"];
  if (memory === "delayed_forgetting") return ["spaced_retrieval", "retrieval_practice"];
  if (memory === "similar_idea_confusion") return ["interleaved_practice", "self_explanation"];
  if (memory === "application_gap") return ["worked_example_fading", "self_explanation", "practice_test_error_repair"];
  if (memory === "support_dependence") return ["worked_example_fading", "scaffolded_coding", "self_explanation"];
  if (calibration === "overconfidence_risk") return ["practice_test_error_repair", "retrieval_practice"];
  return [];
}

function presentationSetting(answerId: string) {
  if (answerId === "concrete_example") return { value: "example_first", title: "Example first", explanation: "Begin with one concrete case before naming the general rule." };
  if (answerId === "big_picture") return { value: "overview_first", title: "Big picture first", explanation: "Show the overall relationship before the details." };
  if (answerId === "small_steps") return { value: "step_by_step", title: "Step by step", explanation: "Show a short sequence, then fade the steps after an accurate attempt." };
  if (answerId === "try_first") return { value: "prediction_then_model", title: "Try, then model", explanation: "Use a brief low-stakes prediction before the full model when the task allows it." };
  if (answerId === "compare_similar") return { value: "compare_first", title: "Contrast first", explanation: "Place the target beside a plausible similar idea and name the difference." };
  return null;
}

function retentionSetting(answerId: string): { value: string; title: string; explanation: string; methods: CoreMethodId[] } | null {
  if (answerId === "recognition_without_recall") return { value: "retrieval", title: "Recall without cues", explanation: "Require an answer from memory before showing the source.", methods: ["retrieval_practice"] };
  if (answerId === "delayed_forgetting") return { value: "delayed_retrieval", title: "Return after a delay", explanation: "Schedule another unsupported retrieval after a delay.", methods: ["spaced_retrieval"] };
  if (answerId === "similar_idea_confusion") return { value: "discrimination", title: "Distinguish close ideas", explanation: "Add comparison checks that require choosing which concept applies.", methods: ["interleaved_practice"] };
  if (answerId === "application_gap") return { value: "transfer", title: "Apply in a new case", explanation: "Follow initial understanding with a different application.", methods: ["worked_example_fading", "self_explanation"] };
  if (answerId === "support_dependence") return { value: "fade_support", title: "Fade support", explanation: "Begin with enough guidance, then require an independent attempt.", methods: ["worked_example_fading", "scaffolded_coding"] };
  return null;
}

function repairSetting(answerId: string) {
  if (answerId === "hint_first") return { value: "hint_first", title: "Hint first", explanation: "Reveal one bounded cue before the complete correction." };
  if (answerId === "alternate_example") return { value: "alternate_example", title: "Another example", explanation: "Show a different case, then ask for a fresh attempt." };
  if (answerId === "direct_correction") return { value: "direct_correction", title: "Direct correction", explanation: "Name the exact incorrect relationship before the retry." };
  if (answerId === "smaller_steps") return { value: "smaller_steps", title: "Smaller steps", explanation: "Restore one intermediate step at a time, then return to independence." };
  if (answerId === "retry_independently") return { value: "retry_independently", title: "Independent retry", explanation: "Preserve another unsupported attempt before adding help." };
  return null;
}

function workspaceSetting(answerId: string) {
  if (answerId === "one_step") return { value: "one_step", title: "One step at a time", explanation: "Keep the current action prominent and make the full path optional." };
  if (answerId === "full_path") return { value: "full_path", title: "Full path visible", explanation: "Keep the whole session path visible while one action remains primary." };
  if (answerId === "learner_choice") return { value: "learner_choice", title: "Bounded choices", explanation: "Offer a small choice only when each route preserves the learning target." };
  if (answerId === "minimal_guidance") return { value: "minimal_guidance", title: "Minimal guidance", explanation: "Hide optional guidance until an attempt shows it is needed." };
  return null;
}

function correctedSignalCode(
  key: PersonalizationSignalKey,
  value: string,
): string | null {
  const directAnswerIndex: Partial<Record<PersonalizationSignalKey, number>> = {
    processing_entry: 10,
    memory_breakdown: 11,
    repair_preference: 12,
    workspace_preference: 13,
  };
  const answerIndex = directAnswerIndex[key];
  if (answerIndex !== undefined) {
    const answerId = deepProfileAnswerId(answerIndex, value);
    return answerId === "depends" ? null : answerId;
  }

  const normalized = value.trim().toLowerCase();
  const supportedStudyProfileValues: Partial<Record<StudyProfileDimension, Readonly<Record<string, string>>>> = {
    starting_friction: {
      low: "low",
      moderate: "moderate",
      high: "high",
      "higher starting friction": "high",
      "usually easy to begin": "low",
      "some trouble beginning": "moderate",
      "hard to begin": "high",
    },
    structure_need: {
      flexible: "low",
      balanced: "moderate",
      "high-structure": "high",
      "clear steps help most": "high",
    },
    attention_variability: {
      steady: "low",
      variable: "moderate",
      "highly variable": "high",
      "focus changes sometimes": "moderate",
      "focus changes often": "high",
    },
    calibration_risk: {
      "relatively calibrated": "relatively_calibrated",
      mixed: "mixed",
      "needs more checking": "overconfidence_risk",
      "confidence usually matches": "relatively_calibrated",
      "confidence is mixed": "mixed",
      "check knowledge more often": "overconfidence_risk",
      "test yourself sooner": "overconfidence_risk",
      "trust correct results more": "underconfidence_risk",
      "overconfidence risk": "overconfidence_risk",
      "underconfidence risk": "underconfidence_risk",
    },
    mistake_sensitivity: {
      low: "low",
      moderate: "moderate",
      high: "high",
      "higher mistake sensitivity": "high",
      "mistakes feel manageable": "low",
      "some concern about mistakes": "moderate",
      "mistakes can slow you down": "high",
    },
    cognitive_stamina: {
      stable: "low",
      "moderate decline": "moderate",
      "fast decline": "high",
      "longer blocks can work": "low",
      "energy fades over time": "moderate",
      "short blocks work best": "high",
    },
  };
  return supportedStudyProfileValues[key as StudyProfileDimension]?.[normalized] ?? null;
}

function signalCanCreateDecision(
  signal: Pick<LearnerPersonalizationSignal, "paused" | "evidenceLabel">,
) {
  return !signal.paused
    && signal.evidenceLabel !== "Seen once"
    && signal.evidenceLabel !== "Mixed evidence"
    && signal.evidenceLabel !== "Paused by you";
}

function addDirectCandidate(
  candidates: Map<PersonalizationSignalKey, Candidate>,
  key: PersonalizationSignalKey,
  title: string,
  value: string | undefined,
  answerIndex: number,
) {
  const bounded = value?.trim().slice(0, 240);
  const code = deepProfileAnswerId(answerIndex, bounded);
  if (!bounded || !code || code === "depends") return;
  candidates.set(key, {
    key,
    title,
    value: deepProfileAnswerLabel(answerIndex, code) ?? bounded,
    code,
    explanation: "This is a direct preference you can change at any time.",
    count: 1,
    refs: [`profile answer ${key}`],
  });
}

function canonicalExperimentSetting(
  variable: ActivePersonalizationExperiment["variable"],
): PersonalizationDecisionSetting {
  if (variable === "workspace") return "layout";
  if (variable === "support") return "first_repair";
  if (variable === "energy_window") return "recommended_window";
  if (variable === "method_tie") return "method_id";
  return variable;
}

function selfCandidate(
  key: PersonalizationSignalKey,
  title: string,
  value: string,
  code: string,
  refs: string[],
): Candidate {
  return { key, title, value, code, explanation: "This is a starting pattern from your answers, not a permanent label.", count: 1, refs };
}

function partialCalibrationDirection(state: PersonalizationState): StudyProfileCalibrationDirection | null {
  const q7 = state.studyProfile.answers.q7;
  const q8 = state.studyProfile.answers.q8;
  if (!q7 || !q8) return null;
  if (q8 === "d") return "underconfidence_risk";
  if (q8 === "c" || q7 === "d") return "overconfidence_risk";
  if (q8 === "b") return "mixed";
  return "relatively_calibrated";
}

function calibrationLabel(value: string) {
  if (value === "overconfidence_risk") return "Test yourself sooner";
  if (value === "underconfidence_risk") return "Trust correct results more";
  if (value === "relatively_calibrated") return "Confidence usually matches";
  return "Confidence is mixed";
}

function candidatesAgree(left: Candidate, right: Candidate) {
  if (left.code === right.code) return true;
  return new Set([left.code, right.code]).size === 2
    && [left.code, right.code].every((code) => code === "moderate" || code === "high");
}

function isEarlyInterruption(interruption: SessionInterruption) {
  if (interruption.totalSteps > 0) return interruption.completedSteps / interruption.totalSteps < 0.75;
  return interruption.plannedMinutes > 0 && interruption.actualMinutes < interruption.plannedMinutes * 0.75;
}

function answerAccuracy(completions: SessionCompletion[]) {
  const total = completions.reduce((sum, item) => sum + item.totalAnswers, 0);
  const correct = completions.reduce((sum, item) => sum + Math.min(item.correctAnswers, item.totalAnswers), 0);
  return total ? Math.round((correct / total) * 100) : 0;
}

function studyWindow(value: string, timeZone: string) {
  let hour: number;
  try {
    const part = new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      hourCycle: "h23",
      timeZone,
    }).formatToParts(new Date(value)).find((item) => item.type === "hour")?.value;
    hour = Number(part);
  } catch {
    hour = new Date(value).getUTCHours();
  }
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 22) return "evening";
  return "late_night";
}

function windowLabel(value: string) {
  if (value === "late_night") return "Late night";
  return `${value[0]?.toUpperCase() ?? ""}${value.slice(1)}`;
}

function isCoreMethodId(value: string): value is CoreMethodId {
  return CORE_METHOD_SET.has(value);
}

function deduplicateDecisions(decisions: PersonalizationDecision[]) {
  const byId = new Map<string, PersonalizationDecision>();
  for (const item of decisions) byId.set(item.id, item);
  return [...byId.values()];
}

function receiptKey(decision: PersonalizationDecision) {
  return `${decision.id}:${decision.evidenceLabel}`;
}

function receiptPriority(label: PersonalizationEvidenceLabel) {
  if (label === "Tested and promising") return 3;
  if (label === "Self-report and behavior agree") return 2;
  if (label === "Repeated pattern") return 1;
  return 0;
}

function inPeriod(value: string, start: number, end: number) {
  const time = Date.parse(value);
  return !Number.isNaN(time) && time >= start && time <= end;
}

function questionReason(dimension: StudyProfileDimension) {
  const reasons: Record<StudyProfileDimension, string> = {
    starting_friction: "This can help YOVA choose a smaller or more direct first action.",
    structure_need: "This can help YOVA decide how much of the path to show at once.",
    attention_variability: "This can help YOVA choose the pace of active rounds and checkpoints.",
    calibration_risk: "This can help YOVA decide when to compare confidence with a closed-note check.",
    mistake_sensitivity: "This can help YOVA choose how the first attempt and feedback should feel.",
    cognitive_stamina: "This can help YOVA choose bounded rounds and useful reset points.",
  };
  return reasons[dimension];
}

function questionChange(dimension: StudyProfileDimension) {
  const changes: Record<StudyProfileDimension, string> = {
    starting_friction: "It may change the opening action and recovery suggestion.",
    structure_need: "It may change the session path and workspace layout.",
    attention_variability: "It may change activity length and planned variation.",
    calibration_risk: "It may add prediction, retrieval, or confidence comparison.",
    mistake_sensitivity: "It may change first-attempt framing and repair support.",
    cognitive_stamina: "It may change block length and when YOVA suggests a reset.",
  };
  return changes[dimension];
}

/** Useful when an integration has only free-text plan methods. */
export function validMethodIdsFromPlan(plan: LearningPlan) {
  return [...new Set(plan.sessions.flatMap((session) => {
    const methodId = session.resource?.methodBriefing?.methodId ?? methodIdFromText(session.method);
    return methodId ? [methodId] : [];
  }))];
}
