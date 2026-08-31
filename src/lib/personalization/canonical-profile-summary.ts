import {
  CANONICAL_PROFILE_SIGNAL_IDS,
  canonicalProfileSignal,
  type CanonicalLearnerProfile,
  type CanonicalProfileSignal,
  type CanonicalProfileSignalId,
} from "@/lib/personalization/canonical-profile-schema";
import {
  canonicalQuestionForSignal,
  type CanonicalProfileDecisionId,
  type CanonicalProfileMaxAuthority,
} from "@/lib/personalization/canonical-profile-questionnaire";

export type CanonicalProfileDecisionHint = {
  signalId: CanonicalProfileSignalId;
  value: string;
  decisionIds: readonly CanonicalProfileDecisionId[];
  maxAuthority: CanonicalProfileMaxAuthority;
  rationale: string;
  source: CanonicalProfileSignal["source"];
  sourceQuestionId: string;
};

export type CanonicalLearnerFacingSummary = {
  heading: "How YOVA will work with you";
  statements: string[];
  evidenceBoundary: string;
  unansweredQuestionCount: number;
};

const NON_DIRECTIVE_VALUES = new Set([
  "depends",
  "not_sure",
  "varies",
  "none_yet",
]);

export function buildCanonicalProfileDecisionHints(
  profile: CanonicalLearnerProfile,
): CanonicalProfileDecisionHint[] {
  return profile.signals.flatMap((signal) => {
    if (NON_DIRECTIVE_VALUES.has(signal.value)) return [];
    const question = canonicalQuestionForSignal(signal.signalId);
    const option = question?.options.find((candidate) => (
      candidate.id === signal.value
    ));
    if (!question || !option) return [];
    return [{
      signalId: signal.signalId,
      value: signal.value,
      decisionIds: question.decisionIds,
      maxAuthority: question.maxAuthority,
      rationale: `${option.label}. ${question.explanation}`,
      source: signal.source,
      sourceQuestionId: signal.sourceQuestionId,
    }];
  });
}

export function buildCanonicalLearnerFacingSummary(
  profile: CanonicalLearnerProfile,
): CanonicalLearnerFacingSummary {
  const statements = [
    agencyStatement(profile),
    startAndPacingStatement(profile),
    learningStatement(profile),
    workspaceAndRepairStatement(profile),
    scheduleStatement(profile),
  ].filter((statement): statement is string => Boolean(statement));

  const answeredSignals = new Set(profile.signals.map((signal) => signal.signalId));
  return {
    heading: "How YOVA will work with you",
    statements: statements.length > 0
      ? statements
      : [
          "You can start now. YOVA will use the task, your available time, and checked work while profile answers remain optional.",
        ],
    evidenceBoundary:
      "Your answers guide changeable preferences. Task requirements, current availability, checked results, and your corrections still set the boundaries.",
    unansweredQuestionCount: CANONICAL_PROFILE_SIGNAL_IDS.length - answeredSignals.size,
  };
}

function agencyStatement(profile: CanonicalLearnerProfile) {
  const signal = actionableSignal(profile, "control_mode");
  if (!signal) return null;
  const statements: Record<typeof signal.value, string> = {
    yova_decides: "YOVA will choose among valid routes and keep the reason short.",
    help_me_choose: "YOVA will recommend one valid route and show concise alternatives when they matter.",
    ill_customize: "YOVA will let you customize from routes that remain valid for the task.",
    depends: "",
    not_sure: "",
  };
  return statements[signal.value] || null;
}

function startAndPacingStatement(profile: CanonicalLearnerProfile) {
  const starting = actionableSignal(profile, "starting_friction")?.value;
  const length = actionableSignal(profile, "realistic_session_length")?.value;
  const focus = actionableSignal(profile, "focus_pacing")?.value;
  const startCopy = starting ? ({
    starts_as_planned: "a direct first action",
    sometimes_delays: "a clear first action",
    often_delays: "a small, immediate first action",
    unclear_first_step: "an explicit first action",
    often_waits_for_pressure: "a small, immediate first action",
    depends: "",
    not_sure: "",
  } as const)[starting] : "";
  const lengthCopy = length ? ({
    minutes_10_15: "10–15 minute sessions",
    minutes_20_30: "20–30 minute sessions",
    minutes_30_45: "30–45 minute sessions",
    minutes_45_60: "45–60 minute sessions",
    depends: "",
    not_sure: "",
  } as const)[length] : "";
  const focusCopy = focus ? ({
    steady_block: "steady blocks",
    clear_checkpoints: "clear checkpoints",
    shorter_blocks: "shorter blocks with reset points",
    activity_changes: "planned changes between active tasks",
    short_blocks_with_changes: "short blocks with planned activity changes",
    depends: "",
    not_sure: "",
  } as const)[focus] : "";
  const choices = [startCopy, lengthCopy, focusCopy].filter(Boolean);
  return choices.length > 0
    ? `YOVA will usually begin with ${joinNatural(choices)}, when the task and today's time allow.`
    : null;
}

