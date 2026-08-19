import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PlanGenerationNotice } from "@/components/plan-generation-notice";
import { LIVE_AI_PLAN_FALLBACK_NOTICE } from "@/lib/plan-generation/fallback";

describe("PlanGenerationNotice", () => {
  it("renders a live failure as an alert with a retry control", () => {
    const html = renderToStaticMarkup(createElement(PlanGenerationNotice, {
      generation: {
        mode: "system",
        model: null,
        notice: LIVE_AI_PLAN_FALLBACK_NOTICE,
        requestId: "plan-request",
        durationMs: 60_000,
        persistence: "draft",
      },
      onRetry: vi.fn(),
    }));

    expect(html).toContain('role="alert"');
    expect(html).toContain("Live AI planning failed");
    expect(html).toContain("Retry live planning");
    expect(html).not.toContain("reliable planning engine");
  });

  it("keeps non-failure preview notices informational", () => {
    const html = renderToStaticMarkup(createElement(PlanGenerationNotice, {
      generation: {
        mode: "preview",
        model: null,
        notice: "Development preview generation is active.",
        requestId: "plan-preview",
        durationMs: 10,
        persistence: "draft",
      },
      onRetry: vi.fn(),
    }));

    expect(html).toContain('role="status"');
    expect(html).not.toContain("Retry live planning");
  });
});
