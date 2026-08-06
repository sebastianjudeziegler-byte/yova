import { describe, expect, it } from "vitest";
import {
  buildMethodOutcomeSignals,
  validateMethodOutcomeAdaptation,
} from "@/lib/personalization/method-outcomes";

describe("buildMethodOutcomeSignals", () => {
  it("does not change a method from one completed session", () => {
    const [signal] = buildMethodOutcomeSignals([{
      methodId: "retrieval_practice",
      correctAnswers: 5,
      totalAnswers: 5,
      feedback: "about_right",
    }]);

    expect(signal.status).toBe("early_signal");
    expect(signal.deliveryGuidance).toContain("Do not adapt");
    expect(signal.evidence.toLowerCase()).not.toContain("learns best");
  });

  it("treats repeated strong checks as promising rather than causal proof", () => {
    const [signal] = buildMethodOutcomeSignals([
      { methodId: "worked_example_fading", correctAnswers: 4, totalAnswers: 5, feedback: "about_right" },
      { methodId: "worked_example_fading", correctAnswers: 5, totalAnswers: 5, feedback: "about_right" },
    ]);

    expect(signal).toMatchObject({
      methodId: "worked_example_fading",
      sessions: 2,
      checkedAnswers: 10,
      accuracyPercent: 90,
      status: "promising",
    });
    expect(signal.evidence).toContain("not proof");
  });

  it("adds support after repeated low accuracy without abandoning the method", () => {
    const [signal] = buildMethodOutcomeSignals([
      { methodId: "retrieval_practice", correctAnswers: 1, totalAnswers: 4, feedback: "too_difficult" },
      { methodId: "retrieval_practice", correctAnswers: 2, totalAnswers: 4, feedback: "too_difficult" },
    ]);

    expect(signal.status).toBe("needs_more_support");
    expect(signal.deliveryGuidance).toContain("Keep the method");
    expect(signal.deliveryGuidance).toContain("guided practice");
  });

  it("keeps different methods separate and ignores unknown method rows", () => {
    const signals = buildMethodOutcomeSignals([
      { methodId: "self_explanation", correctAnswers: 3, totalAnswers: 4, feedback: "about_right" },
      { methodId: "retrieval_practice", correctAnswers: 4, totalAnswers: 4, feedback: "about_right" },
      { methodId: null, correctAnswers: 0, totalAnswers: 4, feedback: "too_difficult" },
    ]);

    expect(signals).toHaveLength(2);
    expect(signals.every((signal) => signal.status === "early_signal")).toBe(true);
  });

  it("requires enough checked answers even when two sessions exist", () => {
    const [signal] = buildMethodOutcomeSignals([
      { methodId: "self_explanation", correctAnswers: 1, totalAnswers: 1, feedback: "about_right" },
      { methodId: "self_explanation", correctAnswers: 1, totalAnswers: 1, feedback: "about_right" },
    ]);

    expect(signal.status).toBe("early_signal");
  });

  it("requires a concrete support change when repeated outcomes need support", () => {
    const signals = buildMethodOutcomeSignals([
      { methodId: "retrieval_practice", correctAnswers: 1, totalAnswers: 4, feedback: "too_difficult" },
      { methodId: "retrieval_practice", correctAnswers: 2, totalAnswers: 4, feedback: "too_difficult" },
    ]);

    expect(validateMethodOutcomeAdaptation({
      methodId: "retrieval_practice",
      personalization: ["This is personalized from recent results."],
      signals,
    })).toContain("support adjustment");
    expect(validateMethodOutcomeAdaptation({
      methodId: "retrieval_practice",
      personalization: ["YOVA added one guided example before the closed-note attempt."],
      signals,
    })).toBeNull();
  });

  it("rejects fixed best-method claims", () => {
    expect(validateMethodOutcomeAdaptation({
      methodId: "self_explanation",
      personalization: ["This is your best method and matches your learning style."],
      signals: [],
    })).toContain("overclaimed");
  });
});
