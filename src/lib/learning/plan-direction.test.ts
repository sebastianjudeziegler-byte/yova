import { describe, expect, it } from "vitest";
import {
  applyPlanDirectionFallback,
  interpretPlanDirection,
  planDirectionConflictsWithRequest,
} from "@/lib/learning/plan-direction";

const rows = [{
  id: "10000000-1000-4000-8000-100000000001",
  sequence: 2,
  title: "Calculate post-round ownership",
  objective: "Calculate simple ownership percentages after new shares are issued.",
  method: "Quantitative worked examples",
  method_rationale: "Calculation practice makes dilution visible.",
  scheduled_for: "2026-08-09T18:00:00.000Z",
  estimated_minutes: 25,
  status: "ready" as const,
  step_data: {
    learningMode: "study",
    contentTargets: ["Calculate ownership percentages", "Use a dilution formula"],
    completionEvidence: ["Compute a founder ownership percentage"],
  },
}];

describe("plan direction", () => {
  it("recognizes a learner request to remove math", () => {
    expect(interpretPlanDirection("I do not want any math. Keep this conceptual.").kind).toBe("conceptual");
  });

  it("turns calculation work into a teaching-first conceptual path", () => {
    const redirected = applyPlanDirectionFallback(rows, "No math or calculations", "startup funding and dilution");

    expect(redirected[0].method).toContain("explanation");
    expect(redirected[0].step_data).toMatchObject({ learningMode: "learn" });
    expect(planDirectionConflictsWithRequest(redirected, "No math or calculations")).toBe(false);
    expect(redirected[0].objective).toContain("conceptual understanding");
  });

  it("does not convert an unverified freeform request into authoritative session objectives", () => {
    const before = structuredClone(rows);
    expect(() => applyPlanDirectionFallback(rows, "Focus on investor incentives and founder control", "startup funding"))
      .toThrow("Your plan is unchanged");
    expect(rows).toEqual(before);
  });

  it.each([
    "Teach photosynthesis instead of the link reaction.",
    "No calculations, and replace respiration with photosynthesis.",
    "More examples of chloroplasts instead of cellular respiration.",
  ])("rejects mixed scope requests rather than matching one familiar keyword: %s", direction => {
    expect(() => applyPlanDirectionFallback(rows, direction, "cellular respiration")).toThrow("Your plan is unchanged");
  });

  it.each([
    "Keep this conceptual. Do not include math or calculation exercises.",
    "Teach the foundations first, then use concrete examples before practice.",
    "Use more real examples and case scenarios before independent work.",
  ])("keeps the suggested adjustment available without the provider: %s", direction => {
    const result = applyPlanDirectionFallback(rows, direction, "startup funding and dilution");
    expect(result[0].id).toBe(rows[0].id);
    expect(result[0].objective).not.toContain("Follow this learner-approved direction");
  });
});
