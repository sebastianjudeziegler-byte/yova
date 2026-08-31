import { z } from "zod";
import {
  CANONICAL_PROFILE_QUESTIONNAIRE_VERSION,
  CANONICAL_PROFILE_SIGNAL_IDS,
  CANONICAL_PROFILE_SIGNAL_VALUE_IDS,
  createCanonicalLearnerProfile,
  type CanonicalLearnerProfile,
  type CanonicalProfileSignal,
  type CanonicalProfileSignalId,
  type CanonicalProfileSignalValue,
} from "@/lib/personalization/canonical-profile-schema";

export const CANONICAL_PROFILE_DECISION_IDS = [
  "agency_mode",
  "first_action",
  "session_duration",
  "method_tiebreaker",
  "presentation",
  "knowledge_check",
  "first_repair",
  "workspace",
  "activity_cadence",
  "functional_support",
  "recommended_window",
] as const;

export type CanonicalProfileDecisionId =
  (typeof CANONICAL_PROFILE_DECISION_IDS)[number];

export const CANONICAL_PROFILE_MAX_AUTHORITIES = [
  "agency_only",
  "delivery_preference",
  "timing_preference",
  "method_tiebreaker",
  "functional_support",
  "schedule_preference",
] as const;

export type CanonicalProfileMaxAuthority =
  (typeof CANONICAL_PROFILE_MAX_AUTHORITIES)[number];

export type CanonicalProfileQuestionOption<
  SignalId extends CanonicalProfileSignalId = CanonicalProfileSignalId,
> = {
  id: CanonicalProfileSignalValue<SignalId>;
  label: string;
};

export type CanonicalProfileQuestion<
  SignalId extends CanonicalProfileSignalId = CanonicalProfileSignalId,
> = {
  id: `profile_${SignalId}`;
  number: number;
  format: "direct_choice" | "scenario";
  signalId: SignalId;
  signal: string;
  prompt: string;
  options: readonly CanonicalProfileQuestionOption<SignalId>[];
  decisionIds: readonly CanonicalProfileDecisionId[];
  decision: string;
  maxAuthority: CanonicalProfileMaxAuthority;
  authorityLimit: string;
  explanation: string;
  confirmationEvidence: readonly string[];
  contradictionEvidence: readonly string[];
  correction: string;
};

const sharedCorrection =
  "Change this answer, choose Depends or Not sure, or pause this signal in You; future decisions must use the correction.";

