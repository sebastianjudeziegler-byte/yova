import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LearningContent } from "@/components/learning-content";

describe("LearningContent", () => {
  it("renders model-style math delimiters as accessible KaTeX", () => {
    const html = renderToStaticMarkup(createElement(LearningContent, {
      content: String.raw`Use \(x=2\), then \[\frac{x^2}{2}\]`,
    }));

    expect(html).toContain("katex");
    expect(html).toContain("math");
    expect(html).not.toContain("\\(");
    expect(html).not.toContain("\\[");
  });

  it("keeps currency readable instead of treating two amounts as one equation", () => {
    const html = renderToStaticMarkup(createElement(LearningContent, {
      content: "If $100 earns interest, it can become $110.",
    }));

    expect(html).toContain("$100");
    expect(html).toContain("$110");
    expect(html).not.toContain("class=\"katex\"");
  });

  it("supports concise Markdown without exposing formatting characters", () => {
    const html = renderToStaticMarkup(createElement(LearningContent, {
      content: "**Key move:** apply $f'g + fg'$ once.",
    }));

    expect(html).toContain("<strong>Key move:</strong>");
    expect(html).toContain("katex");
    expect(html).not.toContain("**");
  });
});
