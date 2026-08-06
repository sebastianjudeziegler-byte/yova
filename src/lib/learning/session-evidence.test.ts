import { describe, expect, it } from "vitest";
import {
  buildImmediateRepairAfterMiss,
  buildImmediateRepairSteps,
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
  it("turns a miss into an explain-back repair without claiming mastery", () => {
    const repairs = buildImmediateRepairSteps(steps, { 0: false, 1: true });

    expect(repairs).toHaveLength(1);
    expect(repairs[0]).toMatchObject({
      type: "free_response",
      concept: "Product rule",
      evidenceRole: "immediate_repair",
    });
    expect(repairs[0].body).toContain("check it again later");
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
});

describe("summarizeSessionEvidence", () => {
  it("does not turn an immediate retry into durable evidence", () => {
    const repair = buildImmediateRepairSteps(steps, { 0: false, 1: true })[0];
    const summary = summarizeSessionEvidence(
      [...steps, repair],
      { 0: false, 1: true, 2: true },
      { 0: "very_sure", 1: "somewhat_sure" },
    );

    expect(summary).toMatchObject({
      correctAnswers: 1,
      totalAnswers: 2,
      observedGap: "Product rule",
      completedImmediateRepairs: 1,
    });
    expect(summary.conceptEvidence).toHaveLength(2);
    expect(summary.conceptEvidence[0]).toMatchObject({
      concept: "Product rule",
      outcome: "needs_review",
      methodPhase: "retrieve",
    });
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
});
