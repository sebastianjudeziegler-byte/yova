import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PageHeader } from "@/components/page-header";
import { SubjectIcon } from "@/components/subject-icon";
import type { LearningPlan } from "@/lib/domain";

describe("shared page primitives", () => {
  it("renders the existing page-header hierarchy and optional copy", () => {
    const html = renderToStaticMarkup(createElement(PageHeader, {
      eyebrow: "CALENDAR",
      title: "Your week",
      description: "One schedule across every active goal.",
    }));

    expect(html).toBe(
      '<header class="page-header"><span class="step-label">CALENDAR</span><h1>Your week</h1><p>One schedule across every active goal.</p></header>',
    );
    expect(renderToStaticMarkup(createElement(PageHeader, { title: "Learning" })))
      .toBe('<header class="page-header"><h1>Learning</h1></header>');
  });

  it("keeps subject inference, compact sizing, and decorative semantics", () => {
    const plan = {
      title: "Calculus derivatives",
      topic: "Product rule",
    } as LearningPlan;
    const html = renderToStaticMarkup(createElement(SubjectIcon, { plan, compact: true }));

    expect(html).toContain('class="subject-icon math compact"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('width="18"');
    expect(html).toContain('height="18"');
  });
});
