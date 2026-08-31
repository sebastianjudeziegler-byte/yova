import type { PersonalizationWorkspaceSettings } from "@/lib/personalization/personalization-state";
import {
  canonicalProfileSignal,
  type CanonicalLearnerProfile,
} from "@/lib/personalization/canonical-profile-schema";

/**
 * Projects the canonical profile onto presentation-only workspace settings.
 * These choices never change the StudyRoute, required work, or completion
 * evidence. Existing motion settings remain authoritative because the v1
 * questionnaire does not ask the learner to replace that accessibility
 * control.
 */
export function canonicalProfileWorkspaceSettings({
  profile,
  base,
}: {
  profile: CanonicalLearnerProfile;
  base: PersonalizationWorkspaceSettings;
}): PersonalizationWorkspaceSettings {
  const structure = canonicalProfileSignal(profile, "workspace_structure")?.value;
  const support = canonicalProfileSignal(profile, "functional_support")?.value;
  const pacing = canonicalProfileSignal(profile, "focus_pacing")?.value;

  const layout = structure === "one_step" || structure === "full_path"
    ? structure
    : structure
      ? "automatic" as const
      : base.layout;
  const reducedText = support === "reduced_text_visual_structure";
  const frequentCheckIns = support === "frequent_check_ins"
    || pacing === "clear_checkpoints"
    || pacing === "shorter_blocks"
    || pacing === "short_blocks_with_changes";

  return {
    ...base,
    layout,
    textDensity: reducedText ? "reduced" : base.textDensity,
    visualStructure: reducedText ? "more" : base.visualStructure,
    checkIns: frequentCheckIns ? "more" : base.checkIns,
  };
}
