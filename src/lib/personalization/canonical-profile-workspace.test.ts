import { describe, expect, it } from "vitest";
import { createCanonicalLearnerProfile } from "@/lib/personalization/canonical-profile-schema";
import { canonicalProfileWorkspaceSettings } from "@/lib/personalization/canonical-profile-workspace";

const base = {
  layout: "automatic",
  textDensity: "automatic",
  motion: "reduced",
  visualStructure: "automatic",
  checkIns: "automatic",
} as const;

describe("canonical profile workspace projection", () => {
  it("applies explicit structure and functional support without changing motion", () => {
    const profile = createCanonicalLearnerProfile([
      {
        signalId: "workspace_structure",
        value: "one_step",
        source: "canonical_questionnaire",
        sourceQuestionId: "profile_workspace_structure",
        provenance: "direct_answer",
      },
      {
        signalId: "functional_support",
        value: "reduced_text_visual_structure",
        source: "canonical_questionnaire",
        sourceQuestionId: "profile_functional_support",
        provenance: "direct_answer",
      },
    ]);

    expect(canonicalProfileWorkspaceSettings({ profile, base })).toEqual({
      layout: "one_step",
      textDensity: "reduced",
      motion: "reduced",
      visualStructure: "more",
      checkIns: "automatic",
    });
  });

  it("turns canonical checkpoint pacing into presentation emphasis only", () => {
    const profile = createCanonicalLearnerProfile([{
      signalId: "focus_pacing",
      value: "clear_checkpoints",
      source: "canonical_questionnaire",
      sourceQuestionId: "profile_focus_pacing",
      provenance: "direct_answer",
    }]);

    expect(canonicalProfileWorkspaceSettings({ profile, base })).toMatchObject({
      checkIns: "more",
      layout: "automatic",
    });
  });

  it("keeps legacy settings when the canonical profile has no matching signal", () => {
    const profile = createCanonicalLearnerProfile([]);
    const legacy = { ...base, layout: "full_path" as const };

    expect(canonicalProfileWorkspaceSettings({ profile, base: legacy })).toEqual(legacy);
  });
});