function learningStatement(profile: CanonicalLearnerProfile) {
  const entry = actionableSignal(profile, "unfamiliar_entry")?.value;
  const approach = actionableSignal(profile, "successful_approach")?.value;
  const breakdown = actionableSignal(profile, "post_study_breakdown")?.value;
  const entryCopy = entry ? ({
    simple_explanation: "a short explanation",
    concrete_example: "a concrete example",
    big_picture: "the big picture",
    small_steps: "small sequenced steps",
    try_first: "an attempt before explanation",
    compare_similar: "a comparison of similar ideas",
    mixed: "a mixed entry",
    depends: "",
    not_sure: "",
  } as const)[entry] : "";
  const approachCopy = approach ? ({
    closed_note_retrieval: "closed-note retrieval",
    practice_problems: "new practice problems",
    worked_examples_then_practice: "a worked example followed by practice",
    explain_from_memory: "explanation from memory",
    mixed: "a combination of eligible methods",
    none_yet: "",
    depends: "",
    not_sure: "",
  } as const)[approach] : "";
  const breakdownCopy = breakdown ? ({
    recognition_without_recall: "closed-note recall",
    delayed_forgetting: "a delayed check",
    similar_idea_confusion: "comparison and discrimination",
    application_gap: "independent application",
    support_dependence: "an unsupported final attempt",
    depends: "",
    not_sure: "",
  } as const)[breakdown] : "";

  const first = entryCopy ? `For unfamiliar material, YOVA will prefer ${entryCopy} as the opening` : "";
  const second = approachCopy ? `treat ${approachCopy} as a tie-break preference` : "";
  const third = breakdownCopy ? `include ${breakdownCopy} when it validly checks your reported gap` : "";
  const choices = [first, second, third].filter(Boolean);
  if (choices.length === 0) return null;
  return `${capitalize(joinNatural(choices))}.`;
}

function workspaceAndRepairStatement(profile: CanonicalLearnerProfile) {
  const repair = actionableSignal(profile, "first_repair")?.value;
  const workspace = actionableSignal(profile, "workspace_structure")?.value;
  const support = actionableSignal(profile, "functional_support")?.value;
  const repairCopy = repair ? ({
    hint_first: "a small hint first after a mistake",
    alternate_example: "an alternate example first after a mistake",
    direct_correction: "a direct correction first after a mistake",
    smaller_steps: "smaller steps for the next attempt",
    retry_independently: "an independent retry before more help",
    depends: "",
    not_sure: "",
  } as const)[repair] : "";
  const workspaceCopy = workspace ? ({
    one_step: "one step at a time",
    full_path: "the full path visible",
    learner_choice: "valid path choices visible",
    minimal_guidance: "only the guidance required",
    depends: "",
    not_sure: "",
  } as const)[workspace] : "";
  const supportCopy = support ? ({
    shorter_sections: "shorter sections",
    reduced_text_visual_structure: "less supporting text and clearer visual structure",
    extra_reading_time: "extra reading and response time",
    simpler_repeated_instructions: "simpler repeated instructions",
    frequent_check_ins: "clearer progress and stopping points",
    no_extra_support: "",
    depends: "",
    not_sure: "",
  } as const)[support] : "";
  const choices = [
    workspaceCopy ? `show ${workspaceCopy}` : "",
    repairCopy ? `use ${repairCopy}` : "",
    supportCopy ? `apply ${supportCopy}` : "",
  ].filter(Boolean);
  return choices.length > 0
    ? `In the study workspace, YOVA will ${joinNatural(choices)} without changing what you need to learn.`
    : null;
}

function scheduleStatement(profile: CanonicalLearnerProfile) {
  const period = actionableSignal(profile, "preferred_working_period")?.value;
  if (!period) return null;
  const label = ({
    morning: "morning",
    afternoon: "afternoon",
    evening: "evening",
    late_night: "late night",
    varies: "",
    not_sure: "",
  } as const)[period];
  return label
    ? `When several times are genuinely workable, YOVA may suggest ${label}.`
    : null;
}

function actionableSignal<SignalId extends CanonicalProfileSignalId>(
  profile: CanonicalLearnerProfile,
  signalId: SignalId,
) {
  const signal = canonicalProfileSignal(profile, signalId);
  return signal && !NON_DIRECTIVE_VALUES.has(signal.value) ? signal : null;
}

function joinNatural(values: readonly string[]) {
  if (values.length < 2) return values[0] ?? "";
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(", ")}, and ${values.at(-1)}`;
}

function capitalize(value: string) {
  return value ? `${value[0].toUpperCase()}${value.slice(1)}` : value;
}
