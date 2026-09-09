import { writeFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { assertPersonalizationDelta, deltaFixture, learnerPrintout } from "./personalization-delta-fixture";
import { generateNormalPlanFillWithOpenAI } from "@/lib/openai/normal-plan-fill-generator";
import { buildNormalPlanFromFixedEnvelope } from "@/lib/plan-generation/normal-plan-pipeline";
vi.mock("server-only", () => ({}));
describe.skipIf(process.env.YOVA_RUN_LIVE_PERSONALIZATION_DELTA !== "1")("Brief A real-provider personalization delta", () => {
  it("writes two distinct learner plans inside fixed slots using the real provider", async () => {
    const plans = [];
    const preservedObjectives = [];
    const preservedReasons = [];
    for (const profile of [1, 2] as const) {
      const fixture = deltaFixture(profile);
      const generated = await generateNormalPlanFillWithOpenAI(fixture);
      expect(generated.generationStats.firstAttemptPassed).toBe(true);
      const plan = buildNormalPlanFromFixedEnvelope({ ...fixture, fill: generated.fill });
      preservedObjectives.push(plan.sessions.some(s => Object.values(generated.fill.sessions).some(copy => copy.objective === s.objective)));
      preservedReasons.push(plan.sessions.some(s => Object.values(generated.fill.sessions).some(copy => copy.methodReason === s.methodReason)));
      plans.push(plan);
    }
    if (process.env.YOVA_DELTA_PRINTOUT) writeFileSync(process.env.YOVA_DELTA_PRINTOUT, JSON.stringify({ P1: learnerPrintout(plans[0]), P2: learnerPrintout(plans[1]) }, null, 2));
    expect(preservedObjectives).toEqual([true, true]);
    expect(preservedReasons).toEqual([true, true]);
    assertPersonalizationDelta(plans[0], plans[1]);
  }, 120_000);
});
