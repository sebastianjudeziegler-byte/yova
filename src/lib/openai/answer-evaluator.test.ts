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
  return { status: "completed", output_parsed: {
    ...output,
    assessment: {
      contextSufficient: true, contextReason: "The activity provides the relevant context.",
      criteria: [
        ...output.matchedIdeas.map(idea => ({ idea, required: true, status: "established" })),
        ...output.missingIdeas.map(idea => ({ idea, required: true, status: "missing" })),
      ],
    },
    ...("assessment" in output ? { assessment: output.assessment } : {}),
  } };
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
    expect(mocks.parse.mock.calls.map((call) => call[1])).toEqual([
      { maxRetries: 0, timeout: 20_000 },
      { maxRetries: 0, timeout: 20_000 },
    ]);
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
    const result = await evaluateAnswerWithOpenAI(request);
    expect(result).toMatchObject({ verdict: "secure", matchedIdeas: mathematicalEvaluation.matchedIdeas, missingIdeas: [] });
    expect(result.feedback).toMatch(/θ.*π/);
    expect(mocks.parse).toHaveBeenCalledTimes(1);
  });
});

describe("answer evaluation calibration", () => {
  beforeEach(() => mocks.parse.mockReset());

  it("withholds secure evidence when the assessment lacks the required observations", async () => {
    mocks.parse.mockResolvedValue(completed({
      verdict: "secure", feedback: "The answer identifies changed conditions as the cause.",
      matchedIdeas: ["Conditions changed."], missingIdeas: [],
      ...{ assessment: { contextSufficient: false, contextReason: "The observations and changed condition are not supplied.", criteria: [{ idea: "Identify the changed condition.", required: true, status: "established" }] } },
    }));
    const { evaluateAnswerWithOpenAI } = await import("@/lib/openai/answer-evaluator");
    const result = await evaluateAnswerWithOpenAI(request);
    expect(result.verdict).toBe("uncertain");
    expect(result.feedback).toMatch(/observations|not supplied/i);
    expect(result.matchedIdeas).toEqual([]);
    expect(result.missingIdeas).toEqual([]);
  });

  it("does not call an under-specified response secure even when the provider verdict does", async () => {
    mocks.parse.mockResolvedValue(completed({
      verdict: "secure", feedback: "The answer establishes the main causal relationship.",
      matchedIdeas: ["The answer mentions conditions."], missingIdeas: [],
      ...{ assessment: { contextSufficient: true, contextReason: "The experiment is described.", criteria: [{ idea: "Connect oxygen availability to electron flow.", required: true, status: "unclear" }] } },
    }));
    const { evaluateAnswerWithOpenAI } = await import("@/lib/openai/answer-evaluator");
    const result = await evaluateAnswerWithOpenAI(request);
    expect(result.verdict).toBe("uncertain");
    expect(result.feedback).not.toMatch(/answer establishes/i);
  });

  it("returns no missing details for a complete answer when only optional reference facts are absent", async () => {
    mocks.parse.mockResolvedValue(completed({
      verdict: "secure", feedback: "Your answer is correct but is missing return unwinding.",
      matchedIdeas: ["The base case stops recursion."], missingIdeas: ["Earlier calls return."],
      ...{ assessment: { contextSufficient: true, contextReason: "The role of the base case is specified.", criteria: [
        { idea: "The base case stops recursion.", required: true, status: "established" },
        { idea: "Earlier calls return.", required: false, status: "missing" },
      ] } },
    }));
    const { evaluateAnswerWithOpenAI } = await import("@/lib/openai/answer-evaluator");
    const result = await evaluateAnswerWithOpenAI(request);
    expect(result.verdict).toBe("secure");
    expect(result.missingIdeas).toEqual([]);
    expect(result.matchedIdeas).toContain("The base case stops recursion.");
    expect(result.feedback).not.toMatch(/missing|unwinding/i);
  });

  it("does not let free-form feedback call a complete answer incomplete", async () => {
    mocks.parse.mockResolvedValue(completed({
      verdict: "secure", feedback: "Your answer is missing return unwinding, so add it next time.",
      matchedIdeas: ["The base case stops recursion."], missingIdeas: [],
      ...{ assessment: { contextSufficient: true, contextReason: "The role of the base case is specified.", criteria: [
        { idea: "The base case stops recursion.", required: true, status: "established" },
      ] } },
    }));
    const { evaluateAnswerWithOpenAI } = await import("@/lib/openai/answer-evaluator");
    const result = await evaluateAnswerWithOpenAI(request);
    expect(result.verdict).toBe("secure");
    expect(result.feedback).not.toMatch(/missing|unwinding|add it/i);
    expect(result.feedback).toMatch(/base case|recursion/i);
  });

  it("keeps a genuinely missing required idea visible and prevents secure evidence", async () => {
    mocks.parse.mockResolvedValue(completed({
      verdict: "secure", feedback: "The answer establishes all the required ideas.", matchedIdeas: [], missingIdeas: [],
      ...{ assessment: { contextSufficient: true, contextReason: "The taxation question has enough context.", criteria: [{ idea: "Colonists disputed taxation without representation.", required: true, status: "missing" }] } },
    }));
    const { evaluateAnswerWithOpenAI } = await import("@/lib/openai/answer-evaluator");
    const result = await evaluateAnswerWithOpenAI(request);
    expect(result.verdict).toBe("needs_review");
    expect(result.missingIdeas).toContain("Colonists disputed taxation without representation.");
    expect(result.feedback).not.toMatch(/establishes all/i);
  });
});