export const CANONICAL_PROFILE_QUESTIONS = [
  {
    id: "profile_control_mode",
    number: 1,
    format: "direct_choice",
    signalId: "control_mode",
    signal: "How much control the learner wants over a valid study route.",
    prompt: "How should YOVA involve you when more than one study route would work?",
    options: [
      { id: "yova_decides", label: "Choose the route for me" },
      { id: "help_me_choose", label: "Show a short recommendation and alternatives" },
      { id: "ill_customize", label: "Let me customize from valid options" },
      { id: "depends", label: "It depends on the task" },
      { id: "not_sure", label: "Not sure yet" },
    ],
    decisionIds: ["agency_mode"],
    decision: "Changes how valid route choices are presented and confirmed.",
    maxAuthority: "agency_only",
    authorityLimit: "Cannot make an ineligible method valid or weaken the learning target.",
    explanation: "YOVA may say it chose, recommended, or exposed options because of the learner's control preference.",
    confirmationEvidence: ["Repeated use of the chosen control mode without changing it."],
    contradictionEvidence: ["The learner repeatedly switches modes or corrects this answer."],
    correction: sharedCorrection,
  },
  {
    id: "profile_starting_friction",
    number: 2,
    format: "scenario",
    signalId: "starting_friction",
    signal: "What commonly slows the first meaningful action.",
    prompt: "You planned to study, and the time arrives. What most often happens?",
    options: [
      { id: "starts_as_planned", label: "I usually begin close to the planned time" },
      { id: "sometimes_delays", label: "I delay a little, then get going" },
      { id: "often_delays", label: "I often delay, even before pressure builds" },
      { id: "unclear_first_step", label: "I pause because the first step is unclear" },
      { id: "often_waits_for_pressure", label: "I often wait until pressure makes me start" },
      { id: "depends", label: "It depends on the task" },
      { id: "not_sure", label: "Not sure yet" },
    ],
    decisionIds: ["first_action", "presentation"],
    decision: "May change the size, clarity, and visibility of the first action.",
    maxAuthority: "delivery_preference",
    authorityLimit: "May shape the opening, but cannot lower the target or replace required practice.",
    explanation: "YOVA may say it made the first step smaller or clearer because starting can take extra effort.",
    confirmationEvidence: ["Repeated starts under comparable plans show the same pattern."],
    contradictionEvidence: ["Repeated prompt starts differ from the answer, or the learner corrects it."],
    correction: sharedCorrection,
  },
  {
    id: "profile_realistic_session_length",
    number: 3,
    format: "direct_choice",
    signalId: "realistic_session_length",
    signal: "The session length the learner usually considers workable.",
    prompt: "What study-session length is usually realistic for you?",
    options: [
      { id: "minutes_10_15", label: "10 to 15 minutes" },
      { id: "minutes_20_30", label: "20 to 30 minutes" },
      { id: "minutes_30_45", label: "30 to 45 minutes" },
      { id: "minutes_45_60", label: "45 to 60 minutes" },
      { id: "depends", label: "It depends on the task" },
      { id: "not_sure", label: "Not sure yet" },
    ],
    decisionIds: ["session_duration"],
    decision: "May rank feasible duration and block-shape options within today's availability.",
    maxAuthority: "timing_preference",
    authorityLimit: "Cannot exceed current availability or force content into too little active time.",
    explanation: "YOVA may say it chose a shorter or longer feasible route because that duration is usually workable.",
    confirmationEvidence: ["Comparable sessions near this length are repeatedly completed."],
    contradictionEvidence: ["Repeated early exits or extensions show a different workable length."],
    correction: sharedCorrection,
  },
  {
    id: "profile_unfamiliar_entry",
    number: 4,
    format: "scenario",
    signalId: "unfamiliar_entry",
    signal: "A preferred entry into unfamiliar material.",
    prompt: "When a topic is unfamiliar, what usually helps you make the first useful connection?",
    options: [
      { id: "simple_explanation", label: "A short explanation of the core idea" },
      { id: "concrete_example", label: "A concrete example before the rule" },
      { id: "big_picture", label: "The big picture before details" },
      { id: "small_steps", label: "A clear sequence of small steps" },
      { id: "try_first", label: "Trying first, then getting feedback" },
      { id: "compare_similar", label: "Comparing similar ideas side by side" },
      { id: "mixed", label: "A mixture" },
      { id: "depends", label: "It depends on the topic" },
      { id: "not_sure", label: "Not sure yet" },
    ],
    decisionIds: ["method_tiebreaker", "presentation"],
    decision: "May rank equally valid opening recipes and change how the explanation begins.",
    maxAuthority: "method_tiebreaker",
    authorityLimit: "Only breaks ties among methods already allowed by task, stage, mode, time, and evidence.",
    explanation: "YOVA may say it used a particular opening because that entry has helped before.",
    confirmationEvidence: ["Comparable checked work after this entry is repeatedly usable."],
    contradictionEvidence: ["Checked work or learner feedback repeatedly favors another entry."],
    correction: sharedCorrection,
  },
  {
    id: "profile_successful_approach",
    number: 5,
    format: "direct_choice",
    signalId: "successful_approach",
    signal: "A self-reported approach associated with learning that remained usable later.",
    prompt: "Which approach has most often helped learning still be usable days later?",
    options: [
      { id: "closed_note_retrieval", label: "Recalling it without notes, then checking" },
      { id: "practice_problems", label: "Solving new practice problems" },
      { id: "worked_examples_then_practice", label: "Studying an example, then trying one" },
      { id: "explain_from_memory", label: "Explaining the idea from memory" },
      { id: "mixed", label: "A combination" },
      { id: "none_yet", label: "I have not found one yet" },
      { id: "depends", label: "It depends on the task" },
      { id: "not_sure", label: "Not sure yet" },
    ],
    decisionIds: ["method_tiebreaker"],
    decision: "May weakly rank an eligible method when task and outcome evidence do not distinguish the options.",
    maxAuthority: "method_tiebreaker",
    authorityLimit: "A self-report never overrides eligibility, observed outcomes, or a committed route.",
    explanation: "YOVA may say it favored an eligible approach because the learner reported lasting success with it.",
    confirmationEvidence: ["Delayed checks and independent application repeatedly support the report."],
    contradictionEvidence: ["Comparable delayed results are mixed or repeatedly favor another method."],
    correction: sharedCorrection,
  },
  {
    id: "profile_post_study_breakdown",
    number: 6,
    format: "scenario",
    signalId: "post_study_breakdown",
    signal: "The gap most often noticed after studying.",
    prompt: "After studying, which gap do you notice most often?",
    options: [
      { id: "recognition_without_recall", label: "I recognize it but cannot recall it" },
      { id: "delayed_forgetting", label: "I forget it after a few days" },
      { id: "similar_idea_confusion", label: "I confuse similar ideas" },
      { id: "application_gap", label: "I understand it but cannot apply it" },
      { id: "support_dependence", label: "I can do it with help but not independently" },
      { id: "depends", label: "It depends on the topic" },
      { id: "not_sure", label: "Not sure yet" },
    ],
    decisionIds: ["method_tiebreaker", "knowledge_check"],
    decision: "May rank eligible checks or recipes that directly test the reported gap.",
    maxAuthority: "method_tiebreaker",
    authorityLimit: "Cannot mark a knowledge gap as present without checked evidence or bypass task requirements.",
    explanation: "YOVA may say it added a particular check because that is the gap the learner most often notices.",
    confirmationEvidence: ["Closed-note or independent checks repeatedly reveal the same gap."],
    contradictionEvidence: ["Comparable checks do not show the gap, or show a different one."],
    correction: sharedCorrection,
  },
  {
    id: "profile_first_repair",
    number: 7,
    format: "direct_choice",
    signalId: "first_repair",
    signal: "The first bounded support preferred after a mistake.",
    prompt: "After a mistake, how should YOVA help first?",
    options: [
      { id: "hint_first", label: "Give me a small hint" },
      { id: "alternate_example", label: "Show a different example" },
      { id: "direct_correction", label: "Explain the mistake directly" },
      { id: "smaller_steps", label: "Break the next attempt into smaller steps" },
      { id: "retry_independently", label: "Let me retry independently" },
      { id: "depends", label: "It depends on the task" },
      { id: "not_sure", label: "Not sure yet" },
    ],
    decisionIds: ["first_repair"],
    decision: "May choose the first support move after an error while preserving an independent retry.",
    maxAuthority: "delivery_preference",
    authorityLimit: "Cannot reveal required answers prematurely or remove independent assessment.",
    explanation: "YOVA may say it began repair this way because that support was requested.",
    confirmationEvidence: ["The learner continues and succeeds after this repair across comparable work."],
    contradictionEvidence: ["The repair repeatedly causes early exits, extra help requests, or a correction."],
    correction: sharedCorrection,
  },
  {
    id: "profile_workspace_structure",
    number: 8,
    format: "scenario",
    signalId: "workspace_structure",
    signal: "How much of the session path should stay visible.",
    prompt: "During a session, how should the work be organized on screen?",
    options: [
      { id: "one_step", label: "Show one step at a time" },
      { id: "full_path", label: "Keep the full path visible" },
      { id: "learner_choice", label: "Let me choose between valid paths" },
      { id: "minimal_guidance", label: "Use the least guidance that works" },
      { id: "depends", label: "It depends on the session" },
      { id: "not_sure", label: "Not sure yet" },
    ],
    decisionIds: ["workspace", "presentation"],
    decision: "May change navigation and visible structure without changing the route's learning requirements.",
    maxAuthority: "delivery_preference",
    authorityLimit: "Cannot hide required work or change what counts as completion.",
    explanation: "YOVA may say it changed path visibility because that workspace structure was requested.",
    confirmationEvidence: ["The learner completes comparable sessions without changing the layout."],
    contradictionEvidence: ["The learner repeatedly expands, collapses, or corrects the layout."],
    correction: sharedCorrection,
  },
  {
    id: "profile_focus_pacing",
    number: 9,
    format: "scenario",
    signalId: "focus_pacing",
    signal: "A preferred pacing response during demanding active work.",
    prompt: "During demanding study, what pacing usually keeps the work usable?",
    options: [
      { id: "steady_block", label: "One steady block" },
      { id: "clear_checkpoints", label: "Clear checkpoints inside the block" },
      { id: "shorter_blocks", label: "Shorter blocks with reset points" },
      { id: "activity_changes", label: "Changes between active task types" },
      { id: "short_blocks_with_changes", label: "Short blocks with activity changes" },
      { id: "depends", label: "It depends on the task" },
      { id: "not_sure", label: "Not sure yet" },
    ],
    decisionIds: ["session_duration", "activity_cadence"],
    decision: "May shape feasible block length, checkpoints, and activity cadence.",
    maxAuthority: "delivery_preference",
    authorityLimit: "Cannot add unsupported activity changes or exceed current availability.",
    explanation: "YOVA may say it shaped blocks or checkpoints because that pacing is usually workable.",
    confirmationEvidence: ["Comparable completion and checked accuracy remain stable with this pacing."],
    contradictionEvidence: ["Repeated exits, accuracy decline, or learner corrections point elsewhere."],
    correction: sharedCorrection,
  },
  {
    id: "profile_functional_support",
    number: 10,
    format: "direct_choice",
    signalId: "functional_support",
    signal: "An optional functional workspace support requested by the learner.",
    prompt: "Which optional support would make YOVA easier to use most often?",
    options: [
      { id: "shorter_sections", label: "Shorter sections with fewer steps at once" },
      { id: "reduced_text_visual_structure", label: "Less supporting text and clearer visual structure" },
      { id: "extra_reading_time", label: "Extra time to read and respond" },
      { id: "simpler_repeated_instructions", label: "Instructions repeated in simpler language" },
      { id: "frequent_check_ins", label: "Clearer progress and stopping points" },
      { id: "no_extra_support", label: "No extra support right now" },
      { id: "depends", label: "It depends on the task" },
      { id: "not_sure", label: "Not sure yet" },
    ],
    decisionIds: ["functional_support", "presentation"],
    decision: "May apply the requested workspace support without changing the target.",
    maxAuthority: "functional_support",
    authorityLimit: "Cannot infer a condition or reduce required knowledge and independent performance.",
    explanation: "YOVA may say it applied a workspace support because the learner requested it.",
    confirmationEvidence: ["The learner keeps the support enabled or confirms it remains useful."],
    contradictionEvidence: ["The learner disables, replaces, or limits the support to a task."],
    correction: sharedCorrection,
  },
  {
    id: "profile_preferred_working_period",
    number: 11,
    format: "direct_choice",
    signalId: "preferred_working_period",
    signal: "A usual working period that may inform scheduling.",
    prompt: "When is demanding study usually most workable for you?",
    options: [
      { id: "morning", label: "Morning" },
      { id: "afternoon", label: "Afternoon" },
      { id: "evening", label: "Evening" },
      { id: "late_night", label: "Late night" },
      { id: "varies", label: "It varies" },
      { id: "not_sure", label: "Not sure yet" },
    ],
    decisionIds: ["recommended_window"],
    decision: "May suggest a study window when the calendar leaves more than one workable option.",
    maxAuthority: "schedule_preference",
    authorityLimit: "A usual period is not today's energy state and cannot override deadlines or availability.",
    explanation: "YOVA may say it suggested a window because that period is usually workable.",
    confirmationEvidence: ["Comparable completed work repeatedly succeeds in this period."],
    contradictionEvidence: ["Recent comparable results or a learner correction show another period works better."],
    correction: sharedCorrection,
  },
] as const satisfies readonly CanonicalProfileQuestion[];

