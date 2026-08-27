import { describe, expect, it } from "vitest";
import {
  buildMethodOutcomeSignals,
  validateMethodOutcomeAdaptation,
} from "@/lib/personalization/method-outcomes";

describe("buildMethodOutcomeSignals", () => {
  const comparison = {
    taskType: "conceptual_learning" as const,
    knowledgeStage: "developing" as const,
  };
  const comparable = {
    taskType: comparison.taskType,
    knowledgeStage: comparison.knowledgeStage,
  };

  it("does not change a method from one completed session", () => {
    const [signal] = buildMethodOutcomeSignals([{
      methodId: "retrieval_practice",
      ...comparable,
      correctAnswers: 5,
      totalAnswers: 5,
      feedback: "about_right",
    }], comparison);

    expect(signal.status).toBe("early_signal");
    expect(signal.deliveryGuidance).toContain("Do not adapt");
    expect(signal.evidence.toLowerCase()).not.toContain("learns best");
  });

  it("treats four repeated strong checks as promising rather than causal proof", () => {
    const [signal] = buildMethodOutcomeSignals([
      { methodId: "worked_example_fading", ...comparable, correctAnswers: 4, totalAnswers: 5, feedback: "about_right" },
      { methodId: "worked_example_fading", ...comparable, correctAnswers: 5, totalAnswers: 5, feedback: "about_right" },
      { methodId: "worked_example_fading", ...comparable, correctAnswers: 4, totalAnswers: 5, feedback: "about_right" },
      { methodId: "worked_example_fading", ...comparable, correctAnswers: 5, totalAnswers: 5, feedback: "about_right" },
    ], comparison);

    expect(signal).toMatchObject({
      methodId: "worked_example_fading",
      sessions: 4,
      checkedAnswers: 20,
      accuracyPercent: 90,
      status: "promising",
    });
    expect(signal.evidence).toContain("not proof");
  });

  it("adds support after four repeated low-accuracy sessions without abandoning the method", () => {
    const [signal] = buildMethodOutcomeSignals([
      { methodId: "retrieval_practice", ...comparable, correctAnswers: 1, totalAnswers: 4, feedback: "too_difficult" },
      { methodId: "retrieval_practice", ...comparable, correctAnswers: 2, totalAnswers: 4, feedback: "too_difficult" },
      { methodId: "retrieval_practice", ...comparable, correctAnswers: 1, totalAnswers: 4, feedback: "too_difficult" },
      { methodId: "retrieval_practice", ...comparable, correctAnswers: 2, totalAnswers: 4, feedback: "too_difficult" },
    ], comparison);

    expect(signal.status).toBe("needs_more_support");
    expect(signal.deliveryGuidance).toContain("Keep the method");
    expect(signal.deliveryGuidance).toContain("guided practice");
  });

  it("keeps different methods separate and ignores unknown method rows", () => {
    const signals = buildMethodOutcomeSignals([
      { methodId: "self_explanation", ...comparable, correctAnswers: 3, totalAnswers: 4, feedback: "about_right" },
      { methodId: "retrieval_practice", ...comparable, correctAnswers: 4, totalAnswers: 4, feedback: "about_right" },
      { methodId: null, ...comparable, correctAnswers: 0, totalAnswers: 4, feedback: "too_difficult" },
    ], comparison);

    expect(signals).toHaveLength(2);
    expect(signals.every((signal) => signal.status === "early_signal")).toBe(true);
  });

  it("keeps two or three strong sessions as early evidence", () => {
    const [signal] = buildMethodOutcomeSignals([
      { methodId: "self_explanation", ...comparable, correctAnswers: 4, totalAnswers: 4, feedback: "about_right" },
      { methodId: "self_explanation", ...comparable, correctAnswers: 4, totalAnswers: 4, feedback: "about_right" },
      { methodId: "self_explanation", ...comparable, correctAnswers: 4, totalAnswers: 4, feedback: "about_right" },
    ], comparison);

    expect(signal.status).toBe("early_signal");
  });

  it("requires enough checked answers even when four sessions exist", () => {
    const [signal] = buildMethodOutcomeSignals([
      { methodId: "self_explanation", ...comparable, correctAnswers: 1, totalAnswers: 1, feedback: "about_right" },
      { methodId: "self_explanation", ...comparable, correctAnswers: 1, totalAnswers: 1, feedback: "about_right" },
      { methodId: "self_explanation", ...comparable, correctAnswers: 1, totalAnswers: 1, feedback: "about_right" },
      { methodId: "self_explanation", ...comparable, correctAnswers: 1, totalAnswers: 1, feedback: "about_right" },
    ], comparison);

    expect(signal.status).toBe("early_signal");
  });

  it("requires a concrete support change when repeated outcomes need support", () => {
    const signals = buildMethodOutcomeSignals([
      { methodId: "retrieval_practice", ...comparable, correctAnswers: 1, totalAnswers: 4, feedback: "too_difficult" },
      { methodId: "retrieval_practice", ...comparable, correctAnswers: 2, totalAnswers: 4, feedback: "too_difficult" },
      { methodId: "retrieval_practice", ...comparable, correctAnswers: 1, totalAnswers: 4, feedback: "too_difficult" },
      { methodId: "retrieval_practice", ...comparable, correctAnswers: 2, totalAnswers: 4, feedback: "too_difficult" },
    ], comparison);

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

  it("does not transfer method outcomes across different learning jobs", () => {
    const signals = buildMethodOutcomeSignals([
      { methodId: "retrieval_practice", ...comparable, correctAnswers: 4, totalAnswers: 4, feedback: "about_right" },
      { methodId: "retrieval_practice", ...comparable, correctAnswers: 4, totalAnswers: 4, feedback: "about_right" },
      {
        methodId: "retrieval_practice",
        taskType: "memorization",
        knowledgeStage: "developing",
        correctAnswers: 0,
        totalAnswers: 4,
        feedback: "too_difficult",
      },
    ], comparison);

    expect(signals[0]).toMatchObject({
      sessions: 2,
      accuracyPercent: 100,
      comparisonLabel: "concept learning at the developing-knowledge stage",
    });
  });

  it("does not transfer early teaching results into retrieval-ready work", () => {
    const signals = buildMethodOutcomeSignals([
      { methodId: "retrieval_practice", ...comparable, correctAnswers: 4, totalAnswers: 4, feedback: "about_right" },
      { methodId: "retrieval_practice", ...comparable, correctAnswers: 4, totalAnswers: 4, feedback: "about_right" },
    ], {
      taskType: "conceptual_learning",
      knowledgeStage: "retrieval_ready",
    });

    expect(signals).toEqual([]);
  });
});
