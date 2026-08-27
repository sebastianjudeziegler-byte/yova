import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlanKnowledgeMap } from "@/lib/knowledge-map/schema";
import {
  composeNormalPlanEnvelopes,
  type NormalPlanDurationContext,
} from "@/lib/plan-generation/normal-plan-envelopes";
import {
  buildNormalPlanFallbackFill,
  normalPlanEvidenceSlotIds,
} from "@/lib/plan-generation/normal-plan-provider-fill";
import {
  buildNormalPlanProviderFillInput,
  NORMAL_PLAN_PROVIDER_FILL_INSTRUCTIONS,
} from "@/lib/plan-generation/normal-plan-provider-prompt";
import {
  PlanGenerationRequestSchema,
  type PlanGenerationRequest,
} from "@/lib/plan-generation/schema";

const parseResponse = vi.hoisted(() => vi.fn());
const getPlanConfig = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("@/lib/openai/client", () => ({
  getOpenAIClient: () => ({ responses: { parse: parseResponse } }),
}));
vi.mock("@/lib/openai/config", () => ({
  getOpenAIPlanConfig: getPlanConfig,
}));

const NOW = new Date("2026-08-10T08:00:00.000Z");
const IDS = [
  "70000000-7000-4000-8000-000000000001",
  "70000000-7000-4000-8000-000000000002",
] as const;

