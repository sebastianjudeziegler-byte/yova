import { z } from "zod";

export const CANONICAL_LEARNER_PROFILE_SCHEMA_VERSION =
  "canonical_learner_profile_v1" as const;
export const CANONICAL_PROFILE_QUESTIONNAIRE_VERSION =
  "canonical_profile_questionnaire_v1" as const;

export const CANONICAL_PROFILE_SIGNAL_IDS = [
  "control_mode",
  "starting_friction",
  "realistic_session_length",
  "unfamiliar_entry",
  "successful_approach",
  "post_study_breakdown",
  "first_repair",
  "workspace_structure",
  "focus_pacing",
  "functional_support",
  "preferred_working_period",
] as const;

export type CanonicalProfileSignalId =
  (typeof CANONICAL_PROFILE_SIGNAL_IDS)[number];

export const CANONICAL_PROFILE_SIGNAL_VALUE_IDS = {
  control_mode: [
    "yova_decides",
    "help_me_choose",
    "ill_customize",
    "depends",
    "not_sure",
  ],
  starting_friction: [
    "starts_as_planned",
    "sometimes_delays",
    "often_delays",
    "unclear_first_step",
    "often_waits_for_pressure",
    "depends",
    "not_sure",
  ],
  realistic_session_length: [
    "minutes_10_15",
    "minutes_20_30",
    "minutes_30_45",
    "minutes_45_60",
    "depends",
    "not_sure",
  ],
  unfamiliar_entry: [
    "simple_explanation",
    "concrete_example",
    "big_picture",
    "small_steps",
    "try_first",
    "compare_similar",
    "mixed",
    "depends",
    "not_sure",
  ],
  successful_approach: [
    "closed_note_retrieval",
    "practice_problems",
    "worked_examples_then_practice",
    "explain_from_memory",
    "mixed",
    "none_yet",
    "depends",
    "not_sure",
  ],
  post_study_breakdown: [
    "recognition_without_recall",
    "delayed_forgetting",
    "similar_idea_confusion",
    "application_gap",
    "support_dependence",
    "depends",
    "not_sure",
  ],
  first_repair: [
    "hint_first",
    "alternate_example",
    "direct_correction",
    "smaller_steps",
    "retry_independently",
    "depends",
    "not_sure",
  ],
  workspace_structure: [
    "one_step",
    "full_path",
    "learner_choice",
    "minimal_guidance",
    "depends",
    "not_sure",
  ],
  focus_pacing: [
    "steady_block",
    "clear_checkpoints",
    "shorter_blocks",
    "activity_changes",
    "short_blocks_with_changes",
    "depends",
    "not_sure",
  ],
  functional_support: [
    "shorter_sections",
    "reduced_text_visual_structure",
    "extra_reading_time",
    "simpler_repeated_instructions",
    "frequent_check_ins",
    "no_extra_support",
    "depends",
    "not_sure",
  ],
  preferred_working_period: [
    "morning",
    "afternoon",
    "evening",
    "late_night",
    "varies",
    "not_sure",
  ],
} as const satisfies Record<CanonicalProfileSignalId, readonly string[]>;

export type CanonicalProfileSignalValue<
  SignalId extends CanonicalProfileSignalId = CanonicalProfileSignalId,
> = (typeof CANONICAL_PROFILE_SIGNAL_VALUE_IDS)[SignalId][number];

export const CANONICAL_PROFILE_SOURCE_IDS = [
  "canonical_questionnaire",
  "learner_correction",
  "legacy_onboarding",
  "legacy_deep_profile",
  "legacy_study_profile",
  "legacy_study_profile_metadata",
] as const;

export type CanonicalProfileSourceId =
  (typeof CANONICAL_PROFILE_SOURCE_IDS)[number];

export const CANONICAL_PROFILE_PROVENANCE_IDS = [
  "direct_answer",
  "compatible_migration",
  "paired_response_inference",
] as const;

export type CanonicalProfileProvenance =
  (typeof CANONICAL_PROFILE_PROVENANCE_IDS)[number];

export type CanonicalProfileSignal<
  SignalId extends CanonicalProfileSignalId = CanonicalProfileSignalId,
