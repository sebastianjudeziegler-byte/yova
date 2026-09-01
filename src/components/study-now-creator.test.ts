import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  buildStudyNowRequestSummary,
  studyNowStartingPointForSeed,
  StudyNowCreator,
  studyNowPreviewPreferenceRequestInput,
} from "@/components/study-now-creator";
import type { AddIntakeSeed } from "@/lib/intake/schema";
import { resolveLearningIntent } from "@/lib/learning/learning-intent";
import { createCanonicalLearnerProfile } from "@/lib/personalization/canonical-profile-schema";

vi.mock("@/components/brand-mark", () => ({ BrandMark: () => null }));

const seed: AddIntakeSeed = {
  title: "Calc Unit 3 test",
  objective: "Understand the chain rule well enough for the calc test",
  itemType: "test",
  dueAt: null,
  scope: "Chain rule only, before the calc test",
  progress: "",
  materialsSummary: "No materials attached yet.",
  missingFields: [],
  description: "Calc Unit 3 test on the chain rule",
  materials: [],
};

describe("StudyNowCreator request summary", () => {
  it("renders title, objective, and scope as separate sentences without relying on source punctuation", () => {
    const html = renderToStaticMarkup(createElement(StudyNowCreator, {
      onExit: vi.fn(),
      onFinish: vi.fn(),
      profileSummary: "",
      seed,
    }));

    expect(html).toContain("YOUR REQUEST");
    expect(html).toContain(
      "Calc Unit 3 test. Understand the chain rule well enough for the calc test. Scope: Chain rule only, before the calc test.",
    );
    expect(html).not.toContain("calc test Scope:");
  });

  it("preserves existing terminal punctuation without doubling it", () => {
    expect(buildStudyNowRequestSummary({
      title: "DNA review?",
      objective: "Practice ATP synthesis!",
      scope: "NADH production.",
    })).toBe("DNA review? Practice ATP synthesis! Scope: NADH production.");
  });

  it("seeds an unstarted speech with a supported start instead of assuming prior knowledge", () => {
    expect(studyNowStartingPointForSeed({
      ...seed,
      title: "Persuasive climate speech",
      objective: "Prepare and rehearse a persuasive speech using cited evidence",
      itemType: "assignment",
      scope: "Claim, evidence, rebuttal, and delivery",
      progress: "Not started",
      description: "Prepare a persuasive climate speech due next week",
    })).toBe("I haven't learned this yet");
  });

  it("does not treat an untouched problem set as proof that the underlying skill is new", () => {
    expect(studyNowStartingPointForSeed({
      ...seed,
      title: "Calculus problem set",
      objective: "Complete 20 assigned derivative problems",
      itemType: "assignment",
      scope: "Problems 1 through 20",
      progress: "Not started",
      description: "Complete 20 calculus problems from the textbook",
    })).toBe("I understand the basics but need practice");
  });

  it("keeps an explicit unstarted artifact on Learn with Study Now's unseeded default", () => {
    const startingPoint = studyNowStartingPointForSeed(null);
    expect(startingPoint).toBe("I understand the basics but need practice");
    expect(resolveLearningIntent({
      goal: "I have not started my essay",
      startingPoint,
    })).toMatchObject({ intent: "learn" });
  });

  it("sends canonical method preferences only in browser preview mode", () => {
    const previewCanonicalProfile = createCanonicalLearnerProfile([{
      signalId: "control_mode",
      value: "help_me_choose",
      source: "canonical_questionnaire",
      sourceQuestionId: "profile_control_mode",
      provenance: "direct_answer",
    }]);
    expect(studyNowPreviewPreferenceRequestInput(true, [
      "retrieval_practice",
      "self_explanation",
    ], previewCanonicalProfile)).toEqual({
      previewPreferredMethodIds: ["retrieval_practice", "self_explanation"],
      previewCanonicalProfile,
    });
    expect(studyNowPreviewPreferenceRequestInput(false, [
      "retrieval_practice",
    ], previewCanonicalProfile)).toEqual({});
    expect(studyNowPreviewPreferenceRequestInput(true, [])).toEqual({});
  });
});
