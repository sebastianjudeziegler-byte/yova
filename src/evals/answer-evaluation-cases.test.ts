import { describe, expect, test } from "vitest";
import { answerEvaluationCases } from "@/evals/answer-evaluation-cases";
import { AnswerEvaluationRequestSchema } from "@/lib/session-evaluation/schema";

describe("answer evaluation benchmark", () => {
  test("keeps unique, valid cases with a human label", () => {
    expect(answerEvaluationCases.length).toBeGreaterThanOrEqual(7);
    expect(new Set(answerEvaluationCases.map(({ id }) => id)).size).toBe(answerEvaluationCases.length);

    for (const evaluationCase of answerEvaluationCases) {
      expect(AnswerEvaluationRequestSchema.safeParse(evaluationCase.request).success).toBe(true);
      expect(evaluationCase.expectedVerdicts.length).toBeGreaterThan(0);
      expect(evaluationCase.humanRationale.length).toBeGreaterThan(30);
    }
  });

  test("covers secure, review, and uncertain judgments", () => {
    const verdicts = new Set(answerEvaluationCases.flatMap(({ expectedVerdicts }) => expectedVerdicts));
    expect(verdicts).toEqual(new Set(["secure", "needs_review", "uncertain"]));
  });
});
