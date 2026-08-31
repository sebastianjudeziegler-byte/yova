import { describe, expect, it } from "vitest";
import { canonicalProfileFromQuestionnaire } from "@/lib/personalization/canonical-profile-questionnaire";
import {
  canonicalLearnerProfileFromAnswers,
  clearPublicCanonicalProfileDraft,
  PUBLIC_CANONICAL_PROFILE_DRAFT_STORAGE_KEY,
  readPublicCanonicalProfileDraft,
  writePublicCanonicalProfileDraft,
  writeCanonicalLegacyCompatibilityAnswers,
  writeCanonicalLearnerProfileToAnswers,
} from "@/lib/personalization/canonical-profile-storage";
import {
  defaultPersonalizationState,
  readPersonalizationStateFromAnswers,
  writePersonalizationStateToAnswers,
} from "@/lib/personalization/personalization-state";

describe("canonical profile storage", () => {
  it("migrates legacy answers until the canonical questionnaire is saved", () => {
    const answers = ["struggle_to_start", "learner_choice"];
    const profile = canonicalLearnerProfileFromAnswers(answers);

    expect(profile.signals.map((signal) => signal.signalId)).toEqual(
      expect.arrayContaining(["control_mode", "starting_friction"]),
    );
    expect(profile.signals.every((signal) => signal.provenance === "compatible_migration")).toBe(true);
  });

  it("stores one canonical profile and retires active experimentation", () => {
    const state = {
      ...defaultPersonalizationState(),
      controls: { ...defaultPersonalizationState().controls, experiments: true },
    };
    const answers = writePersonalizationStateToAnswers([], state);
    const profile = canonicalProfileFromQuestionnaire({
      questionnaireVersion: "canonical_profile_questionnaire_v1",
      answers: [{ questionId: "profile_control_mode", optionId: "help_me_choose" }],
    });
    const written = writeCanonicalLearnerProfileToAnswers(answers, profile);

    expect(canonicalLearnerProfileFromAnswers(written)).toEqual(profile);
    expect(readPersonalizationStateFromAnswers(written).controls.experiments).toBe(false);
    expect(readPersonalizationStateFromAnswers(written).canonicalProfile).toEqual(profile);
  });

  it("writes only hidden legacy compatibility slots for old delivery readers", () => {
    const profile = canonicalProfileFromQuestionnaire({
      questionnaireVersion: "canonical_profile_questionnaire_v1",
      answers: [
        { questionId: "profile_control_mode", value: "help_me_choose" },
        { questionId: "profile_starting_friction", value: "often_delays" },
        { questionId: "profile_unfamiliar_entry", value: "small_steps" },
        { questionId: "profile_first_repair", value: "hint_first" },
      ],
    });

    const written = writeCanonicalLegacyCompatibilityAnswers([], profile);
    expect(written[0]).toBe("struggle_to_start");
    expect(written[1]).toBe("structured_flexibility");
    expect(written[3]).toBe("step_by_step");
    expect(written[5]).toBe("often_delay");
    expect(written[10]).toBe("small_steps");
    expect(written[12]).toBe("hint_first");
  });

  it("round-trips a public canonical draft without accepting malformed storage", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    };
    const profile = canonicalProfileFromQuestionnaire({
      questionnaireVersion: "canonical_profile_questionnaire_v1",
      answers: [{ questionId: "profile_control_mode", value: "ill_customize" }],
    });

    expect(writePublicCanonicalProfileDraft(storage, profile)).toBe(true);
    expect(readPublicCanonicalProfileDraft(storage)).toEqual(profile);

    values.set(PUBLIC_CANONICAL_PROFILE_DRAFT_STORAGE_KEY, '{"signals":"forged"}');
    expect(readPublicCanonicalProfileDraft(storage)).toBeNull();

    clearPublicCanonicalProfileDraft(storage);
    expect(values.has(PUBLIC_CANONICAL_PROFILE_DRAFT_STORAGE_KEY)).toBe(false);
  });
});
