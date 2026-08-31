import {
  deepProfileAnswerId,
  mergeStoredAdditionalContext,
} from "@/lib/personalization/learner-profile";
import {
  defaultPersonalizationState,
  evaluateActivePersonalizationExperiment,
  readPersonalizationStateFromAnswers,
  setPersonalizationControl,
  type PersonalizationControls,
  type PersonalizationSignalCorrection,
  type PersonalizationState,
} from "@/lib/personalization/personalization-state";
import {
  CANONICAL_PROFILE_SIGNAL_VALUE_IDS,
  CanonicalLearnerProfileSchema,
  createCanonicalLearnerProfile,
  type CanonicalLearnerProfile,
  type CanonicalProfileSignal,
  type CanonicalProfileSignalId,
} from "@/lib/personalization/canonical-profile-schema";
import { onboardingAnswerId } from "@/lib/sample-data";
import { STUDY_PROFILE_QUESTIONS } from "@/lib/study-profile/questions";
import { classifyStudyProfileScore } from "@/lib/study-profile/scoring";
import type {
  StudyProfileAnswers,
  StudyProfileClassification,
  StudyProfileDimension,
  StudyProfileMetadata,
} from "@/lib/study-profile/types";

type RankedCanonicalSignal = CanonicalProfileSignal & {
  rank: number;
};

export type LegacyStudyProfileSource = {
  answers: Partial<StudyProfileAnswers>;
  metadata?: Pick<StudyProfileMetadata, "energyWindow"> | null;
};

const DIRECT_CORRECTION_RANK = 600;
const DEEP_PROFILE_RANK = 500;
const ONBOARDING_RANK = 400;
const STUDY_PROFILE_METADATA_RANK = 300;
const STUDY_PROFILE_INFERENCE_RANK = 200;

const CANONICAL_SIGNAL_FROM_LEGACY_SIGNAL: Readonly<Record<string, CanonicalProfileSignalId>> = {
  control_mode: "control_mode",
  starting_friction: "starting_friction",
  structure_need: "workspace_structure",
  realistic_session_length: "realistic_session_length",
  processing_entry: "unfamiliar_entry",
  successful_approach: "successful_approach",
  memory_breakdown: "post_study_breakdown",
  calibration_risk: "post_study_breakdown",
  repair_preference: "first_repair",
  mistake_sensitivity: "first_repair",
  workspace_preference: "workspace_structure",
  attention_variability: "focus_pacing",
  cognitive_stamina: "focus_pacing",
  functional_support: "functional_support",
  energy_window: "preferred_working_period",
};

export const CANONICAL_V1_PERSONALIZATION_CONTROL_KEYS = [
  "selfReport",
  "behavior",
  "timing",
  "optionalQuestions",
  "receipts",
] as const satisfies readonly (keyof PersonalizationControls)[];

export type CanonicalV1PersonalizationControlKey =
  (typeof CANONICAL_V1_PERSONALIZATION_CONTROL_KEYS)[number];

/**
 * v1 learns from ordinary outcomes, but does not assign alternating variants.
 * An unfinished legacy experiment is archived once and old history remains
 * available as a read-only audit trail.
 */
export function consolidatePersonalizationStateForCanonicalV1(
  state: PersonalizationState,
): PersonalizationState {
  const active = state.activeExperiment;
  const evaluation = evaluateActivePersonalizationExperiment(active);
  const archiveExists = active
    ? state.experimentHistory.some((item) => item.id === active.id)
    : false;
  const experimentHistory = !active || archiveExists
    ? state.experimentHistory
    : [...state.experimentHistory, {
        id: active.id,
        variable: active.variable,
        variantA: active.variantA,
        variantB: active.variantB,
        taskType: active.taskType,
        knowledgeStage: active.knowledgeStage,
        result: "stopped" as const,
        summary: "This optional personal test was stopped when YOVA moved to canonical profile v1; no variant was selected.",
        sessionsA: evaluation.sessionsA,
        sessionsB: evaluation.sessionsB,
        checkedAnswers: evaluation.checkedAnswers,
        accuracyA: evaluation.accuracyA,
        accuracyB: evaluation.accuracyB,
        completedAt: active.startedAt,
      }];
  return {
    ...state,
    controls: {
      ...state.controls,
      experiments: false,
    },
    activeExperiment: null,
    experimentHistory,
  };
}

