import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildSessionDeliveryPolicy } from "@/lib/personalization/session-delivery-policy";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({ parse: vi.fn() }));

vi.mock("@/lib/openai/client", () => ({
  getOpenAIClient: () => ({ responses: { parse: mocks.parse } }),
}));
vi.mock("@/lib/openai/config", () => ({
  getOpenAIAnswerEvaluationConfig: () => ({ model: "repair-model" }),
}));

import { generateRuntimeRepairWithOpenAI } from "@/lib/openai/runtime-repair-generator";

describe("runtime repair provider boundary", () => {
  beforeEach(() => {
    mocks.parse.mockReset().mockResolvedValue({
      status: "completed",
      output_parsed: {
        title: "Repair the product rule",
        supportHeading: "One focused correction",
        explanation: "Both factors contribute one derivative term in the final sum.",
        steps: ["Differentiate the first factor while keeping the second fixed."],
        retryPrompt: "Now state both terms of the product rule in one complete answer.",
        targetReminder: "The original product-rule target remains unchanged for this retry.",
      },
    });
  });

  it("disables SDK retries and finishes before the route deadline", async () => {
    await expect(generateRuntimeRepairWithOpenAI({
      planId: "22222222-2222-4222-8222-222222222222",
      planSessionId: "33333333-3333-4333-8333-333333333333",
      confidence: "very_sure",
      learnerAnswer: "Differentiate only the first factor.",
      evaluation: {
        feedback: "The second derivative term is missing from the response.",
        matchedIdeas: ["The first factor is differentiated."],
        missingIdeas: ["Both factors contribute one derivative term."],
      },
      activity: {
        title: "Apply the product rule",
        prompt: "Differentiate a product of two functions.",
        concept: "Product rule",
        referenceAnswer: "Differentiate each factor in turn, keep the other unchanged, and add both terms.",
        rubric: "A complete answer contains both derivative terms.",
      },
      deliveryPolicy: buildSessionDeliveryPolicy({
        learnerProfile: null,
        recentResults: [],
        recentInterruptions: [],
        learningMode: "study",
        estimatedMinutes: 20,
      }),
    })).resolves.toMatchObject({ mode: "direct_correction" });

    expect(mocks.parse).toHaveBeenCalledWith(
      expect.anything(),
      { maxRetries: 0, timeout: 30_000 },
    );
  });
});