> = {
  signalId: SignalId;
  value: CanonicalProfileSignalValue<SignalId>;
  source: CanonicalProfileSourceId;
  sourceQuestionId: string;
  provenance: CanonicalProfileProvenance;
};

const CanonicalProfileSignalIdSchema = z.enum(CANONICAL_PROFILE_SIGNAL_IDS);
const CanonicalProfileSourceIdSchema = z.enum(CANONICAL_PROFILE_SOURCE_IDS);
const CanonicalProfileProvenanceSchema = z.enum(
  CANONICAL_PROFILE_PROVENANCE_IDS,
);

const ALL_CANONICAL_SIGNAL_VALUE_IDS = [
  ...new Set(Object.values(CANONICAL_PROFILE_SIGNAL_VALUE_IDS).flat()),
] as [string, ...string[]];
const CanonicalProfileSignalValueSchema = z.enum(
  ALL_CANONICAL_SIGNAL_VALUE_IDS,
);

export const CanonicalProfileSignalSchema = z.object({
  signalId: CanonicalProfileSignalIdSchema,
  value: CanonicalProfileSignalValueSchema,
  source: CanonicalProfileSourceIdSchema,
  sourceQuestionId: z.string().trim().min(1).max(80),
  provenance: CanonicalProfileProvenanceSchema,
}).strict().superRefine((signal, context) => {
  const allowedValues = CANONICAL_PROFILE_SIGNAL_VALUE_IDS[signal.signalId];
  if (!allowedValues.some((value) => value === signal.value)) {
    context.addIssue({
      code: "custom",
      path: ["value"],
      message: `${signal.value} is not valid for ${signal.signalId}.`,
    });
  }
});

export const CanonicalLearnerProfileSchema = z.object({
  schemaVersion: z.literal(CANONICAL_LEARNER_PROFILE_SCHEMA_VERSION),
  questionnaireVersion: z.literal(CANONICAL_PROFILE_QUESTIONNAIRE_VERSION),
  signals: z.array(CanonicalProfileSignalSchema)
    .max(CANONICAL_PROFILE_SIGNAL_IDS.length),
}).strict().superRefine((profile, context) => {
  const seen = new Set<CanonicalProfileSignalId>();
  for (const [index, signal] of profile.signals.entries()) {
    if (seen.has(signal.signalId)) {
      context.addIssue({
        code: "custom",
        path: ["signals", index, "signalId"],
        message: `Duplicate canonical signal ${signal.signalId}.`,
      });
    }
    seen.add(signal.signalId);
  }
});

export type CanonicalLearnerProfile = z.infer<
  typeof CanonicalLearnerProfileSchema
>;

export function createCanonicalLearnerProfile(
  signals: readonly CanonicalProfileSignal[],
): CanonicalLearnerProfile {
  const signalOrder = new Map(
    CANONICAL_PROFILE_SIGNAL_IDS.map((signalId, index) => [signalId, index]),
  );
  return CanonicalLearnerProfileSchema.parse({
    schemaVersion: CANONICAL_LEARNER_PROFILE_SCHEMA_VERSION,
    questionnaireVersion: CANONICAL_PROFILE_QUESTIONNAIRE_VERSION,
    signals: [...signals].sort((left, right) => (
      (signalOrder.get(left.signalId) ?? Number.MAX_SAFE_INTEGER)
      - (signalOrder.get(right.signalId) ?? Number.MAX_SAFE_INTEGER)
    )),
  });
}

export function canonicalProfileSignal<
  SignalId extends CanonicalProfileSignalId,
>(
  profile: CanonicalLearnerProfile,
  signalId: SignalId,
): CanonicalProfileSignal<SignalId> | null {
  return (profile.signals.find((signal) => signal.signalId === signalId)
    ?? null) as CanonicalProfileSignal<SignalId> | null;
}

export function serializeCanonicalLearnerProfile(
  profile: CanonicalLearnerProfile,
) {
  return JSON.stringify(createCanonicalLearnerProfile(
    profile.signals as CanonicalProfileSignal[],
  ));
}
