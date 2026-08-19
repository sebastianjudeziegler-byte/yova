import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LearningContent } from "@/components/learning-content";

const require = createRequire(import.meta.url);
const katexStylesheet = readFileSync(
  require.resolve("katex/dist/katex.min.css"),
  "utf8",
);

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

  it("uses the overlap class supported by the imported KaTeX stylesheet", () => {
    const html = renderToStaticMarkup(createElement(LearningContent, {
      content: String.raw`$\frac{d}{dx}[f(x)g(x)] \ne f'(x)g'(x)$`,
    }));
    const emittedOverlapClass = html.match(
      /class="rlap">[\s\S]*?class="strut"[^>]*><\/span><span class="([^"]+)">/,
    )?.[1];
    const styledOverlapClass = katexStylesheet.match(
      /\.katex\s+\.rlap\s*>\s*\.([a-z-]+)\s*\{\s*position:\s*absolute/,
    )?.[1];

    expect(emittedOverlapClass).toBeTruthy();
    expect(styledOverlapClass).toBeTruthy();
    expect(emittedOverlapClass).toBe(styledOverlapClass);
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

  it("repairs compact ASCII notation in generated worked examples", () => {
    const html = renderToStaticMarkup(createElement(LearningContent, {
      content: "Find an antiderivative of 3x^2 - 4 and use F(1)=2. Write F(x)=x^3-4x+C.",
    }));

    expect(html.match(/class="katex"/g)).toHaveLength(3);
    expect(html).toContain("3x");
    expect(html).toContain("msup");
    expect(html).toContain("F(1)=2");
  });

  it("keeps prose numbers, dates, code, and existing math unchanged", () => {
    const html = renderToStaticMarkup(createElement(LearningContent, {
      content: "On 2026-08-18, keep `x^2` literal, study pages 3-5 in Q1-Q2 for 15 min, compare A/B, and render $y^2$ once.",
    }));

    expect(html.match(/class="katex"/g)).toHaveLength(1);
    expect(html).toContain("2026-08-18");
    expect(html).toContain("<code>x^2</code>");
    expect(html).toContain("pages 3-5");
    expect(html).toContain("Q1-Q2");
    expect(html).toContain("A/B");
    expect(html).toContain("15 min");
  });

  it("supports common ASCII operators without changing their meaning", () => {
    const html = renderToStaticMarkup(createElement(LearningContent, {
      content: "If x <= 4, set y = x + 2, then 2*x -> y and x_1 != 0.",
    }));

    expect(html.match(/class="katex"/g)).toHaveLength(4);
    expect(html).toContain("\\le");
    expect(html).toContain("\\cdot");
    expect(html).toContain("\\to");
    expect(html).toContain("\\ne");
  });
});
