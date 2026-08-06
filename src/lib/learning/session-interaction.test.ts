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

  it("does not ask on non-question activities", () => {
    expect(shouldRequestConfidence({ isQuestion: false, isImmediateRepair: false, methodPhase: "retrieve" })).toBe(false);
  });
});
