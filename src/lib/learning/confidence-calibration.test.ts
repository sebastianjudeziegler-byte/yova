import { describe, expect, it } from "vitest";
import {
  buildTopicCalibrationSignals,
  confidenceResultMessage,
  readConfidenceEvidenceProperty,
  summarizeConfidenceCalibration,
} from "@/lib/learning/confidence-calibration";

describe("confidence calibration", () => {
  it("detects a confident misconception", () => {
    const result = summarizeConfidenceCalibration([{
      concept: "Quotient rule",
      confidence: "very_sure",
      correct: false,
      activityType: "multiple_choice",
    }]);

    expect(result.pattern).toBe("possible_misconception");
    expect(result.explanation).toContain("possible misconception");
    expect(confidenceResultMessage("very_sure", false)).toContain("result disagreed");
  });

  it("detects correct but underestimated knowledge", () => {
    const result = summarizeConfidenceCalibration([{
      concept: "Glycolysis location",
      confidence: "guessing",
      correct: true,
      activityType: "free_response",
    }]);

    expect(result.pattern).toBe("underestimated_knowledge");
    expect(result.title).toContain("more than you expected");
  });

  it("waits for repeated aligned evidence before describing calibration", () => {
    const oneCheck = summarizeConfidenceCalibration([{
      concept: "ATP",
      confidence: "very_sure",
      correct: true,
      activityType: "multiple_choice",
    }]);
    const twoChecks = summarizeConfidenceCalibration([
      { concept: "ATP", confidence: "very_sure", correct: true, activityType: "multiple_choice" },
      { concept: "NADH", confidence: "guessing", correct: false, activityType: "free_response" },
    ]);

    expect(oneCheck.pattern).toBe("insufficient");
    expect(twoChecks.pattern).toBe("well_calibrated");
  });

  it("treats checks without a confidence gate as absent evidence, not a pattern", () => {
    const result = summarizeConfidenceCalibration([]);

    expect(result).toMatchObject({
      pattern: "insufficient",
      checkedAnswers: 0,
      highConfidenceMisses: 0,
      lowConfidenceSuccesses: 0,
    });
  });

  it("keeps topic-specific misconception context without storing a learner quote", () => {
    const topicId = "11111111-1111-4111-8111-111111111111";
    const signals = buildTopicCalibrationSignals([{
      topicId,
      concept: "Membrane transport direction",
      confidence: "very_sure",
      correct: false,
      activityType: "multiple_choice",
      misconceptionSummary: "Treats active transport as movement down a concentration gradient.",
    }]);

    expect(signals).toEqual([expect.objectContaining({
      topicId,
      pattern: "possible_misconception",
      misconceptionSummary: "Treats active transport as movement down a concentration gradient.",
    })]);
    expect(signals[0]?.feedback).toContain("active transport");
  });

  it("rejects malformed stored evidence", () => {
    expect(readConfidenceEvidenceProperty({ confidenceEvidence: [{ confidence: "certain" }] })).toEqual([]);
  });
});
