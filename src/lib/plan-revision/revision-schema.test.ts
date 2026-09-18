import { describe, expect, it } from "vitest";
import { deterministicDeltaPlan } from "@/evals/personalization-delta-fixture";
import { RevisionPlanSchema } from "./revision-schema";

function withSessions(count: number, legacy = false) {
  const plan = structuredClone(deterministicDeltaPlan(1));
  plan.sessions = Array.from({ length: count }, (_, index) => ({ ...plan.sessions[index % plan.sessions.length]!, sequence: index + 1 }));
  if (legacy) delete plan.planModel;
  return plan;
}

describe("revision plan bounds", () => {
  it("accepts the complete v2 runtime queue up to its runtime bound", () => {
    expect(RevisionPlanSchema.safeParse(withSessions(40)).success).toBe(true);
    expect(RevisionPlanSchema.safeParse(withSessions(400)).success).toBe(true);
    expect(RevisionPlanSchema.safeParse(withSessions(401)).success).toBe(false);
  });
  it("retains the legacy revision bound", () => {
    expect(RevisionPlanSchema.safeParse(withSessions(28, true)).success).toBe(true);
    expect(RevisionPlanSchema.safeParse(withSessions(29, true)).success).toBe(false);
  });
});