/**
 * This is the only control writer exposed by the canonical v1 layer. A stale
 * caller that passes the retired experiments key gets a no-op plus the same
 * fail-closed consolidation.
 */
export function setCanonicalV1PersonalizationControl(
  state: PersonalizationState,
  key: string,
  enabled: boolean,
  occurredAt: string,
): PersonalizationState {
  if (!CANONICAL_V1_PERSONALIZATION_CONTROL_KEYS.some((item) => item === key)) {
    return consolidatePersonalizationStateForCanonicalV1(state);
  }
  const updated = setPersonalizationControl(
    state,
    key as CanonicalV1PersonalizationControlKey,
    enabled,
    occurredAt,
  );
  return consolidatePersonalizationStateForCanonicalV1(updated);
}

export function migrateOnboardingAnswersToCanonicalProfile(
  answers: readonly string[],
): CanonicalLearnerProfile {
  return profileFromRankedSignals(onboardingCandidates(answers));
}

export function migrateDeepProfileAnswersToCanonicalProfile(
  answers: readonly string[],
): CanonicalLearnerProfile {
  return profileFromRankedSignals(deepProfileCandidates(answers));
}

export function migrateStoredAdditionalContextToCanonicalProfile(
  storedAdditionalContext: string | null,
): CanonicalLearnerProfile {
  return migrateLegacyAnswerVectorToCanonicalProfile(
    mergeStoredAdditionalContext([], storedAdditionalContext),
  );
}

export function migrateStudyProfileToCanonicalProfile(
  source: LegacyStudyProfileSource,
): CanonicalLearnerProfile {
  return profileFromRankedSignals(studyProfileCandidates(source));
}

export function migratePersonalizationStateToCanonicalProfile(
  state: PersonalizationState,
): CanonicalLearnerProfile {
  const canonicalState = consolidatePersonalizationStateForCanonicalV1(state);
  if (!canonicalState.controls.selfReport) {
    return createCanonicalLearnerProfile([]);
  }
  const stored = CanonicalLearnerProfileSchema.safeParse(
    canonicalState.canonicalProfile,
  );
  if (stored.success) return stored.data;
  return profileFromRankedSignals(applyStateCorrections(
    studyProfileCandidates({ answers: canonicalState.studyProfile.answers }),
    canonicalState,
  ));
}

/**
 * Complete compatibility boundary for the current account answer vector:
 * onboarding occupies slots 0-9, deeper answers 10-13, and the optional
 * Study Profile plus corrections live in the versioned state at slot 16.
 * Missing or incomplete sources simply leave canonical signals unknown.
 */
export function migrateLegacyAnswerVectorToCanonicalProfile(
  answers: readonly string[],
): CanonicalLearnerProfile {
  return migrateLegacyAnswerVectorToCanonicalV1(answers).profile;
}

export type CanonicalV1LegacyProfileMigration = {
  profile: CanonicalLearnerProfile;
  personalizationState: PersonalizationState;
};

export function migrateLegacyAnswerVectorToCanonicalV1(
  answers: readonly string[],
): CanonicalV1LegacyProfileMigration {
  const state = consolidatePersonalizationStateForCanonicalV1(
    readPersonalizationStateFromAnswers(answers),
  );
  if (!state.controls.selfReport) {
    return {
      profile: createCanonicalLearnerProfile([]),
      personalizationState: state,
    };
  }

  return {
    profile: profileFromRankedSignals(applyStateCorrections([
      ...onboardingCandidates(answers),
      ...deepProfileCandidates(answers),
      ...studyProfileCandidates({ answers: state.studyProfile.answers }),
    ], state)),
    personalizationState: state,
  };
}

export function migrateAllLegacyProfileSources(
  source: {
    answerVector?: readonly string[];
    studyProfile?: LegacyStudyProfileSource | null;
    personalizationState?: PersonalizationState | null;
  },
): CanonicalLearnerProfile {
  const state = consolidatePersonalizationStateForCanonicalV1(
    source.personalizationState
      ?? (source.answerVector
        ? readPersonalizationStateFromAnswers(source.answerVector)
        : defaultPersonalizationState()),
  );
  if (!state.controls.selfReport) return createCanonicalLearnerProfile([]);

  const candidates = [
    ...(source.answerVector ? onboardingCandidates(source.answerVector) : []),
    ...(source.answerVector ? deepProfileCandidates(source.answerVector) : []),
    ...studyProfileCandidates(source.studyProfile ?? {
      answers: state.studyProfile.answers,
    }),
  ];
  return profileFromRankedSignals(applyStateCorrections(candidates, state));
}

