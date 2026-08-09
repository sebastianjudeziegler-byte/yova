import { describe, expect, it } from "vitest";
import {
  buildImmediateRepairAfterMiss,
  buildImmediateRepairSteps,
  mergeSessionEvidenceSummaries,
  summarizeCompletionConcepts,
  summarizeSessionEvidence,
  type GuidedSessionStep,
} from "@/lib/learning/session-evidence";

const steps: GuidedSessionStep[] = [
  {
    methodPhase: "retrieve",
    type: "multiple_choice",
    concept: "Product rule",
    label: "CHECK",
    title: "Differentiate the product",
    body: "Choose the correct derivative.",
    question: ["f'g + fg'", "f'g'", "fg"],
    correctAnswer: "f'g + fg'",
    feedback: "Differentiate each factor while leaving the other unchanged, then add the two terms.",
  },
  {
    methodPhase: "independent_practice",
    type: "free_response",
    concept: "Chain rule",
    label: "RECALL",
    title: "Explain the chain rule",
    body: "Explain it from memory.",
    question: null,
    correctAnswer: "Differentiate the outside function, then multiply by the derivative of the inside function.",
    feedback: "A strong answer includes both the outer derivative and the inner derivative multiplier.",
  },
];

describe("buildImmediateRepairSteps", () => {
  it("turns a miss into one bounded, required explain-back repair", () => {
    const repairs = buildImmediateRepairSteps(steps, { 0: false, 1: true });

    expect(repairs).toHaveLength(1);
    expect(repairs[0]).toMatchObject({
      type: "free_response",
      concept: "Product rule",
      evidenceRole: "immediate_repair",
    });
    expect(repairs[0].body).toContain("previous check exposed this exact gap");
  });

  it("caps repair work so one difficult session does not become overwhelming", () => {
    const repeatedMisses = [...steps, {
      ...steps[0],
      concept: "Quotient rule",
      title: "Differentiate the quotient",
    }];

    expect(buildImmediateRepairSteps(repeatedMisses, { 0: false, 1: false, 2: false })).toHaveLength(2);
  });
});

describe("buildImmediateRepairAfterMiss", () => {
  it("creates the repair directly after the missed activity", () => {
    const repair = buildImmediateRepairAfterMiss(steps, 0, { 0: false });

    expect(repair).toMatchObject({
      methodPhase: "repair",
      estimatedMinutes: 2,
      requiredForCompletion: true,
      evidenceRole: "immediate_repair",
      concept: "Product rule",
    });
  });

  it("does not duplicate an already inserted concept repair", () => {
    const existingRepair = buildImmediateRepairSteps(steps, { 0: false })[0];

    expect(buildImmediateRepairAfterMiss([...steps, existingRepair], 0, { 0: false })).toBeNull();
  });

  it("turns evaluator feedback into a specific repair target", () => {
    const repair = buildImmediateRepairAfterMiss(
      steps,
      0,
      { 0: false },
      2,
      ["Explain why both factors contribute to the derivative."],
    );

    expect(repair?.body).toContain("both factors contribute");
    expect(repair?.body).toContain("previous check exposed this exact gap");
    expect(repair?.body.length).toBeLessThanOrEqual(320);
  });

  it("turns a runtime repair decision into a visibly different support step", () => {
    const repair = buildImmediateRepairAfterMiss(
      steps,
      0,
      { 0: false },
      2,
      [],
      {
        mode: "direct_correction",
        modeLabel: "Name and replace the error",
        personalizationReason: "The learner was very sure, so the exact mismatch is named before the retry.",
        title: "Replace the missing product-rule term",
        supportHeading: "Direct correction",
        explanation: "Both factors contribute one derivative term.",
        steps: ["Differentiate the first factor.", "Differentiate the second factor.", "Add both terms."],
        retryPrompt: "State the complete product rule and explain why both terms are required.",
        targetReminder: "The original product-rule target remains unchanged.",
      },
    );

    expect(repair).toMatchObject({
      title: "Replace the missing product-rule term",
      estimatedMinutes: 5,
      repairSupport: {
        mode: "direct_correction",
      },
    });
    expect(repair?.body).toContain("State the complete product rule");
  });
});

describe("summarizeSessionEvidence", () => {
  it("records an immediate repair as concept evidence in the repair phase", () => {
    const repair = buildImmediateRepairSteps(steps, { 0: false, 1: true })[0];
    const summary = summarizeSessionEvidence(
      [...steps, repair],
      { 0: false, 1: true, 2: true },
      { 0: "very_sure", 1: "somewhat_sure" },
    );

    expect(summary).toMatchObject({
      correctAnswers: 1,
      totalAnswers: 2,
      observedGap: "No major gap detected in the required check",
      completedImmediateRepairs: 1,
    });
    expect(summary.conceptEvidence).toHaveLength(3);
    expect(summary.conceptEvidence[0]).toMatchObject({
      concept: "Product rule",
      outcome: "needs_review",
      methodPhase: "retrieve",
    });
    expect(summary.conceptEvidence[2]).toMatchObject({
      concept: "Product rule",
      outcome: "secure",
      methodPhase: "repair",
    });
  });

  it("records both free-response attempts and lets the second outcome drive the gap", () => {
    const summary = summarizeSessionEvidence(
      steps,
      { 1: false },
      {},
      { 1: [false, false] },
    );

    expect(summary).toMatchObject({
      correctAnswers: 0,
      totalAnswers: 1,
      observedGap: "Chain rule",
    });
    expect(summary.conceptEvidence).toEqual([
      expect.objectContaining({ concept: "Chain rule", outcome: "needs_review", attempt: 1 }),
      expect.objectContaining({ concept: "Chain rule", outcome: "needs_review", attempt: 2 }),
    ]);
  });

  it("counts only checks completed after a resumed session", () => {
    const summary = summarizeSessionEvidence(
      steps,
      { 1: true },
      { 1: "somewhat_sure" },
    );

    expect(summary).toMatchObject({
      correctAnswers: 1,
      totalAnswers: 1,
      observedGap: "No major gap detected in the required check",
    });
  });

  it("combines evidence collected before and after an interruption", () => {
    const beforePause = summarizeSessionEvidence(
      steps.slice(0, 1),
      { 0: false },
      { 0: "very_sure" },
    );
    const afterPause = summarizeSessionEvidence(
      steps,
      { 1: true },
      { 1: "somewhat_sure" },
    );

    expect(mergeSessionEvidenceSummaries(beforePause, afterPause)).toMatchObject({
      correctAnswers: 1,
      totalAnswers: 2,
      observedGap: "Product rule",
      completedImmediateRepairs: 0,
    });
  });
});

describe("summarizeCompletionConcepts", () => {
  it("keeps a concept in review when the session contains mixed evidence", () => {
    expect(summarizeCompletionConcepts([
      { concept: "Product rule", outcome: "secure", activityType: "multiple_choice" },
      { concept: "Product rule", outcome: "needs_review", activityType: "free_response" },
      { concept: "Chain rule", outcome: "secure", activityType: "free_response" },
    ])).toEqual({
      showingStrength: ["Chain rule"],
      needsAnotherCheck: ["Product rule"],
    });
  });

  it("deduplicates concept names without changing the learner-facing label", () => {
    expect(summarizeCompletionConcepts([
      { concept: "Cellular respiration", outcome: "secure", activityType: "multiple_choice" },
      { concept: "cellular respiration", outcome: "secure", activityType: "free_response" },
    ])).toEqual({
      showingStrength: ["Cellular respiration"],
      needsAnotherCheck: [],
    });
  });
});
