import { describe, expect, it } from "vitest";
import {
  deepProfileAnswerCount,
  encodeAdditionalLearnerContext,
  expandedLearnerContextFromStored,
  mergeStoredAdditionalContext,
} from "@/lib/personalization/learner-profile";

describe("expanded learner profile", () => {
  it("round-trips deeper answers through the existing additional-context field", () => {
    const answers = Array.from({ length: 16 }, () => "");
    answers[8] = "Less text and more visual structure";
    answers[9] = "I need to understand why a formula works.";
    answers[10] = "A concrete example before the rule";
    answers[11] = "I understand it but cannot apply it";
    answers[12] = "Give me a small hint first";
    answers[13] = "Show one step at a time";
    answers[14] = "I copy algebra steps unless I explain the reason for each one.";
    answers[15] = "My recent interruption was caused by practice ending, not the session length.";

    const stored = encodeAdditionalLearnerContext(answers);
    const restored = mergeStoredAdditionalContext([], stored);

    expect(restored[9]).toBe(answers[9]);
    expect(restored[8]).toBe(answers[8]);
    expect(restored.slice(10, 16)).toEqual(answers.slice(10, 16));
    expect(deepProfileAnswerCount(restored)).toBe(5);
  });

  it("drops legacy diagnosis labels instead of turning them into model context", () => {
    const answers = Array.from({ length: 16 }, () => "");
    answers[8] = "ADHD";

    const restored = mergeStoredAdditionalContext([], encodeAdditionalLearnerContext(answers));

    expect(restored[8]).toBe("");
    expect(expandedLearnerContextFromStored(encodeAdditionalLearnerContext(answers)).functionalSupportNeed).toBeNull();
  });

  it("keeps older plain-text profile context backward compatible", () => {
    const restored = mergeStoredAdditionalContext([], "Examples make difficult ideas less abstract.");

    expect(restored[9]).toBe("Examples make difficult ideas less abstract.");
    expect(expandedLearnerContextFromStored("Examples make difficult ideas less abstract.").freeformContext).toBeNull();
  });
});