function onboardingCandidates(answers: readonly string[]): RankedCanonicalSignal[] {
  const candidates: RankedCanonicalSignal[] = [];
  const add = <SignalId extends CanonicalProfileSignalId>(
    signalId: SignalId,
    value: CanonicalProfileSignal<SignalId>["value"] | null,
    answerIndex: number,
    rank = ONBOARDING_RANK,
  ) => {
    if (!value) return;
    candidates.push({
      signalId,
      value,
      source: "legacy_onboarding",
      sourceQuestionId: `onboarding:q${answerIndex + 1}`,
      provenance: "compatible_migration",
      rank,
    } as RankedCanonicalSignal);
  };

  const controlMode = {
    exact_guidance: "yova_decides",
    structured_flexibility: "help_me_choose",
    learner_choice: "ill_customize",
  } as const;
  add("control_mode", mapped(controlMode, onboardingAnswerId(1, answers[1])), 1);

  const startingPattern = {
    on_time: "starts_as_planned",
    often_delay: "often_delays",
    deadline_pressure: "often_waits_for_pressure",
    planning_avoidance: "often_delays",
    varies: "depends",
  } as const;
  add(
    "starting_friction",
    mapped(startingPattern, onboardingAnswerId(5, answers[5])),
    5,
    ONBOARDING_RANK + 20,
  );
  const startingDifficulty = {
    struggle_to_start: "often_delays",
    unclear_first_step: "unclear_first_step",
    task_dependent: "depends",
  } as const;
  add(
    "starting_friction",
    mapped(startingDifficulty, onboardingAnswerId(0, answers[0])),
    0,
  );

  const sessionLength = {
    minutes_10_15: "minutes_10_15",
    minutes_20_30: "minutes_20_30",
    minutes_30_45: "minutes_30_45",
    minutes_45_60: "minutes_45_60",
    task_dependent: "depends",
  } as const;
  add(
    "realistic_session_length",
    mapped(sessionLength, onboardingAnswerId(2, answers[2])),
    2,
  );

  const unfamiliarEntry = {
    simple_explanation: "simple_explanation",
    concrete_example: "concrete_example",
    step_by_step: "small_steps",
    try_then_feedback: "try_first",
    mixed: "mixed",
  } as const;
  add(
    "unfamiliar_entry",
    mapped(unfamiliarEntry, onboardingAnswerId(3, answers[3])),
    3,
  );

  const focusPacing = {
    rarely: "steady_block",
    sometimes: "clear_checkpoints",
    often: "activity_changes",
    very_often: "short_blocks_with_changes",
  } as const;
  add("focus_pacing", mapped(focusPacing, onboardingAnswerId(4, answers[4])), 4);

  const functionalSupport = {
    shorter_sections: "shorter_sections",
    reduced_text_visual_structure: "reduced_text_visual_structure",
    extra_reading_time: "extra_reading_time",
    simpler_repeated_instructions: "simpler_repeated_instructions",
    frequent_check_ins: "frequent_check_ins",
    no_extra_support: "no_extra_support",
    task_dependent: "depends",
  } as const;
  add(
    "functional_support",
    mapped(functionalSupport, onboardingAnswerId(8, answers[8])),
    8,
  );

  const workingPeriod = {
    morning: "morning",
    afternoon: "afternoon",
    evening: "evening",
    late_night: "late_night",
    varies: "varies",
  } as const;
  add(
    "preferred_working_period",
    mapped(workingPeriod, onboardingAnswerId(6, answers[6])),
    6,
  );
  return candidates;
}

