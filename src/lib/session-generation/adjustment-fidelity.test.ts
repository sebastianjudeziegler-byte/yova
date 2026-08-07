import { describe, expect, it } from "vitest";
import type { GeneratedSessionDraft, SessionAdjustment } from "@/lib/session-generation/schema";
import { validateSessionAdjustmentFidelity } from "@/lib/session-generation/adjustment-fidelity";

const adjustment: SessionAdjustment = {
  familiarity: "already_know",
  availableMinutes: 15,
  knownTargets: ["Product rule structure"],
  note: "",
};

function draft(phases: Array<"model" | "retrieve" | "independent_practice">, personalization = "YOVA will verify your prior-knowledge claim first.") {
  return {
    methodBriefing: { personalization: [personalization] },
    activities: phases.map((methodPhase, index) => ({
      methodPhase,
      requiredForCompletion: true,
      type: methodPhase === "model" ? "instruction" : "free_response",
      title: `Step ${index + 1}`,
    })),
  } as Pick<GeneratedSessionDraft, "activities" | "methodBriefing">;
}

describe("session adjustment fidelity", () => {
  it("accepts evidence before teaching for a claimed known target", () => {
    expect(validateSessionAdjustmentFidelity(
      draft(["retrieve", "model", "independent_practice"]),
      adjustment,
    )).toBeNull();
  });

  it("rejects teaching before the unsupported check", () => {
    expect(validateSessionAdjustmentFidelity(
      draft(["model", "retrieve", "independent_practice"]),
      adjustment,
    )).toContain("before any teaching model");
  });

  it("requires the method briefing to explain why the claim is being checked", () => {
    expect(validateSessionAdjustmentFidelity(
      draft(["retrieve", "independent_practice"], "This is personalized for the learner."),
      adjustment,
    )).toContain("named prior-knowledge claim");
  });
});
