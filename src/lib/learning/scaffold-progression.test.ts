import { describe, expect, it } from "vitest";
import type { SessionCompletion } from "@/lib/domain";
import {
  buildScaffoldProgressionSignals,
  buildSessionSupportPlan,
  validateScaffoldProgression,
} from "@/lib/learning/scaffold-progression";

function completion(
  completedAt: string,
  outcome: "secure" | "needs_review",
  methodPhase: "guided_practice" | "independent_practice" | "transfer",
): Pick<SessionCompletion, "completedAt" | "conceptEvidence"> {
  return {
    completedAt,
    conceptEvidence: [{
      concept: "Product rule",
      outcome,
      activityType: "free_response",
      methodPhase,
    }],
  };
}

describe("scaffold progression", () => {
  it("restores guidance after the latest completed check exposes a gap", () => {
    const signals = buildScaffoldProgressionSignals([
      completion("2026-08-05T18:00:00.000Z", "secure", "guided_practice"),
      completion("2026-08-06T18:00:00.000Z", "needs_review", "independent_practice"),
    ]);

    expect(signals[0]).toMatchObject({
      concept: "Product rule",
      supportedChecks: 1,
      independentChecks: 1,
      status: "restore_support",
    });
    expect(validateScaffoldProgression({
      signals,
      activities: [
        { methodPhase: "retrieve", type: "free_response", concept: "Product rule" },
        { methodPhase: "model", type: "instruction", concept: null },
        { methodPhase: "transfer", type: "free_response", concept: "Product rule" },
      ],
    })).toBeNull();
  });

  it("fades support after a secure supported check", () => {
    const signals = buildScaffoldProgressionSignals([
      completion("2026-08-05T18:00:00.000Z", "secure", "guided_practice"),
    ]);

    expect(signals[0].status).toBe("fade_support");
    expect(validateScaffoldProgression({
      signals,
      activities: [{ methodPhase: "guided_practice", type: "multiple_choice", concept: "Product rule" }],
    })).toContain("independent attempt");
  });

  it("requires transfer after repeated independent success", () => {
    const signals = buildScaffoldProgressionSignals([
      completion("2026-08-05T18:00:00.000Z", "secure", "independent_practice"),
      completion("2026-08-06T18:00:00.000Z", "secure", "transfer"),
    ]);

    expect(signals[0].status).toBe("independent_transfer");
    expect(validateScaffoldProgression({
      signals,
      activities: [{ methodPhase: "independent_practice", type: "free_response", concept: "Product rule" }],
    })).toContain("transfer or discrimination");
    expect(validateScaffoldProgression({
      signals,
      activities: [{ methodPhase: "transfer", type: "free_response", concept: "Product rule" }],
    })).toBeNull();
  });

  it("creates a learner-facing support explanation from the evidence", () => {
    const signals = buildScaffoldProgressionSignals([
      completion("2026-08-05T18:00:00.000Z", "secure", "guided_practice"),
    ]);
    const supportPlan = buildSessionSupportPlan({
      signals,
      learningMode: "learn",
      activities: [
        { methodPhase: "model", type: "instruction", concept: null },
        { methodPhase: "independent_practice", type: "free_response", concept: "Product rule" },
      ],
    });

    expect(supportPlan).toMatchObject({
      level: "fading",
      title: "Support reduced for Product rule",
      concept: "Product rule",
    });
  });

  it("ignores legacy evidence that did not record the activity phase", () => {
    const signals = buildScaffoldProgressionSignals([{
      completedAt: "2026-08-05T18:00:00.000Z",
      conceptEvidence: [{ concept: "Product rule", outcome: "secure", activityType: "free_response" }],
    }]);
    expect(signals).toEqual([]);
  });
});
