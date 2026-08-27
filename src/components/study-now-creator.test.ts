import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  buildStudyNowRequestSummary,
  StudyNowCreator,
  studyNowPreviewPreferenceRequestInput,
} from "@/components/study-now-creator";
import type { AddIntakeSeed } from "@/lib/intake/schema";

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

  it("sends canonical method preferences only in browser preview mode", () => {
    expect(studyNowPreviewPreferenceRequestInput(true, [
      "retrieval_practice",
      "self_explanation",
    ])).toEqual({
      previewPreferredMethodIds: ["retrieval_practice", "self_explanation"],
    });
    expect(studyNowPreviewPreferenceRequestInput(false, [
      "retrieval_practice",
    ])).toEqual({});
    expect(studyNowPreviewPreferenceRequestInput(true, [])).toEqual({});
  });
});
