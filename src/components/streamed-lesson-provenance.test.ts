import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { StreamedLessonReader } from "@/components/yova-prototype";
import { createLessonRuntimeState } from "@/lib/session-generation/lesson-runtime";

vi.mock("@/components/brand-mark", () => ({ BrandMark: () => null }));

describe("streamed lesson provenance", () => {
  it("labels a bounded fallback as built-in rather than generated content", () => {
    const html = renderToStaticMarkup(createElement(StreamedLessonReader, {
      state: {
        ...createLessonRuntimeState(),
        status: "complete",
        content: "# A safe explanation",
        deliveryMode: "bounded_fallback",
      },
    }));

    expect(html).toContain("Safe built-in lesson");
    expect(html).toContain("replaced it with this fallback");
    expect(html).toContain('class="streamed-lesson-fallback-provenance" role="status"');
  });

  it("does not mislabel a generated lesson as fallback content", () => {
    const html = renderToStaticMarkup(createElement(StreamedLessonReader, {
      state: {
        ...createLessonRuntimeState(),
        status: "complete",
        content: "# A generated explanation",
        deliveryMode: "generated",
      },
    }));

    expect(html).not.toContain("Safe built-in lesson");
    expect(html).not.toContain("streamed-lesson-fallback-provenance");
  });

  it("removes a lifted opening heading from the main lesson card", () => {
    const html = renderToStaticMarkup(createElement(StreamedLessonReader, {
      state: {
        ...createLessonRuntimeState(),
        status: "complete",
        content: "# Why Trenches Formed on the Western Front\n\n## Start with the causal chain\n\nFollow each cause in order.",
        deliveryMode: "generated",
      },
      activityTitle: "Learn Western Front trenches formed because repeated attacks produced stalemate...",
      omitLeadingHeading: true,
    }));

    expect(html).not.toContain("<h1");
    expect(html).not.toContain("Why Trenches Formed on the Western Front");
    expect(html).toContain("<h2>Start with the causal chain</h2>");
  });
});