export type CanonicalProfileQuestionId =
  (typeof CANONICAL_PROFILE_QUESTIONS)[number]["id"];

export const CANONICAL_PROFILE_QUESTION_BY_ID = Object.fromEntries(
  CANONICAL_PROFILE_QUESTIONS.map((question) => [question.id, question]),
) as Record<
  CanonicalProfileQuestionId,
  (typeof CANONICAL_PROFILE_QUESTIONS)[number]
>;

const QUESTION_IDS = CANONICAL_PROFILE_QUESTIONS.map((question) => question.id) as [
  CanonicalProfileQuestionId,
  ...CanonicalProfileQuestionId[],
];

const CanonicalProfileQuestionnaireValueAnswerSchema = z.object({
  questionId: z.enum(QUESTION_IDS),
  value: z.string().trim().min(1).max(80),
}).strict();

const CanonicalProfileQuestionnaireOptionAnswerSchema = z.object({
  questionId: z.enum(QUESTION_IDS),
  optionId: z.string().trim().min(1).max(80),
}).strict().transform((answer) => ({
  questionId: answer.questionId,
  value: answer.optionId,
}));

export const CanonicalProfileQuestionnaireAnswerSchema = z.union([
  CanonicalProfileQuestionnaireValueAnswerSchema,
  CanonicalProfileQuestionnaireOptionAnswerSchema,
]).superRefine((answer, context) => {
  const question = CANONICAL_PROFILE_QUESTION_BY_ID[answer.questionId];
  if (!question.options.some((option) => option.id === answer.value)) {
    context.addIssue({
      code: "custom",
      path: ["value"],
      message: `${answer.value} is not valid for ${answer.questionId}.`,
    });
  }
});

