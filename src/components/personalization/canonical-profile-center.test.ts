import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  CANONICAL_PROFILE_QUESTION_BY_ID,
  canonicalProfileFromQuestionnaire,
} from "@/lib/personalization/canonical-profile-questionnaire";
import { createCanonicalLearnerProfile } from "@/lib/personalization/canonical-profile-schema";
import {
  CanonicalProfileCenter,
  profileWithCanonicalAnswer,
} from "./canonical-profile-center";

describe("canonical profile center", () => {
  it("renders one transparent 11-question profile with migrated provenance", () => {
    const profile = createCanonicalLearnerProfile([{
      signalId: "control_mode",
      value: "help_me_choose",
      source: "legacy_onboarding",
      sourceQuestionId: "onboarding_1",
      provenance: "compatible_migration",
    }]);
    const html = renderToStaticMarkup(createElement(CanonicalProfileCenter, {
      profile,
      enabled: true,
      onProfileChange: () => undefined,
      onEnabledChange: () => undefined,
    }));

    expect(html).toContain("YOUR CANONICAL STUDY PROFILE");
    expect(html).toContain("1/11 answered");
    expect(html).toContain("Migrated from existing answers");
    expect(html).toContain("It depends on the task");
    expect(html).toContain("Not sure yet");
    expect(html.match(/<select/g)).toHaveLength(11);
    expect(html).not.toMatch(/experiment|learning style|brain type/i);
  });

  it("shows a truthful reversible pause without deleting saved answers", () => {
    const profile = createCanonicalLearnerProfile([{
      signalId: "control_mode",
      value: "help_me_choose",
      source: "canonical_questionnaire",
      sourceQuestionId: "profile_control_mode",
      provenance: "direct_answer",
    }]);
    const html = renderToStaticMarkup(createElement(CanonicalProfileCenter, {
      profile,
      enabled: false,
      onProfileChange: () => undefined,
      onEnabledChange: () => undefined,
    }));

    expect(html).toContain("Profile use paused");
    expect(html).toContain("do not influence method, duration, or workspace decisions");
    expect(html).toContain("1/11 answered");
    expect(html).toContain("Show a short recommendation and alternatives");
  });

  it("preserves untouched migrated signals and records only the correction", () => {
    const profile = createCanonicalLearnerProfile([{
      signalId: "control_mode",
      value: "help_me_choose",
      source: "legacy_onboarding",
      sourceQuestionId: "onboarding_1",
      provenance: "compatible_migration",
    }, {
      signalId: "realistic_session_length",
      value: "minutes_20_30",
      source: "legacy_onboarding",
      sourceQuestionId: "onboarding_2",
      provenance: "compatible_migration",
    }]);
    const updated = profileWithCanonicalAnswer(
      profile,
      CANONICAL_PROFILE_QUESTION_BY_ID.profile_control_mode,
      "ill_customize",
    );

    expect(updated.signals).toContainEqual(profile.signals[1]);
    expect(updated.signals[0]).toMatchObject({
      signalId: "control_mode",
      value: "ill_customize",
      source: "learner_correction",
      provenance: "direct_answer",
    });
  });

  it("allows an optional answer to be cleared without changing the others", () => {
    const profile = canonicalProfileFromQuestionnaire({
      questionnaireVersion: "canonical_profile_questionnaire_v1",
      answers: [
        { questionId: "profile_control_mode", value: "yova_decides" },
        { questionId: "profile_first_repair", value: "hint_first" },
      ],
    });
    const updated = profileWithCanonicalAnswer(
      profile,
      CANONICAL_PROFILE_QUESTION_BY_ID.profile_first_repair,
      "",
    );

    expect(updated.signals).toHaveLength(1);
    expect(updated.signals[0].signalId).toBe("control_mode");
  });
});
