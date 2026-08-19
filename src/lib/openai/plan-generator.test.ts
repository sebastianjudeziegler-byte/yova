import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  GeneratedPlanDraftSchema,
  PlanGenerationRequestSchema,
} from "@/lib/plan-generation/schema";

const TOPIC_ID = "11111111-1111-4111-8111-111111111111";

const parseResponse = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("@/lib/openai/client", () => ({
  getOpenAIClient: () => ({ responses: { parse: parseResponse } }),
}));
vi.mock("@/lib/openai/config", () => ({
  getOpenAIPlanConfig: () => ({ model: "gpt-yova-test" }),
}));

const request = PlanGenerationRequestSchema.parse({
  intent: "study_now",
  learningIntent: "study",
  goal: "Review how cellular respiration produces ATP without using notes.",
  materialMode: "none",
  materials: [],
  studyMode: "inside",
  deadline: null,
  timeZone: "UTC",
  diagnosticResponses: [{
    question: "What can you do already?",
    answer: "I have learned the stages but need to test my recall.",
    evaluation: "self_report",
  }],
  availability: [{ day: "Monday", window: "Now", minutes: 15 }],
  profileSummary: "The learner wants concise corrections and one focused task at a time.",
});

function makeDraft(
  completionEvidence: string,
  rationale = "Begin without notes so the session exposes the exact relationship that needs repair.",
) {
  return GeneratedPlanDraftSchema.parse({
    title: "Cellular respiration review",
    topic: "How the stages of cellular respiration produce ATP",
    kind: "topic",
    deadline: null,
    rationale,
    deferredTopics: [],
    sessions: [{
      title: "Retrieve the respiration sequence",
      objective: "Reconstruct the major stages and explain how they contribute to ATP production.",
      method: "Retrieval practice",
      methodReason: "The learner has encountered the material and now needs unsupported evidence of recall.",
      scheduledFor: "2026-08-10T18:00:00.000Z",
      estimatedMinutes: 15,
      amountLabel: "One sequence reconstruction and one explanation check",
      learningMode: "study",
      topicIds: [TOPIC_ID],
      contentTargets: ["The sequence and contribution of each major stage"],
      completionEvidence: [completionEvidence],
    }],
  });
}

function providerResponse(id: string, outputParsed: unknown) {
  return {
    id,
    model: "gpt-yova-test",
    status: "completed",
    output: [],
    output_parsed: outputParsed,
  };
}

describe("OpenAI plan generation quality repair", () => {
  beforeEach(() => {
    parseResponse.mockReset();
  });

  it("returns a valid plan without spending a second request", async () => {
    parseResponse.mockResolvedValueOnce(providerResponse(
      "response-valid",
      makeDraft("Recall the complete sequence and explain one energy relationship without notes"),
    ));
    const { generatePlanWithOpenAI } = await import("@/lib/openai/plan-generator");

    const result = await generatePlanWithOpenAI(request);

    expect(result.responseId).toBe("response-valid");
    expect(parseResponse).toHaveBeenCalledTimes(1);
    expect(parseResponse.mock.calls[0]?.[1]).toEqual({
      maxRetries: 0,
      timeout: 40_000,
    });
  });

  it("gives OpenAI one specific repair attempt after an educational-quality failure", async () => {
    parseResponse
      .mockResolvedValueOnce(providerResponse("response-fixed-claim", makeDraft(
        "Recall the complete sequence without notes",
        "Because you have ADHD, diagrams are the only format that can work.",
      )))
      .mockResolvedValueOnce(providerResponse(
        "response-repaired",
        makeDraft("Recall the complete sequence and explain one energy relationship without notes"),
      ));
    const { generatePlanWithOpenAI } = await import("@/lib/openai/plan-generator");

    const result = await generatePlanWithOpenAI(request);

    expect(result.responseId).toBe("response-repaired");
    expect(parseResponse).toHaveBeenCalledTimes(2);
    expect(parseResponse.mock.calls[1]?.[0]?.instructions).toMatch(/repair attempt[\s\S]*unsupported fixed learning-style/i);
    expect(parseResponse.mock.calls[1]?.[1]).toEqual({
      maxRetries: 0,
      timeout: 55_000,
    });
  });

  it("stops safely when the repaired plan still fails", async () => {
    parseResponse
      .mockResolvedValueOnce(providerResponse("response-fixed-claim-1", makeDraft(
        "Recall the complete sequence without notes",
        "Because you have ADHD, diagrams are the only format that can work.",
      )))
      .mockResolvedValueOnce(providerResponse("response-fixed-claim-2", makeDraft(
        "Recall the complete sequence without notes",
        "The diagnosis proves that diagrams are the only useful format.",
      )));
    const { generatePlanWithOpenAI } = await import("@/lib/openai/plan-generator");

    await expect(generatePlanWithOpenAI(request)).rejects.toMatchObject({
      reason: "invalid_output",
      providerError: null,
      generationStats: {
        model: "gpt-yova-test",
        validationIssueCode: "unsupported_claim",
      },
    });
    expect(parseResponse).toHaveBeenCalledTimes(2);
  });

  it("preserves only bounded provider diagnostics while retaining the cause for server handling", async () => {
    const providerError = Object.assign(new Error("private upstream response text"), {
      name: "RateLimitError",
      status: 429,
      code: "RATE_LIMIT_EXCEEDED",
      response: { body: "private learner content" },
    });
    parseResponse.mockRejectedValueOnce(providerError);
    const { generatePlanWithOpenAI } = await import("@/lib/openai/plan-generator");

    let received: unknown;
    try {
      await generatePlanWithOpenAI(request);
    } catch (error) {
      received = error;
    }

    expect(received).toMatchObject({
      reason: "provider_error",
      providerError: {
        category: "rate_limit",
        status: 429,
        code: "rate_limit_exceeded",
      },
      generationStats: {
        model: "gpt-yova-test",
        validationIssueCode: null,
      },
    });
    expect((received as Error).cause).toBe(providerError);
    expect(JSON.stringify((received as { providerError: unknown }).providerError)).not.toContain("private");
  });
});
