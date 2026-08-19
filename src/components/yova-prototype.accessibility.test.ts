import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { OnboardingQuestion } from "@/components/yova-prototype";
import { onboardingQuestions } from "@/lib/sample-data";

vi.mock("@/components/brand-mark", () => ({ BrandMark: () => null }));

const polishStyles = readFileSync(resolve(process.cwd(), "src/app/polish.css"), "utf8");

function escapePattern(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function ruleDeclarations(selector: string) {
  return [...polishStyles.matchAll(new RegExp(`${escapePattern(selector)}\\s*\\{([^}]*)\\}`, "g"))]
    .map((match) => match[1] ?? "");
}

function pixelValues(selector: string, property: string) {
  const propertyPattern = new RegExp(`${escapePattern(property)}:\\s*(\\d+)px`, "g");
  return ruleDeclarations(selector).flatMap((declarations) => (
    [...declarations.matchAll(propertyPattern)].map((match) => Number(match[1]))
  ));
}

describe("learner-facing accessibility contracts", () => {
  it("groups onboarding choices and exposes the selected button state", () => {
    const question = onboardingQuestions[0];
    const selected = question.options[1];
    const html = renderToStaticMarkup(createElement(OnboardingQuestion, {
      index: 0,
      answer: selected.id,
      onAnswer: vi.fn(),
      onBack: vi.fn(),
      onNext: vi.fn(),
    }));

    expect(html).toContain(`<h2 id="onboarding-question-0">${question.prompt}</h2>`);
    expect(html).toContain('class="option-list" role="group" aria-labelledby="onboarding-question-0"');
    expect(html.match(/<button type="button" aria-pressed=/g)).toHaveLength(question.options.length);
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(html.match(/aria-pressed="false"/g)).toHaveLength(question.options.length - 1);
    expect(html).toMatch(/<button type="button" aria-pressed="true" class="option selected"/);
  });

  it("keeps home controls and mobile navigation at least 44 pixels tall", () => {
    const homeControlRule = ruleDeclarations(".home-page :is(button, input, summary)").join(" ");
    expect(homeControlRule).toMatch(/min-width:\s*44px/);
    expect(homeControlRule).toMatch(/min-height:\s*44px/);

    for (const selector of [
      ".sidebar-create",
      '.sidebar > nav[aria-label="Main navigation"] button',
      ".home-personalization-recommendation > button",
    ]) {
      const heights = pixelValues(selector, "min-height");
      expect(heights.length).toBeGreaterThan(0);
      expect(heights.every((height) => height >= 44)).toBe(true);
    }
  });

  it("gives compact home controls a 44 by 44 pixel target", () => {
    expect(ruleDeclarations(".home-personalization-proof button").join(" ")).toMatch(/min-width:\s*44px/);
    expect(ruleDeclarations(".home-personalization-proof button").join(" ")).toMatch(/min-height:\s*44px/);
    expect(ruleDeclarations(".rec-carousel-controls button").join(" ")).toMatch(/width:\s*44px/);
    expect(ruleDeclarations(".rec-carousel-controls button").join(" ")).toMatch(/height:\s*44px/);
    expect(ruleDeclarations(".ask-bar button, .session-ask button").join(" ")).toMatch(/width:\s*44px/);
    expect(ruleDeclarations(".ask-bar button, .session-ask button").join(" ")).toMatch(/height:\s*44px/);
  });
});