export const CanonicalProfileQuestionnaireResponseSchema = z.object({
  questionnaireVersion: z.literal(CANONICAL_PROFILE_QUESTIONNAIRE_VERSION),
  answers: z.array(CanonicalProfileQuestionnaireAnswerSchema)
    .max(CANONICAL_PROFILE_QUESTIONS.length),
}).strict().superRefine((response, context) => {
  const seen = new Set<CanonicalProfileQuestionId>();
  for (const [index, answer] of response.answers.entries()) {
    if (seen.has(answer.questionId)) {
      context.addIssue({
        code: "custom",
        path: ["answers", index, "questionId"],
        message: `Duplicate questionnaire answer ${answer.questionId}.`,
      });
    }
    seen.add(answer.questionId);
  }
});

export type CanonicalProfileQuestionnaireResponse = z.infer<
  typeof CanonicalProfileQuestionnaireResponseSchema
>;

export type CanonicalProfileQuestionnaireResponseInput = z.input<
  typeof CanonicalProfileQuestionnaireResponseSchema
>;

export function canonicalProfileFromQuestionnaire(
  response: CanonicalProfileQuestionnaireResponseInput,
): CanonicalLearnerProfile {
  const parsed = CanonicalProfileQuestionnaireResponseSchema.parse(response);
  return createCanonicalLearnerProfile(parsed.answers.map((answer) => {
    const question = CANONICAL_PROFILE_QUESTION_BY_ID[answer.questionId];
    return {
      signalId: question.signalId,
      value: answer.value,
      source: "canonical_questionnaire",
      sourceQuestionId: question.id,
      provenance: "direct_answer",
    } as CanonicalProfileSignal;
  }));
}

