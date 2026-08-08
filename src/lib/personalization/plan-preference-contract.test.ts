import { describe, expect, it } from "vitest";
import { buildPlanPreferenceContract } from "@/lib/personalization/plan-preference-contract";

describe("plan preference contract", () => {
  it("turns learner answers into concrete delivery decisions", () => {
    const contract = buildPlanPreferenceContract([
      "What most often makes studying difficult? I struggle to start",
      "What study-session length usually feels realistic? 20 to 30 minutes",
      "When do you usually have the most usable energy? Evening",
      "When information is new, what usually helps it click? The big picture before the details",
      "What most often goes wrong after you study something? I forget it after a few days",
      "When you struggle, how should YOVA help first? Give me a small hint first",
      "How should a session organize the work on screen? Show one step at a time",
    ].join(" "));

    expect(contract.presentation.label).toBe("Big picture first");
    expect(contract.support.label).toBe("Hint before answer");
    expect(contract.retention.label).toBe("Return after a delay");
    expect(contract.workspace.label).toBe("One step at a time");
    expect(contract.pacing.label).toBe("Small first action");
    expect(contract.recommendedWindow).toBe("Evening");
    expect(contract.recommendedMinutes).toBe(25);
  });

  it("understands natural summaries instead of requiring questionnaire wording", () => {
    const contract = buildPlanPreferenceContract(
      "The learner wants the big picture before details, prefers a small hint before an answer, forgets material after a few days, and wants one visible step at a time.",
    );

    expect(contract.presentation.label).toBe("Big picture first");
    expect(contract.support.label).toBe("Hint before answer");
    expect(contract.retention.label).toBe("Return after a delay");
    expect(contract.workspace.label).toBe("One step at a time");
  });
});
