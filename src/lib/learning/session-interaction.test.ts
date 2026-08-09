import { describe, expect, it } from "vitest";
import { shouldRequestConfidence } from "@/lib/learning/session-interaction";

describe("session interaction", () => {
  it("asks for confidence on unsupported evidence attempts", () => {
    expect(shouldRequestConfidence({ isQuestion: true, isImmediateRepair: false, methodPhase: "retrieve" })).toBe(true);
    expect(shouldRequestConfidence({ isQuestion: true, isImmediateRepair: false, methodPhase: "transfer" })).toBe(true);
  });

  it("does not interrupt guided practice or immediate repair", () => {
    expect(shouldRequestConfidence({ isQuestion: true, isImmediateRepair: false, methodPhase: "guided_practice" })).toBe(false);
    expect(shouldRequestConfidence({ isQuestion: true, isImmediateRepair: true, methodPhase: "explain" })).toBe(false);
  });

  it("does not gate a post-teaching check for the same concept", () => {
    expect(shouldRequestConfidence({
      isQuestion: true,
      isImmediateRepair: false,
      methodPhase: "transfer",
      taughtEarlierInSession: true,
    })).toBe(false);
  });

  it("keeps confidence on retrieval and independent practice even after teaching", () => {
    expect(shouldRequestConfidence({
      isQuestion: true,
      isImmediateRepair: false,
      methodPhase: "retrieve",
      taughtEarlierInSession: true,
    })).toBe(true);
    expect(shouldRequestConfidence({
      isQuestion: true,
      isImmediateRepair: false,
      methodPhase: "independent_practice",
      taughtEarlierInSession: true,
    })).toBe(true);
  });

  it("does not ask on non-question activities", () => {
    expect(shouldRequestConfidence({ isQuestion: false, isImmediateRepair: false, methodPhase: "retrieve" })).toBe(false);
  });

  it("asks at most once after a prior calibration rating exists", () => {
    expect(shouldRequestConfidence({
      isQuestion: true,
      isImmediateRepair: false,
      methodPhase: "transfer",
      priorConfidenceCaptured: true,
    })).toBe(false);
  });
});
