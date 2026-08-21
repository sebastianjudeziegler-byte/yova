import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildSessionDeliveryPolicy } from "@/lib/personalization/session-delivery-policy";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  evaluate: vi.fn(),
  repair: vi.fn(),
  reserve: vi.fn(),
  release: vi.fn(),
  releaseOperation: vi.fn(),
  settle: vi.fn(),
}));

vi.mock("@/lib/openai/answer-evaluator", () => ({
  evaluateAnswerWithOpenAI: mocks.evaluate,
}));
vi.mock("@/lib/openai/runtime-repair-generator", () => ({
  generateRuntimeRepairWithOpenAI: mocks.repair,
}));
vi.mock("@/lib/openai/config", () => ({
  isOpenAIAnswerEvaluationConfigured: () => true,
}));
vi.mock("@/lib/server/ai-usage", () => ({
  reserveAIRequest: mocks.reserve,
  releaseAIRequestClaim: mocks.release,
  releaseAIRequestReservation: mocks.releaseOperation,
  settleAIRequestClaim: mocks.settle,
}));
vi.mock("@/lib/server/development-preview", () => ({
  isDevelopmentPreviewRequest: () => false,
}));
vi.mock("@/lib/server/rate-limit", () => ({
  checkAnswerEvaluationRateLimit: () => ({ allowed: true, retryAfterSeconds: 0 }),
  requestRateLimitKey: () => "route-test",
}));
vi.mock("@/lib/server/session-operation-guard", () => ({
  verifyOperationalPlanSession: () => ({ allowed: true }),
}));
vi.mock("@/lib/supabase/config", () => ({ isSupabaseConfigured: () => true }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: mocks.createClient,
}));

import { POST as evaluateAnswer } from "@/app/api/sessions/evaluate/route";
import { POST as generateRepair } from "@/app/api/sessions/repair/route";

const CLAIM_ID = "55555555-5555-4555-8555-555555555555";