describe("one-call normal-plan provider fill", () => {
  beforeEach(() => {
    parseResponse.mockReset();
    getPlanConfig.mockReset();
    getPlanConfig.mockReturnValue({ model: "gpt-yova-fill-test" });
  });

  it("sends the exact dynamic prose slots and returns a valid fill in one call", async () => {
    const contract = normalContract();
    const fill = buildNormalPlanFallbackFill(contract);
    parseResponse.mockResolvedValueOnce(providerResponse("response-fill", fill, {
      input_tokens: 321,
      input_tokens_details: { cached_tokens: 120, cache_write_tokens: 7 },
      output_tokens: 456,
    }));
    const {
      generateNormalPlanFillWithOpenAI,
      NORMAL_PLAN_FILL_MAX_OUTPUT_TOKENS,
      NORMAL_PLAN_FILL_PROVIDER_TIMEOUT_MS,
    } = await import("@/lib/openai/normal-plan-fill-generator");

    const result = await generateNormalPlanFillWithOpenAI({ ...contract, now: NOW });

    expect(result).toMatchObject({
      fill,
      model: "gpt-yova-fill-test",
      responseId: "response-fill",
      generationStats: {
        attempts: 1,
        firstAttemptPassed: true,
        failedValidator: null,
        repairAttempted: false,
        repairSucceeded: null,
        inputTokens: 321,
        cachedInputTokens: 120,
        cacheWriteTokens: 7,
        outputTokens: 456,
        model: "gpt-yova-fill-test",
        validationIssueCode: null,
      },
    });
    expect(parseResponse).toHaveBeenCalledTimes(1);
    const [body, requestOptions] = parseResponse.mock.calls[0]!;
    expect(body).toMatchObject({
      model: "gpt-yova-fill-test",
      instructions: NORMAL_PLAN_PROVIDER_FILL_INSTRUCTIONS,
      input: buildNormalPlanProviderFillInput({ ...contract, now: NOW }),
      reasoning: { effort: "low" },
      text: { verbosity: "low" },
      max_output_tokens: NORMAL_PLAN_FILL_MAX_OUTPUT_TOKENS,
      store: false,
    });
    expect(requestOptions).toEqual({
      maxRetries: 0,
      timeout: NORMAL_PLAN_FILL_PROVIDER_TIMEOUT_MS,
    });

    const prompt = JSON.parse(body.input as string) as {
      current_datetime_utc: string;
      fixed_composition: { fixed_envelopes: Array<{ envelope_id: string }> };
      response_contract: { sessions: Record<string, { evidence: Record<string, string> }> };
    };
    const expectedIds = contract.composition.envelopes.map((envelope) => envelope.envelopeId);
    expect(prompt.current_datetime_utc).toBe(NOW.toISOString());
    expect(prompt.fixed_composition.fixed_envelopes.map((slot) => slot.envelope_id)).toEqual(expectedIds);
    expect(Object.keys(prompt.response_contract.sessions)).toEqual(expectedIds);
    contract.composition.envelopes.forEach((envelope) => {
      expect(Object.keys(prompt.response_contract.sessions[envelope.envelopeId]!.evidence))
        .toEqual(normalPlanEvidenceSlotIds(envelope));
    });

    const format = body.text.format as {
      type: string;
      name: string;
      strict: boolean;
      schema: {
        properties: {
          sessions: {
            required: string[];
            properties: Record<string, {
              properties: { evidence: { required: string[] } };
            }>;
          };
        };
      };
    };
    expect(format).toMatchObject({
      type: "json_schema",
      name: "yova_normal_plan_fill",
      strict: true,
    });
    expect(format.schema.properties.sessions.required).toEqual(expectedIds);
    contract.composition.envelopes.forEach((envelope) => {
      expect(format.schema.properties.sessions.properties[envelope.envelopeId]!
        .properties.evidence.required).toEqual(normalPlanEvidenceSlotIds(envelope));
    });
  });

  it("rejects invalid output without making a repair request", async () => {
    const contract = normalContract();
    parseResponse.mockResolvedValueOnce(providerResponse("response-invalid", {}));
    const { generateNormalPlanFillWithOpenAI } = await import(
      "@/lib/openai/normal-plan-fill-generator"
    );

    await expect(generateNormalPlanFillWithOpenAI({ ...contract, now: NOW })).rejects.toMatchObject({
      name: "OpenAINormalPlanFillError",
      reason: "invalid_output",
      providerError: null,
      generationStats: {
        attempts: 1,
        firstAttemptPassed: false,
        failedValidator: "plan_structure",
        repairAttempted: false,
        repairSucceeded: null,
      },
    });
    expect(parseResponse).toHaveBeenCalledTimes(1);
  });

  it("treats a structured-output parser failure as invalid copy, not a second request", async () => {
    const contract = normalContract();
    const parseError = new SyntaxError("private malformed provider JSON");
    parseResponse.mockRejectedValueOnce(parseError);
    const { generateNormalPlanFillWithOpenAI } = await import(
      "@/lib/openai/normal-plan-fill-generator"
    );

    let received: unknown;
    try {
      await generateNormalPlanFillWithOpenAI({ ...contract, now: NOW });
    } catch (error) {
      received = error;
    }

    expect(received).toMatchObject({
      reason: "invalid_output",
      providerError: null,
      generationStats: {
        attempts: 1,
        failedValidator: "plan_structure",
        repairAttempted: false,
      },
    });
    expect((received as Error).message).not.toContain("private");
    expect((received as Error).cause).toBe(parseError);
    expect(parseResponse).toHaveBeenCalledTimes(1);
  });

  it("classifies a refusal without exposing its text or retrying", async () => {
    const contract = normalContract();
    parseResponse.mockResolvedValueOnce({
      ...providerResponse("response-refused", null),
      output: [{
        type: "message",
        content: [{ type: "refusal", refusal: "sensitive provider refusal detail" }],
      }],
    });
    const { generateNormalPlanFillWithOpenAI } = await import(
      "@/lib/openai/normal-plan-fill-generator"
    );

    let received: unknown;
    try {
      await generateNormalPlanFillWithOpenAI({ ...contract, now: NOW });
    } catch (error) {
      received = error;
    }

    expect(received).toMatchObject({
      reason: "refused",
      providerError: null,
      generationStats: {
        attempts: 1,
        failedValidator: "plan_response_status",
        repairAttempted: false,
      },
    });
    expect((received as Error).message).not.toContain("sensitive");
    expect(parseResponse).toHaveBeenCalledTimes(1);
  });

  it("classifies an incomplete response without a second call", async () => {
    const contract = normalContract();
    parseResponse.mockResolvedValueOnce({
      ...providerResponse("response-incomplete", null),
      status: "incomplete",
    });
    const { generateNormalPlanFillWithOpenAI } = await import(
      "@/lib/openai/normal-plan-fill-generator"
    );

    await expect(generateNormalPlanFillWithOpenAI({ ...contract, now: NOW })).rejects.toMatchObject({
      reason: "incomplete",
      providerError: null,
      generationStats: {
        attempts: 1,
        failedValidator: "plan_response_status",
        repairAttempted: false,
      },
    });
    expect(parseResponse).toHaveBeenCalledTimes(1);
  });

  it("reduces an upstream failure to bounded metadata and retains the server-side cause", async () => {
    const contract = normalContract();
    const providerError = Object.assign(new Error("private provider body with learner data"), {
      name: "RateLimitError",
      status: 429,
      code: "RATE_LIMIT_EXCEEDED",
      response: { body: "private provider body with learner data" },
    });
    parseResponse.mockRejectedValueOnce(providerError);
    const { generateNormalPlanFillWithOpenAI } = await import(
      "@/lib/openai/normal-plan-fill-generator"
    );

    let received: unknown;
    try {
      await generateNormalPlanFillWithOpenAI({ ...contract, now: NOW });
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
        attempts: 1,
        failedValidator: "plan_provider_request",
        repairAttempted: false,
      },
    });
    expect((received as Error).cause).toBe(providerError);
    expect(JSON.stringify((received as { providerError: unknown }).providerError)).not.toContain("private");
    expect(parseResponse).toHaveBeenCalledTimes(1);
  });

  it("caps the one provider timeout at the route deadline and accounts for usage", async () => {
    vi.useFakeTimers();
    const startedAt = new Date("2026-08-10T08:00:00.000Z");
    vi.setSystemTime(startedAt);
    const contract = normalContract();
    const fill = buildNormalPlanFallbackFill(contract);
    parseResponse.mockImplementationOnce(async () => {
      vi.setSystemTime(new Date(startedAt.getTime() + 275));
      return providerResponse("response-deadline", fill, {
        input_tokens: 91,
        input_tokens_details: { cached_tokens: 11, cache_write_tokens: 3 },
        output_tokens: 82,
      });
    });
    const { generateNormalPlanFillWithOpenAI } = await import(
      "@/lib/openai/normal-plan-fill-generator"
    );

    try {
      const result = await generateNormalPlanFillWithOpenAI(
        { ...contract, now: NOW },
        { deadlineAt: startedAt.getTime() + 12_500 },
      );

      expect(parseResponse.mock.calls[0]?.[1]).toEqual({
        maxRetries: 0,
        timeout: 12_500,
      });
      expect(result.generationStats).toMatchObject({
        elapsedMs: 275,
        attempts: 1,
        inputTokens: 91,
        cachedInputTokens: 11,
        cacheWriteTokens: 3,
        outputTokens: 82,
        repairAttempted: false,
        repairSucceeded: null,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports missing configuration as a typed provider failure without pretending to call", async () => {
    const contract = normalContract();
    getPlanConfig.mockReturnValueOnce(null);
    const { generateNormalPlanFillWithOpenAI } = await import(
      "@/lib/openai/normal-plan-fill-generator"
    );

    await expect(generateNormalPlanFillWithOpenAI({ ...contract, now: NOW })).rejects.toMatchObject({
      reason: "provider_error",
      providerError: null,
      generationStats: {
        attempts: 0,
        failedValidator: "plan_provider_request",
        model: null,
      },
    });
    expect(parseResponse).not.toHaveBeenCalled();
  });
});

function providerResponse(id: string, outputParsed: unknown, usage?: unknown) {
  return {
    id,
    model: "gpt-yova-fill-test",
    status: "completed",
    output: [],
    output_parsed: outputParsed,
    usage,
  };
}

function normalContract() {
  const request = normalRequest();
  const composition = composeNormalPlanEnvelopes({
    request,
    learningIntentRecommendation: {
      intent: request.learningIntent,
      basis: "The learner said this foundation is new.",
    },
    durationContext: durationContext(),
    now: NOW,
    searchDays: 1,
  });
  return { request, composition };
}

function normalRequest(): PlanGenerationRequest {
  const topics: PlanKnowledgeMap["topics"] = [
    {
      id: IDS[0],
      title: "Product rule model",
      description: "Explain why differentiating a product requires both derivative terms.",
      subtopics: [],
      prerequisiteTopicIds: [],
      status: "not_started",
      initialEvidence: null,
      sourceReferences: [],
      origin: "ai_generated",
      deferred: null,
    },
    {
      id: IDS[1],
      title: "Product rule application",
      description: "Apply the product rule accurately and explain each derivative term.",
      subtopics: [],
      prerequisiteTopicIds: [IDS[0]],
      status: "not_started",
      initialEvidence: null,
      sourceReferences: [],
      origin: "ai_generated",
      deferred: null,
    },
  ];
  return PlanGenerationRequestSchema.parse({
    intent: "plan",
    learningIntent: "learn",
    goal: "Learn the product rule and explain how derivatives of products work for a calculus test.",
    startingContext: "This material is new and needs to be taught from the beginning.",
    materialMode: "none",
    materials: [],
    studyMode: "inside",
    deadline: "2026-08-20T23:59:00.000Z",
    timeZone: "UTC",
    diagnosticResponses: [],
    availability: [{ day: "Monday", window: "Morning", minutes: 60 }],
    profileSummary: "Use concise explanations, bounded tasks, and one independent check after support.",
    knowledgeMap: {
      version: 1,
      scopeJudgment: {
        band: "focused_skill",
        label: "Focused calculus skill",
        minimumSessions: 2,
        recommendedSessions: 2,
        maximumSessions: 3,
        minimumTeachingSessions: 1,
        explanation: "A bounded calculus skill needs instruction followed by an independent check.",
      },
      topics,
      placementCheck: {
        status: "skipped",
        completedAt: null,
        demonstratedTopicIds: [],
        gapTopicIds: [],
      },
      curriculum: null,
    },
  });
}

function durationContext(): NormalPlanDurationContext {
  return {
    profileVersion: "authorized_profile_snapshot:normal-fill-generator-test-v1",
    profile: {
      sustainableMinutes: null,
      startingFrictionRisk: null,
      fatigueRisk: null,
      preferredWindow: null,
      evidenceRefs: {
        sustainableMinutes: [],
        startingFrictionRisk: [],
        fatigueRisk: [],
        preferredWindow: [],
      },
    },
    recentOutcomes: [],
  };
}
