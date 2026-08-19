import { describe, expect, it } from "vitest";
import { LIVE_AI_PLAN_FALLBACK_NOTICE } from "@/lib/plan-generation/fallback";

describe("live AI plan fallback notice", () => {
  it("states the failure and gives the learner truthful next steps", () => {
    expect(LIVE_AI_PLAN_FALLBACK_NOTICE).toMatch(/^Live AI planning failed/);
    expect(LIVE_AI_PLAN_FALLBACK_NOTICE).toMatch(/fallback draft/i);
    expect(LIVE_AI_PLAN_FALLBACK_NOTICE).toMatch(/retry live planning/i);
  });
});
