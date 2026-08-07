import { describe, expect, it } from "vitest";
import { SessionGenerationRequestSchema } from "@/lib/session-generation/schema";

describe("session generation adjustment", () => {
  const base = {
    planId: "00000000-0000-4000-8000-000000000001",
    planSessionId: "00000000-0000-4000-8000-000000000002",
  };

  it("accepts an evidence-first already-known update with a shorter content window", () => {
    const result = SessionGenerationRequestSchema.safeParse({
      ...base,
      sessionAdjustment: {
        familiarity: "already_know",
        availableMinutes: 15,
        note: "I can already differentiate the product and quotient rules.",
      },
    });

    expect(result.success).toBe(true);
  });

  it("rejects time windows too short to support a meaningful guided session", () => {
    const result = SessionGenerationRequestSchema.safeParse({
      ...base,
      sessionAdjustment: {
        familiarity: "challenge_me",
        availableMinutes: 5,
        note: "",
      },
    });

    expect(result.success).toBe(false);
  });
});
