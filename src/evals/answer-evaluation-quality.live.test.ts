import { describe, expect, test, vi } from "vitest";
import { answerEvaluationCases } from "@/evals/answer-evaluation-cases";

vi.mock("server-only", () => ({}));

const liveEvaluationEnabled = process.env.YOVA_RUN_LIVE_ANSWER_EVALS === "1";
const requestedCase = process.env.YOVA_ANSWER_EVAL_CASE?.trim();
const evaluationCases = answerEvaluationCases.filter(
  (evaluationCase) => !requestedCase || evaluationCase.id === requestedCase,
);

const forbiddenClaims = /\b(master(?:y|ed)|grade|diagnos(?:e|ed|is)|learning style)\b/i;

describe.skipIf(!liveEvaluationEnabled)("live OpenAI answer evaluation quality", () => {
  test("the requested case exists", () => {
    expect(evaluationCases.length, `Unknown YOVA_ANSWER_EVAL_CASE: ${requestedCase}`).toBeGreaterThan(0);
  });

  test.each(evaluationCases)("$label", async (evaluationCase) => {
    const { evaluateAnswerWithOpenAI } = await import("@/lib/openai/answer-evaluator");
    const result = await evaluateAnswerWithOpenAI(evaluationCase.request);

    console.info(`\nYOVA answer evaluation · ${evaluationCase.label}`);
    console.info(`Expected · ${evaluationCase.expectedVerdicts.join(" or ")}`);
    console.info(`Received · ${result.verdict}`);
    console.info(`Feedback · ${result.feedback}`);
    console.info(`Human label · ${evaluationCase.humanRationale}\n`);

    expect(evaluationCase.expectedVerdicts).toContain(result.verdict);
    expect(result.feedback).not.toMatch(forbiddenClaims);
    expect(result.feedback.length).toBeGreaterThanOrEqual(15);

    if (result.verdict === "secure") {
      expect(result.missingIdeas).toEqual([]);
      expect(result.matchedIdeas.length).toBeGreaterThan(0);
    }

    if (result.verdict === "needs_review") {
      expect(result.missingIdeas.length).toBeGreaterThan(0);
    }
  }, 90_000);
});