function deepProfileCandidates(answers: readonly string[]): RankedCanonicalSignal[] {
  const candidates: RankedCanonicalSignal[] = [];
  const add = <SignalId extends CanonicalProfileSignalId>(
    signalId: SignalId,
    value: CanonicalProfileSignal<SignalId>["value"] | null,
    answerIndex: number,
  ) => {
    if (!value) return;
    candidates.push({
      signalId,
      value,
      source: "legacy_deep_profile",
      sourceQuestionId: `deep_profile:q${answerIndex - 9}`,
      provenance: "compatible_migration",
      rank: DEEP_PROFILE_RANK,
    } as RankedCanonicalSignal);
  };

  const entry = deepProfileAnswerId(10, answers[10]);
  const entryValues = {
    concrete_example: "concrete_example",
    big_picture: "big_picture",
    small_steps: "small_steps",
    try_first: "try_first",
    compare_similar: "compare_similar",
    depends: "depends",
  } as const;
  add("unfamiliar_entry", mapped(entryValues, entry), 10);

  const breakdown = deepProfileAnswerId(11, answers[11]);
  const breakdownValues = {
    recognition_without_recall: "recognition_without_recall",
    delayed_forgetting: "delayed_forgetting",
    similar_idea_confusion: "similar_idea_confusion",
    application_gap: "application_gap",
    support_dependence: "support_dependence",
    depends: "depends",
  } as const;
  add("post_study_breakdown", mapped(breakdownValues, breakdown), 11);

  const repair = deepProfileAnswerId(12, answers[12]);
  const repairValues = {
    hint_first: "hint_first",
    alternate_example: "alternate_example",
    direct_correction: "direct_correction",
    smaller_steps: "smaller_steps",
    retry_independently: "retry_independently",
    depends: "depends",
  } as const;
  add("first_repair", mapped(repairValues, repair), 12);

  const workspace = deepProfileAnswerId(13, answers[13]);
  const workspaceValues = {
    one_step: "one_step",
    full_path: "full_path",
    learner_choice: "learner_choice",
    minimal_guidance: "minimal_guidance",
    depends: "depends",
  } as const;
  add("workspace_structure", mapped(workspaceValues, workspace), 13);
  return candidates;
}

function studyProfileCandidates(
  source: LegacyStudyProfileSource,
): RankedCanonicalSignal[] {
  const candidates: RankedCanonicalSignal[] = [];
  const add = <SignalId extends CanonicalProfileSignalId>(
    signalId: SignalId,
    value: CanonicalProfileSignal<SignalId>["value"] | null,
    sourceQuestionId: string,
    rank = STUDY_PROFILE_INFERENCE_RANK,
    metadata = false,
  ) => {
    if (!value) return;
    candidates.push({
      signalId,
      value,
      source: metadata
        ? "legacy_study_profile_metadata"
        : "legacy_study_profile",
      sourceQuestionId,
      provenance: metadata
        ? "compatible_migration"
        : "paired_response_inference",
      rank,
    } as RankedCanonicalSignal);
  };

  const starting = dimensionClassification(source.answers, "starting_friction");
  add("starting_friction", starting === "low"
    ? "starts_as_planned"
    : starting === "moderate"
      ? "sometimes_delays"
      : starting === "high"
        ? "often_waits_for_pressure"
        : null, "study_profile:q1+q2");

  const structure = dimensionClassification(source.answers, "structure_need");
  add(
    "workspace_structure",
    structure === "high" ? "one_step" : null,
    "study_profile:q3+q4",
  );

  const attention = dimensionClassification(source.answers, "attention_variability");
  const stamina = dimensionClassification(source.answers, "cognitive_stamina");
  const focus = focusPacingFromDimensions(attention, stamina);
  add("focus_pacing", focus, "study_profile:q5+q6+q11+q12");

  const calibration = dimensionClassification(source.answers, "calibration_risk");
  const calibrationDirection = source.answers.q8 === "d"
    ? "underconfidence"
    : source.answers.q8 === "c" || source.answers.q7 === "d"
      ? "overconfidence"
      : "other";
  add(
    "post_study_breakdown",
    calibration === "high" && calibrationDirection === "overconfidence"
      ? "recognition_without_recall"
      : null,
    "study_profile:q7+q8",
  );

  const mistakeResponse = dimensionClassification(source.answers, "mistake_sensitivity");
  add(
    "first_repair",
    mistakeResponse === "high" ? "hint_first" : null,
    "study_profile:q9+q10",
  );

  const period = source.metadata?.energyWindow;
  add(
    "preferred_working_period",
    period ?? null,
    "study_profile:metadata.energyWindow",
    STUDY_PROFILE_METADATA_RANK,
    true,
  );
  return candidates;
}

