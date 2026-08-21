import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  formatSessionPreparationTopic,
  SessionLoading,
} from "@/components/yova-prototype";
import type { LearningPlan } from "@/lib/domain";

vi.mock("@/components/brand-mark", () => ({ BrandMark: () => null }));

describe("session preparation copy", () => {
  it("adds one terminal mark without doubling punctuation already in the goal", () => {
    expect(formatSessionPreparationTopic("Explain why sunsets look red."))
      .toBe("Explain why sunsets look red.");
    expect(formatSessionPreparationTopic("Why does the sky look blue?"))
      .toBe("Why does the sky look blue?");
    expect(formatSessionPreparationTopic("Learn the product rule"))
      .toBe("Learn the product rule.");
  });

  it("renders an already-punctuated goal with one terminal mark", () => {
    const html = renderToStaticMarkup(createElement(SessionLoading, {
      plan: {
        topic: "I want to explain why sunsets look red.",
      } as LearningPlan,
      onExit: vi.fn(),
    }));

    expect(html).toContain("<h1>Preparing the next part of <em>I want to explain why sunsets look red.</em></h1>");
    expect(html).not.toContain("red..</em>");
  });

  it("uses the fallback topic for empty presentation copy", () => {
    expect(formatSessionPreparationTopic("   ")).toBe("your goal.");
    expect(formatSessionPreparationTopic(null)).toBe("your goal.");
  });
});
