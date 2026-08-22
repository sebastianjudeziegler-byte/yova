import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  methodPracticeTopics,
  StudyMethodPractice,
} from "@/components/study-method-practice";
import type { SessionMethodBriefing } from "@/lib/domain";

const briefing: SessionMethodBriefing = {
  learningMode: "learn",
  taskType: "conceptual_learning",
  methodId: "self_explanation",
  name: "Self-explanation",
  what: "Explain how and why an idea works in your own words, then compare it with an accurate model.",
  why: "Connecting steps makes gaps visible.",
  how: ["Study one concise explanation or example.", "Explain it in your own words."],
  completion: "Explain the central relationship and one supporting reason.",
  personalization: ["Your outside source remains the source of truth."],
};

const session = {
  objective: "Explain how an arbitrary system changes over time.",
  contentTargets: ["First relationship", "Second relationship"],
};

describe("StudyMethodPractice", () => {
  it("requires source-first teaching for a learn-mode outside workpad", () => {
    const html = renderToStaticMarkup(createElement(StudyMethodPractice, {
      briefing,
      session,
      sourceFirstRequired: true,
      onComplete: () => undefined,
    }));

    expect(html).toContain("I studied an explanation or complete example in my own source first");
    expect(html).toContain("A teaching-first session needs an initial subject model");
    expect(html).toContain("Your workpad");
    expect(html).toContain("First relationship");
    expect(html).toContain("Second relationship");
    expect(html).toContain("Finish as ungraded practice");
    expect(html).toContain("no topic will become taught, evidenced, or secure");
    expect(html).toContain("disabled");
  });

  it("uses the generated current slice and falls back to the objective", () => {
    expect(methodPracticeTopics(session, {
      focus: "Current focus",
      essentialIdeas: ["Current idea", "Current idea"],
    })).toEqual(["Current idea"]);
    expect(methodPracticeTopics({ objective: "Only objective", contentTargets: [] })).toEqual(["Only objective"]);
  });

  it("shows the workpad but removes ungraded completion from a required verification", () => {
    const html = renderToStaticMarkup(createElement(StudyMethodPractice, {
      briefing,
      session,
      allowUnguidedCompletion: false,
      onComplete: () => undefined,
    }));

    expect(html).toContain("Your workpad");
    expect(html).toContain("This session is the required knowledge check");
    expect(html).not.toContain("Finish as ungraded practice");
  });

  it("sends a standalone oversized workpad back to the guided path instead of promising missing questions", () => {
    const html = renderToStaticMarkup(createElement(StudyMethodPractice, {
      briefing,
      session,
      allowUnguidedCompletion: false,
      hasGuidedQuestionsBelow: false,
      onComplete: () => undefined,
    }));

    expect(html).toContain("This workpad cannot safely complete this session");
    expect(html).toContain("Return to the goal and start its guided session");
    expect(html).toContain("without dropping work");
    expect(html).not.toContain("guided questions below");
    expect(html).not.toContain("Finish as ungraded practice");
  });

  it("restores checked targets but never restores private workpad notes", () => {
    const html = renderToStaticMarkup(createElement(StudyMethodPractice, {
      briefing,
      session,
      sourceFirstRequired: true,
      progress: {
        checkedTopics: ["Second relationship"],
        sourceReviewed: true,
      },
      onComplete: () => undefined,
    }));

    expect(html).toMatch(/type="checkbox" checked=""[^>]*\/?>[\s\S]*I studied an explanation/);
    expect(html).toMatch(/type="checkbox" checked=""[^>]*\/?>[\s\S]*Second relationship/);
    expect(html).toMatch(/<textarea[^>]*><\/textarea>/);
    expect(html).not.toContain("PRIVATE WORKPAD NOTE");
  });
});
