import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PlanResources } from "./yova-prototype";
import { blockFixture } from "@/evals/brief-c-block-fixture";
import { CachedGeneratedSessionSchema } from "@/lib/session-generation/schema";
import { toSessionResource } from "@/lib/session-generation/resource";
import type { LearningPlan } from "@/lib/domain";
vi.mock("server-only", () => ({}));

describe("saved work in the plan resource view", () => {
  it("keeps the named source, objective and practice visible after completing a source-first block", () => {
    const resource = toSessionResource(CachedGeneratedSessionSchema.parse(blockFixture()));
    const plan = { id: "c0000000-0000-4000-8000-000000000010", sessions: [{ id: "c0000000-0000-4000-8000-000000000011", status: "complete", title: "ATP and energy transfer", method: "Retrieval Practice", resource }] } as LearningPlan;
    const html = renderToStaticMarkup(createElement(PlanResources, { plan }));
    expect(html).toContain("Cellular energetics lecture.pdf");
    expect(html).toContain("ATP hydrolysis releases free energy");
    expect(html).toContain("Which products form when ATP reacts with water");
    expect(html).toContain("Explain how ATP hydrolysis supplies energy");
    expect(html).not.toContain("Nothing extra to browse yet");
  });
});
