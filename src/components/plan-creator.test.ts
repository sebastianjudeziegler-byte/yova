import { emptyOnboardingAnswers, withOnboardingAnswer } from "@/lib/onboarding/answers";
import { describe, expect, it } from "vitest";
import {
  durationLabel,
  planCreatorPreviewPreferenceRequestInput,
} from "@/components/plan-creator";
import { createCanonicalLearnerProfile } from "@/lib/personalization/canonical-profile-schema";

describe("durationLabel", () => {
  it("collapses uniform plan session lengths to one per-session value", () => {
    expect(durationLabel([25, 25, 25, 25, 25], "per-session")).toBe("25 minutes each");
  });

  it("keeps ranged plan session lengths readable", () => {
    expect(durationLabel([40, 25, 30], "per-session")).toBe("25 to 40 minutes each");
  });

  it("preserves the compact schedule-preview format", () => {
    expect(durationLabel([25, 25])).toBe("25 min");
    expect(durationLabel([40, 25])).toBe("25–40 min");
  });
});

describe("PlanCreator development-preview preferences", () => {
  it("transports the local baseline profile only in browser preview mode", () => {
    const answers = withOnboardingAnswer(emptyOnboardingAnswers(), "session_length", "minutes_10_15");
    expect(planCreatorPreviewPreferenceRequestInput(true, [], null, answers)).toEqual({ previewOnboardingAnswers: answers });
    expect(planCreatorPreviewPreferenceRequestInput(false, [], null, answers)).toEqual({});
  });

  it("sends canonical method preferences only in browser preview mode", () => {
    const previewCanonicalProfile = createCanonicalLearnerProfile([{
      signalId: "control_mode",
      value: "help_me_choose",
      source: "canonical_questionnaire",
      sourceQuestionId: "profile_control_mode",
      provenance: "direct_answer",
    }]);
    expect(planCreatorPreviewPreferenceRequestInput(true, [
      "retrieval_practice",
      "self_explanation",
    ], previewCanonicalProfile)).toEqual({
      previewPreferredMethodIds: ["retrieval_practice", "self_explanation"],
      previewCanonicalProfile,
    });
    expect(planCreatorPreviewPreferenceRequestInput(false, [
      "retrieval_practice",
    ], previewCanonicalProfile)).toEqual({});
    expect(planCreatorPreviewPreferenceRequestInput(true, [])).toEqual({});
  });
});