function dimensionClassification(
  answers: Partial<StudyProfileAnswers>,
  dimension: StudyProfileDimension,
): StudyProfileClassification | null {
  const questions = STUDY_PROFILE_QUESTIONS.filter((question) => (
    question.dimension === dimension
  ));
  if (questions.length !== 2) return null;
  const scores = questions.flatMap((question) => {
    const answer = answers[question.id];
    const option = question.options.find((candidate) => candidate.id === answer);
    return option ? [option.score] : [];
  });
  return scores.length === 2
    ? classifyStudyProfileScore(scores[0] + scores[1])
    : null;
}

function focusPacingFromDimensions(
  attention: StudyProfileClassification | null,
  stamina: StudyProfileClassification | null,
): CanonicalProfileSignal<"focus_pacing">["value"] | null {
  if (!attention && !stamina) return null;
  if (attention === "high" && stamina === "high") return "short_blocks_with_changes";
  if (stamina === "high") return "shorter_blocks";
  if (attention === "high") return "activity_changes";
  if (attention === "moderate" || stamina === "moderate") return "clear_checkpoints";
  return "steady_block";
}

function applyStateCorrections(
  candidates: RankedCanonicalSignal[],
  state: PersonalizationState,
) {
  const blocked = new Set<CanonicalProfileSignalId>();
  for (const paused of state.pausedSignalIds) {
    const signalId = canonicalSignalIdFromLegacy(paused);
    if (signalId) blocked.add(signalId);
  }

  const corrected: RankedCanonicalSignal[] = [];
  for (const correction of state.corrections) {
    const signalId = canonicalSignalIdFromLegacy(correction.signalId);
    if (!signalId) continue;
    if (correction.doNotInfer) {
      blocked.add(signalId);
      continue;
    }
    const value = canonicalValueFromCorrection(signalId, correction);
    if (!value) continue;
    corrected.push({
      signalId,
      value,
      source: "learner_correction",
      sourceQuestionId: `correction:${correction.signalId}`,
      provenance: "direct_answer",
      rank: DIRECT_CORRECTION_RANK,
    } as RankedCanonicalSignal);
  }

  return [...candidates, ...corrected].filter((candidate) => (
    !blocked.has(candidate.signalId)
  ));
}

function canonicalSignalIdFromLegacy(value: string) {
  const normalized = value.replace(/^signal:/, "");
  return CANONICAL_SIGNAL_FROM_LEGACY_SIGNAL[normalized] ?? null;
}

function canonicalValueFromCorrection(
  signalId: CanonicalProfileSignalId,
  correction: PersonalizationSignalCorrection,
) {
  const value = correction.correctedValue?.trim() ?? "";
  if (!value) return null;
  if (CANONICAL_PROFILE_SIGNAL_VALUE_IDS[signalId].some((item) => item === value)) {
    return value;
  }
  const answerIndex = signalId === "unfamiliar_entry"
    ? 10
    : signalId === "post_study_breakdown"
      ? 11
      : signalId === "first_repair"
        ? 12
        : signalId === "workspace_structure"
          ? 13
          : null;
  if (answerIndex === null) return null;
  const legacyValue = deepProfileAnswerId(answerIndex, value);
  return legacyValue && CANONICAL_PROFILE_SIGNAL_VALUE_IDS[signalId]
    .some((item) => item === legacyValue)
    ? legacyValue
    : null;
}

function profileFromRankedSignals(
  candidates: readonly RankedCanonicalSignal[],
) {
  const selected = new Map<CanonicalProfileSignalId, RankedCanonicalSignal>();
  for (const candidate of candidates) {
    const current = selected.get(candidate.signalId);
    if (
      !current
      || candidate.rank > current.rank
      || (candidate.rank === current.rank
        && candidate.sourceQuestionId.localeCompare(current.sourceQuestionId) < 0)
    ) {
      selected.set(candidate.signalId, candidate);
    }
  }
  return createCanonicalLearnerProfile(
    [...selected.values()].map((candidate) => ({
      signalId: candidate.signalId,
      value: candidate.value,
      source: candidate.source,
      sourceQuestionId: candidate.sourceQuestionId,
      provenance: candidate.provenance,
    }) as CanonicalProfileSignal),
  );
}

function mapped<
  Mapping extends Readonly<Record<string, string>>,
>(
  mapping: Mapping,
  key: string | null,
): Mapping[keyof Mapping] | null {
  if (!key || !(key in mapping)) return null;
  return mapping[key as keyof Mapping];
}
