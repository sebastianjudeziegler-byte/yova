import {
  CanonicalLearnerProfileSchema,
  canonicalProfileSignal,
  type CanonicalLearnerProfile,
} from "@/lib/personalization/canonical-profile-schema";
import {
  consolidatePersonalizationStateForCanonicalV1,
  migrateLegacyAnswerVectorToCanonicalV1,
} from "@/lib/personalization/canonical-profile-migration";
import {
  readPersonalizationStateFromAnswers,
  updatePersonalizationStateInAnswers,
} from "@/lib/personalization/personalization-state";

export const PUBLIC_CANONICAL_PROFILE_DRAFT_STORAGE_KEY =
  "yova.canonical-profile.public-draft.v1" as const;

type ReadableStorage = Pick<Storage, "getItem">;
type WritableStorage = Pick<Storage, "setItem" | "removeItem">;

export function readPublicCanonicalProfileDraft(
  storage: ReadableStorage,
): CanonicalLearnerProfile | null {
  try {
    const raw = storage.getItem(PUBLIC_CANONICAL_PROFILE_DRAFT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = CanonicalLearnerProfileSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function writePublicCanonicalProfileDraft(
  storage: WritableStorage,
  profile: CanonicalLearnerProfile,
) {
  try {
    storage.setItem(
      PUBLIC_CANONICAL_PROFILE_DRAFT_STORAGE_KEY,
      JSON.stringify(CanonicalLearnerProfileSchema.parse(profile)),
    );
    return true;
  } catch {
    return false;
  }
}

export function clearPublicCanonicalProfileDraft(storage: WritableStorage) {
  try {
    storage.removeItem(PUBLIC_CANONICAL_PROFILE_DRAFT_STORAGE_KEY);
  } catch {
    // Blocked browser storage must not block account setup.
  }
}

export function canonicalLearnerProfileFromAnswers(
  answers: readonly string[],
): CanonicalLearnerProfile {
  const state = readPersonalizationStateFromAnswers(answers);
  const stored = CanonicalLearnerProfileSchema.safeParse(state.canonicalProfile);
  return stored.success
    ? stored.data
    : migrateLegacyAnswerVectorToCanonicalV1(answers).profile;
}

export function writeCanonicalLearnerProfileToAnswers(
  answers: readonly string[],
  profile: CanonicalLearnerProfile,
): string[] {
  const canonicalProfile = CanonicalLearnerProfileSchema.parse(profile);
  const compatibleAnswers = writeCanonicalLegacyCompatibilityAnswers(
    answers,
    canonicalProfile,
  );
  return updatePersonalizationStateInAnswers(compatibleAnswers, (current) => ({
    ...consolidatePersonalizationStateForCanonicalV1(current),
    canonicalProfile,
  }));
}

/**
 * Transitional write-through for delivery code that still reads the old
 * answer-vector slots. The canonical profile remains authoritative; these
 * values are never shown as a second questionnaire.
 */
export function writeCanonicalLegacyCompatibilityAnswers(
  answers: readonly string[],
  profile: CanonicalLearnerProfile,
): string[] {
  const next = [...answers];
  const set = (index: number, value: string | null | undefined) => {
    next[index] = value ?? "";
  };

  const control = canonicalProfileSignal(profile, "control_mode")?.value ?? null;
  set(1, control ? ({
    yova_decides: "exact_guidance",
    help_me_choose: "structured_flexibility",
    ill_customize: "learner_choice",
    depends: "",
    not_sure: "",
  } as const)[control] : "");

  const starting = canonicalProfileSignal(profile, "starting_friction")?.value ?? null;
  set(0, starting ? ({
    starts_as_planned: "",
    sometimes_delays: "",
    often_delays: "struggle_to_start",
    unclear_first_step: "unclear_first_step",
    often_waits_for_pressure: "struggle_to_start",
    depends: "task_dependent",
    not_sure: "",
  } as const)[starting] : "");
  set(5, starting ? ({
    starts_as_planned: "on_time",
    sometimes_delays: "often_delay",
    often_delays: "often_delay",
    unclear_first_step: "planning_avoidance",
    often_waits_for_pressure: "deadline_pressure",
    depends: "varies",
    not_sure: "",
  } as const)[starting] : "");

  const duration = canonicalProfileSignal(profile, "realistic_session_length")?.value ?? null;
  set(2, duration === "depends"
    ? "task_dependent"
    : duration === "not_sure"
      ? ""
      : duration);

  const entry = canonicalProfileSignal(profile, "unfamiliar_entry")?.value ?? null;
  set(3, entry ? ({
    simple_explanation: "simple_explanation",
    concrete_example: "concrete_example",
    big_picture: "mixed",
    small_steps: "step_by_step",
    try_first: "try_then_feedback",
    compare_similar: "mixed",
    mixed: "mixed",
    depends: "",
    not_sure: "",
  } as const)[entry] : "");
  set(10, entry === "simple_explanation" || entry === "not_sure"
    ? ""
    : entry);

  const breakdown = canonicalProfileSignal(profile, "post_study_breakdown")?.value ?? null;
  set(11, breakdown === "not_sure" ? "" : breakdown);

  const repair = canonicalProfileSignal(profile, "first_repair")?.value ?? null;
  set(12, repair === "not_sure" ? "" : repair);

  const workspace = canonicalProfileSignal(profile, "workspace_structure")?.value ?? null;
  set(13, workspace === "not_sure" ? "" : workspace);

  const pacing = canonicalProfileSignal(profile, "focus_pacing")?.value ?? null;
  set(4, pacing ? ({
    steady_block: "rarely",
    clear_checkpoints: "sometimes",
    shorter_blocks: "often",
    activity_changes: "often",
    short_blocks_with_changes: "very_often",
    depends: "",
    not_sure: "",
  } as const)[pacing] : "");

  const support = canonicalProfileSignal(profile, "functional_support")?.value ?? null;
  set(8, support === "depends"
    ? "task_dependent"
    : support === "not_sure"
      ? ""
      : support);

  const period = canonicalProfileSignal(profile, "preferred_working_period")?.value ?? null;
  set(6, period === "not_sure" ? "" : period);

  return next;
}
