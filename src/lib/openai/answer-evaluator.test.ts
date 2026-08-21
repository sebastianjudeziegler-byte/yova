import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AnswerEvaluationDraft, AnswerEvaluationRequest } from "@/lib/session-evaluation/schema";

const mocks = vi.hoisted(() => ({
  parse: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/openai/client", () => ({
  getOpenAIClient: () => ({ responses: { parse: mocks.parse } }),
}));
vi.mock("@/lib/openai/config", () => ({
  getOpenAIAnswerEvaluationConfig: () => ({
    apiKey: "test-key",
    model: "test-model",
  }),
}));

const request: AnswerEvaluationRequest = {
  planId: "11111111-1111-4111-8111-111111111111",
  planSessionId: "22222222-2222-4222-8222-222222222222",
  learnerAnswer: "I used Δx and घटना as written in my notes.",
  activity: {
    title: "Explain the relationship",
    prompt: "Explain how the local step contributes to the overall result.",
    concept: "Cause and effect",
    referenceAnswer: "The local step changes the intermediate value, which changes the final result.",
    rubric: "A secure response must connect the local change to its effect on the final result.",
  },
};

const leakedEvaluation: AnswerEvaluationDraft = {
  verdict: "needs_review",
  feedback: "Your response does not explain the effect beyond a local घटना.",
  matchedIdeas: ["You identified the local step."],
  missingIdeas: ["Connect the घटना to the final result."],
};

const repairedEvaluation: AnswerEvaluationDraft = {
  verdict: "needs_review",
  feedback: "Your response identifies the local step but does not explain its effect on the final result.",
  matchedIdeas: ["You identified the local step."],
  missingIdeas: ["Connect the local change to the final result."],
};

function completed(output: AnswerEvaluationDraft) {
  return { status: "completed", output_parsed: output };
}

describe("evaluateAnswerWithOpenAI output language", () => {
  beforeEach(() => {
    mocks.parse.mockReset();
  });

  it("retries Devanagari leakage and returns the repaired English evaluation", async () => {
    mocks.parse
      .mockResolvedValueOnce(completed(leakedEvaluation))
      .mockResolvedValueOnce(completed(repairedEvaluation));

    const { evaluateAnswerWithOpenAI } = await import("@/lib/openai/answer-evaluator");
    await expect(evaluateAnswerWithOpenAI(request)).resolves.toEqual(repairedEvaluation);

    expect(mocks.parse).toHaveBeenCalledTimes(2);
    const secondCall = mocks.parse.mock.calls[1]?.[0];
    expect(secondCall.input).toContain("Regenerate the evaluation");
    expect(secondCall.input).toContain(request.learnerAnswer);
  });

  it("returns deterministic English copy when the repair still leaks another script", async () => {
    mocks.parse
      .mockResolvedValueOnce(completed(leakedEvaluation))
      .mockResolvedValueOnce(completed(leakedEvaluation));

    const { evaluateAnswerWithOpenAI } = await import("@/lib/openai/answer-evaluator");
    const result = await evaluateAnswerWithOpenAI(request);

    expect(result).toEqual({
      verdict: "needs_review",
      feedback: "Your response does not yet establish the full relationship required by this check. Compare it with the reference answer and add the central missing idea.",
      matchedIdeas: [],
      missingIdeas: ["The central relationship from the reference answer is not yet established."],
    });
    expect(JSON.stringify(result)).not.toContain("घटना");
  });

  it("does not retry legitimate mathematical notation", async () => {
    const mathematicalEvaluation: AnswerEvaluationDraft = {
      verdict: "secure",
      feedback: "Your use of Δx / Δt correctly establishes the rate of change.",
      matchedIdeas: ["The response correctly relates θ and π to the calculation."],
      missingIdeas: [],
    };
    mocks.parse.mockResolvedValueOnce(completed(mathematicalEvaluation));

    const { evaluateAnswerWithOpenAI } = await import("@/lib/openai/answer-evaluator");
    await expect(evaluateAnswerWithOpenAI(request)).resolves.toEqual(mathematicalEvaluation);
    expect(mocks.parse).toHaveBeenCalledTimes(1);
  });
});