describe("answer evaluation and repair allowance lifecycle", () => {
  beforeEach(() => {
    const supabase = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "44444444-4444-4444-8444-444444444444" } },
          error: null,
        }),
      },
    };
    mocks.createClient.mockReset().mockResolvedValue(supabase);
    mocks.reserve.mockReset().mockResolvedValue({
      allowed: true,
      claimId: CLAIM_ID,
      retryAfterSeconds: 0,
      remainingToday: 9,
    });
    mocks.release.mockReset().mockResolvedValue(true);
    mocks.releaseOperation.mockReset().mockResolvedValue(false);
    mocks.settle.mockReset().mockResolvedValue(true);
    mocks.evaluate.mockReset().mockResolvedValue({
      verdict: "secure",
      feedback: "The explanation establishes the required relationship clearly.",
      matchedIdeas: ["The central relationship is accurate."],
      missingIdeas: [],
    });
    mocks.repair.mockReset().mockResolvedValue({
      title: "Repair the product-rule relationship",
      supportHeading: "One focused correction",
      explanation: "Both factors contribute one derivative term in the final sum.",
      steps: ["Differentiate the first factor while keeping the second fixed."],
      retryPrompt: "Now state both terms of the product rule in one complete answer.",
      targetReminder: "The original product-rule target remains unchanged for this retry.",
      mode: "direct_correction",
      modeLabel: "Direct correction",
      personalizationReason: "The response needs the missing relationship restored before another attempt.",
    });
  });

  it("settles a validated answer evaluation and does not release it", async () => {
    const response = await evaluateAnswer(jsonRequest("/api/sessions/evaluate", evaluationBody()));

    expect(response.status).toBe(200);
    expect(mocks.settle).toHaveBeenCalledWith(expect.anything(), CLAIM_ID);
    expect(mocks.release).not.toHaveBeenCalled();
  });

  it("releases the exact evaluation reservation when provider work fails", async () => {
    mocks.evaluate.mockRejectedValueOnce(new Error("provider unavailable"));

    const response = await evaluateAnswer(jsonRequest("/api/sessions/evaluate", evaluationBody()));

    expect(response.status).toBe(502);
    expect(mocks.release).toHaveBeenCalledWith(expect.anything(), CLAIM_ID);
    expect(mocks.settle).not.toHaveBeenCalled();
  });

  it("returns a valid evaluation when settlement cannot be confirmed", async () => {
    mocks.settle.mockRejectedValueOnce(new Error("settlement receipt lost"));

    const response = await evaluateAnswer(jsonRequest("/api/sessions/evaluate", evaluationBody()));

    expect(response.status).toBe(200);
    expect(mocks.release).not.toHaveBeenCalled();
  });

  it("settles a validated generated repair", async () => {
    const response = await generateRepair(jsonRequest("/api/sessions/repair", repairBody()));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ generation: { mode: "openai" } });
    expect(mocks.settle).toHaveBeenCalledWith(expect.anything(), CLAIM_ID);
    expect(mocks.release).not.toHaveBeenCalled();
  });

  it("releases failed repair generation before returning the system fallback", async () => {
    mocks.repair.mockRejectedValueOnce(new Error("provider unavailable"));

    const response = await generateRepair(jsonRequest("/api/sessions/repair", repairBody()));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ generation: { mode: "fallback" } });
    expect(mocks.release).toHaveBeenCalledWith(expect.anything(), CLAIM_ID);
    expect(mocks.settle).not.toHaveBeenCalled();
  });

  it("returns a valid repair when settlement cannot be confirmed", async () => {
    mocks.settle.mockRejectedValueOnce(new Error("settlement receipt lost"));

    const response = await generateRepair(jsonRequest("/api/sessions/repair", repairBody()));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ generation: { mode: "openai" } });
    expect(mocks.release).not.toHaveBeenCalled();
  });

  it.each([
    ["evaluation", evaluateAnswer, evaluationBody, mocks.evaluate],
    ["repair", generateRepair, repairBody, mocks.repair],
  ])("does not start %s provider work for a live operation-key replay", async (
    _label,
    route,
    body,
    provider,
  ) => {
    mocks.reserve.mockResolvedValueOnce({
      allowed: false,
      claimId: null,
      operationKey: "22222222-2222-4222-8222-222222222222",
      denialReason: "operation_in_progress",
      retryAfterSeconds: 41,
      remainingToday: 9,
    });

    const response = await route(jsonRequest("/api/sessions/test", body()));

    expect(response.status).toBe(409);
    expect(response.headers.get("Retry-After")).toBe("41");
    await expect(response.json()).resolves.toMatchObject({
      code: "ai_operation_in_progress",
      retryable: true,
    });
    expect(provider).not.toHaveBeenCalled();
    expect(mocks.release).not.toHaveBeenCalled();
    expect(mocks.settle).not.toHaveBeenCalled();
  });

  it("uses a fresh unexposed recovery key when the reserve receipt is unknown", async () => {
    mocks.reserve.mockRejectedValueOnce(new Error("reserve receipt lost"));

    const response = await evaluateAnswer(jsonRequest("/api/sessions/evaluate", evaluationBody()));

    expect(response.status).toBe(503);
    const operationKey = response.headers.get("X-Yova-Request-Id");
    expect(operationKey).toMatch(/^[0-9a-f-]{36}$/i);
    expect(mocks.releaseOperation).toHaveBeenCalledWith(
      expect.anything(),
      "answer_evaluation",
      operationKey,
      expect.stringMatching(/^[0-9a-f-]{36}$/i),
    );
    const recoveryKey = mocks.releaseOperation.mock.calls[0]?.[3];
    expect(recoveryKey).not.toBe(operationKey);
    expect(mocks.evaluate).not.toHaveBeenCalled();
  });
});

function jsonRequest(path: string, body: unknown) {
  return new Request(`https://yova.example${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function evaluationBody() {
  return {
    planId: "22222222-2222-4222-8222-222222222222",
    planSessionId: "33333333-3333-4333-8333-333333333333",
    learnerAnswer: "Differentiate each factor in turn and add both resulting terms.",
    activity: {
      title: "Apply the product rule",
      prompt: "Explain how to differentiate the product of two functions.",
      concept: "Product rule",
      referenceAnswer: "Differentiate each factor in turn, keep the other unchanged, and add both terms.",
      rubric: "A complete answer contains both derivative terms and explains why they are added.",
    },
  };
}

function repairBody() {
  return {
    ...evaluationBody(),
    confidence: "very_sure",
    learnerAnswer: "Differentiate only the first factor.",
    evaluation: {
      feedback: "The second derivative term is missing from the response.",
      matchedIdeas: ["The first factor is differentiated."],
      missingIdeas: ["Both factors contribute one derivative term."],
    },
    deliveryPolicy: buildSessionDeliveryPolicy({
      learnerProfile: null,
      recentResults: [],
      recentInterruptions: [],
      learningMode: "study",
      estimatedMinutes: 20,
    }),
  };
}