export function canonicalProfileWithQuestionAnswer(
  profile: CanonicalLearnerProfile,
  questionId: CanonicalProfileQuestionId,
  value: string,
): CanonicalLearnerProfile {
  const question = CANONICAL_PROFILE_QUESTION_BY_ID[questionId];
  const existing = profile.signals.find((signal) => (
    signal.signalId === question.signalId
  ));
  if (existing?.value === value) return profile;

  const remaining = profile.signals.filter((signal) => (
    signal.signalId !== question.signalId
  ));
  if (!value) return createCanonicalLearnerProfile(
    remaining as CanonicalProfileSignal[],
  );

  const validOption = question.options.find((option) => option.id === value);
  if (!validOption) return profile;

  return createCanonicalLearnerProfile([
    ...(remaining as CanonicalProfileSignal[]),
    {
      signalId: question.signalId,
      value: validOption.id,
      source: existing ? "learner_correction" : "canonical_questionnaire",
      sourceQuestionId: question.id,
      provenance: "direct_answer",
    } as CanonicalProfileSignal,
  ]);
}

export function unansweredCanonicalProfileQuestionIds(
  profile: CanonicalLearnerProfile,
) {
  const answeredSignals = new Set(profile.signals.map((signal) => signal.signalId));
  return CANONICAL_PROFILE_QUESTIONS
    .filter((question) => !answeredSignals.has(question.signalId))
    .map((question) => question.id);
}

export function canonicalQuestionForSignal(
  signalId: CanonicalProfileSignalId,
) {
  return CANONICAL_PROFILE_QUESTIONS.find((question) => (
    question.signalId === signalId
  )) ?? null;
}

export function isCanonicalSignalValue<SignalId extends CanonicalProfileSignalId>(
  signalId: SignalId,
  value: string,
): value is CanonicalProfileSignalValue<SignalId> {
  return CANONICAL_PROFILE_SIGNAL_VALUE_IDS[signalId]
    .some((candidate) => candidate === value);
}

export function canonicalQuestionnaireCoversEverySignal() {
  return CANONICAL_PROFILE_SIGNAL_IDS.every((signalId) => (
    CANONICAL_PROFILE_QUESTIONS.some((question) => question.signalId === signalId)
  ));
}
