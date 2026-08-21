import { beforeEach, describe, expect, it, vi } from "vitest";
import { PlanGenerationRequestSchema } from "@/lib/plan-generation/schema";
import { LIVE_AI_PLAN_FALLBACK_NOTICE } from "@/lib/plan-generation/fallback";

const mocks = vi.hoisted(() => ({
  generatePlan: vi.fn(),
  generateKnowledgeMap: vi.fn(),
  generateDiagnostic: vi.fn(),
  recordObservation: vi.fn(),
  rateLimit: vi.fn(),
  developmentPreview: true,
  supabaseConfigured: false,
  createClient: vi.fn(),
  reserve: vi.fn(),
  release: vi.fn(),
  releaseOperation: vi.fn(),
  settle: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/openai/plan-generator", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/openai/plan-generator")>();
  return { ...original, generatePlanWithOpenAI: mocks.generatePlan };
});
vi.mock("@/lib/knowledge-map/generate-plan-map", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/knowledge-map/generate-plan-map")>();
  return { ...original, generatePlanKnowledgeMap: mocks.generateKnowledgeMap };
});
vi.mock("@/lib/diagnostics/map-diagnostic", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/diagnostics/map-diagnostic")>();
  return { ...original, generateMapDiagnostic: mocks.generateDiagnostic };
});
vi.mock("@/lib/openai/config", () => ({ isOpenAIPlanConfigured: () => true }));
vi.mock("@/lib/analytics/generation-observation-server", () => ({
  recordGenerationObservation: mocks.recordObservation,
}));
vi.mock("@/lib/server/rate-limit", () => ({
  checkPlanGenerationRateLimit: mocks.rateLimit,
  requestRateLimitKey: () => "plan-route-test",
}));
vi.mock("@/lib/server/development-preview", () => ({
  isDevelopmentPreviewRequest: () => mocks.developmentPreview,
}));
vi.mock("@/lib/server/ai-usage", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/server/ai-usage")>();
  return {
    ...original,
    reserveAIRequest: mocks.reserve,
    releaseAIRequestClaim: mocks.release,
    releaseAIRequestReservation: mocks.releaseOperation,
    settleAIRequestClaim: mocks.settle,
  };
});
vi.mock("@/lib/supabase/config", () => ({
  isSupabaseConfigured: () => mocks.supabaseConfigured,
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: mocks.createClient,
}));

const TOPIC_ID = "11111111-1111-4111-8111-111111111111";
const planRequest = PlanGenerationRequestSchema.parse({
  intent: "plan",
  learningIntent: "learn",
  goal: "Learn derivative basics and apply the product rule accurately on a calculus unit test.",
  startingContext: "I need the concepts taught from the beginning.",
  materialMode: "none",
  materials: [],
  studyMode: "inside",
  deadline: null,
  timeZone: "UTC",
  diagnosticResponses: [],
  availability: [
    { day: "Every day", window: "Evening", minutes: 25 },
  ],
  profileSummary: "Use concise explanations and a worked example before independent practice.",
  knowledgeMap: {
    version: 1,
    scopeJudgment: {
      band: "focused_skill",
      label: "Focused skill",
      minimumSessions: 2,
      recommendedSessions: 3,
      maximumSessions: 4,
      minimumTeachingSessions: 1,
      explanation: "A bounded calculus skill fits a short sequence.",
    },
    topics: [{
      id: TOPIC_ID,
      title: "Product rule",
      description: "Differentiate products of two functions accurately.",
      subtopics: [],
      prerequisiteTopicIds: [],
      status: "not_started",
      initialEvidence: null,
      sourceReferences: [],
      origin: "ai_generated",
      deferred: null,
    }],
    placementCheck: {
      status: "skipped",
      completedAt: null,
      demonstratedTopicIds: [],
      gapTopicIds: [],
    },
  },
});

describe("plan generation provider failure", () => {
  beforeEach(() => {
    mocks.developmentPreview = true;
    mocks.supabaseConfigured = false;
    mocks.generatePlan.mockReset();
    mocks.generateKnowledgeMap.mockReset();
    mocks.generateDiagnostic.mockReset();
    mocks.recordObservation.mockReset().mockResolvedValue(undefined);
    mocks.rateLimit.mockReset().mockReturnValue({ allowed: true, retryAfterSeconds: 0 });
    mocks.createClient.mockReset();
    mocks.reserve.mockReset().mockResolvedValue({
      allowed: true,
      claimId: "55555555-5555-4555-8555-555555555555",
      retryAfterSeconds: 0,
      remainingToday: 9,
    });
    mocks.release.mockReset().mockResolvedValue(true);
    mocks.releaseOperation.mockReset().mockResolvedValue(false);
    mocks.settle.mockReset().mockResolvedValue(true);
  });

  it("returns a truthful retryable fallback and records only bounded diagnostics", async () => {
    const { OpenAIPlanGenerationError } = await import("@/lib/openai/plan-generator");
    const cause = Object.assign(new Error("private provider response"), {
      name: "APIConnectionTimeoutError",
      status: 408,
      code: "REQUEST_TIMEOUT",
    });
    mocks.generatePlan.mockRejectedValueOnce(new OpenAIPlanGenerationError(
      "The OpenAI request failed.",
      "provider_error",
      {
        elapsedMs: 40_000,
        attempts: 1,
        firstAttemptPassed: false,
        failedValidator: "plan_provider_request",
        repairAttempted: false,
        repairSucceeded: null,
        inputTokens: 100,
        cachedInputTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 0,
        model: "gpt-yova-test",
        validationIssueCode: null,
      },
      { category: "timeout", status: 408, code: "request_timeout" },
      cause,
    ));
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { POST } = await import("@/app/api/plans/generate/route");

    const response = await POST(new Request("http://localhost/api/plans/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(planRequest),
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.generation).toMatchObject({
      mode: "system",
      model: null,
      notice: LIVE_AI_PLAN_FALLBACK_NOTICE,
    });
    expect(body.generation.notice).toMatch(/^Live AI planning failed/);
    expect(mocks.recordObservation).toHaveBeenLastCalledWith(null, undefined, expect.objectContaining({
      finalOutcome: "fallback",
      model: "gpt-yova-test",
      diagnostics: expect.objectContaining({
        planFailureReason: "provider_error",
        providerCategory: "timeout",
        providerStatus: 408,
        providerCode: "request_timeout",
      }),
    }));
    const logged = JSON.stringify(errorLog.mock.calls);
    expect(logged).not.toContain("private provider response");
    errorLog.mockRestore();
  });

  it("releases a production reservation when plan generation falls back", async () => {
    configureProduction();
    mocks.generatePlan.mockRejectedValueOnce(new Error("provider unavailable"));
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { POST } = await import("@/app/api/plans/generate/route");

    const response = await POST(planGenerationRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ generation: { mode: "system" } });
    expect(mocks.release).toHaveBeenCalledWith(
      expect.anything(),
      "55555555-5555-4555-8555-555555555555",
    );
    expect(mocks.settle).not.toHaveBeenCalled();
    errorLog.mockRestore();
  });

  it("returns a validated plan when settlement cannot be confirmed", async () => {
    configureProduction();
    mocks.settle.mockRejectedValueOnce(new Error("settlement receipt lost"));
    mocks.generatePlan.mockResolvedValueOnce({
      draft: generatedDraft(),
      model: "gpt-yova-test",
      responseId: "response-1",
      generationStats: {
        elapsedMs: 1_000,
        attempts: 1,
        firstAttemptPassed: true,
        failedValidator: null,
        repairAttempted: false,
        repairSucceeded: null,
        inputTokens: 100,
        cachedInputTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 200,
        model: "gpt-yova-test",
        validationIssueCode: null,
      },
    });
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { POST } = await import("@/app/api/plans/generate/route");

    const response = await POST(planGenerationRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ generation: { mode: "openai" } });
    expect(mocks.release).not.toHaveBeenCalled();
    errorLog.mockRestore();
  });

  it("reserves before a placement check and settles only its validated response", async () => {
    configureProduction();
    mocks.generateDiagnostic.mockResolvedValueOnce(generatedDiagnostic());
    const { POST } = await import("@/app/api/plans/generate/route");

    const response = await POST(diagnosticGenerationRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      questions: [{ topicId: TOPIC_ID }],
      generation: { mode: "openai" },
    });
    expect(mocks.reserve).toHaveBeenCalledWith(
      expect.anything(),
      "plan_generation",
      expect.any(String),
      expect.any(String),
    );
    expect(mocks.reserve.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.generateDiagnostic.mock.invocationCallOrder[0],
    );
    expect(mocks.settle).toHaveBeenCalledWith(
      expect.anything(),
      "55555555-5555-4555-8555-555555555555",
    );
    expect(mocks.release).not.toHaveBeenCalled();
  });

  it("releases the reservation when a placement check cannot produce a usable response", async () => {
    configureProduction();
    mocks.generateDiagnostic.mockResolvedValueOnce({
      ...generatedDiagnostic(),
      questions: [],
    });
    const { POST } = await import("@/app/api/plans/generate/route");

    const response = await POST(diagnosticGenerationRequest());

    expect(response.status).toBe(503);
    expect(mocks.release).toHaveBeenCalledWith(
      expect.anything(),
      "55555555-5555-4555-8555-555555555555",
    );
    expect(mocks.settle).not.toHaveBeenCalled();
  });

  it("reserves before mapping a goal and releases when mapping fails", async () => {
    configureProduction();
    mocks.generateKnowledgeMap.mockRejectedValueOnce(new Error("provider unavailable"));
    const { POST } = await import("@/app/api/plans/generate/route");

    const response = await POST(planGenerationRequest({ knowledgeMap: undefined }));

    expect(response.status).toBe(503);
    expect(mocks.reserve.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.generateKnowledgeMap.mock.invocationCallOrder[0],
    );
    expect(mocks.release).toHaveBeenCalledWith(
      expect.anything(),
      "55555555-5555-4555-8555-555555555555",
    );
    expect(mocks.generatePlan).not.toHaveBeenCalled();
    expect(mocks.settle).not.toHaveBeenCalled();
  });

  it("does not start a placement check when the in-memory rate limit is exhausted", async () => {
    configureProduction();
    mocks.rateLimit.mockReturnValueOnce({ allowed: false, retryAfterSeconds: 17 });
    const { POST } = await import("@/app/api/plans/generate/route");

    const response = await POST(diagnosticGenerationRequest());

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("17");
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.generateDiagnostic).not.toHaveBeenCalled();
  });

  it("releases by operation key and does not call the provider when reservation status is unknown", async () => {
    configureProduction();
    mocks.reserve.mockRejectedValueOnce(new Error("reservation receipt lost"));
    const { POST } = await import("@/app/api/plans/generate/route");

    const response = await POST(diagnosticGenerationRequest());

    expect(response.status).toBe(503);
    expect(mocks.releaseOperation).toHaveBeenCalledWith(
      expect.anything(),
      "plan_generation",
      expect.stringMatching(/^[0-9a-f-]{36}$/),
      expect.stringMatching(/^[0-9a-f-]{36}$/),
    );
    const operationKey = mocks.releaseOperation.mock.calls[0]?.[2];
    const recoveryKey = mocks.releaseOperation.mock.calls[0]?.[3];
    expect(operationKey).toBe(response.headers.get("X-Yova-Request-Id"));
    expect(recoveryKey).not.toBe(operationKey);
    expect(mocks.generateDiagnostic).not.toHaveBeenCalled();
    expect(mocks.settle).not.toHaveBeenCalled();
  });

  it.each([
    {
      denialReason: "operation_in_progress",
      retryAfterSeconds: 11,
      code: "ai_operation_in_progress",
      retryable: true,
      expectedRetryAfter: "11",
    },
    {
      denialReason: "operation_already_consumed",
      retryAfterSeconds: 0,
      code: "ai_operation_already_consumed",
      retryable: false,
      expectedRetryAfter: null,
    },
    {
      denialReason: "operation_already_released",
      retryAfterSeconds: 0,
      code: "ai_operation_already_released",
      retryable: false,
      expectedRetryAfter: null,
    },
  ])("returns a non-quota conflict for $denialReason without calling the provider", async ({
    denialReason,
    retryAfterSeconds,
    code,
    retryable,
    expectedRetryAfter,
  }) => {
    configureProduction();
    mocks.reserve.mockResolvedValueOnce({
      allowed: false,
      claimId: null,
      operationKey: "66666666-6666-4666-8666-666666666666",
      denialReason,
      retryAfterSeconds,
      remainingToday: 8,
    });
    const { POST } = await import("@/app/api/plans/generate/route");

    const response = await POST(diagnosticGenerationRequest());

    expect(response.status).toBe(409);
    expect(response.headers.get("Retry-After")).toBe(expectedRetryAfter);
    await expect(response.json()).resolves.toMatchObject({ code, retryable });
    expect(mocks.generateKnowledgeMap).not.toHaveBeenCalled();
    expect(mocks.generateDiagnostic).not.toHaveBeenCalled();
    expect(mocks.generatePlan).not.toHaveBeenCalled();
    expect(mocks.release).not.toHaveBeenCalled();
    expect(mocks.settle).not.toHaveBeenCalled();
  });

  it("does not let synchronous analytics failure suppress a validated plan", async () => {
    configureProduction();
    mocks.recordObservation.mockImplementationOnce(() => {
      throw new Error("analytics unavailable");
    });
    mocks.generatePlan.mockResolvedValueOnce({
      draft: generatedDraft(),
      model: "gpt-yova-test",
      responseId: "response-1",
      generationStats: generatedStats(),
    });
    const { POST } = await import("@/app/api/plans/generate/route");

    const response = await POST(planGenerationRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ generation: { mode: "openai" } });
  });
});

function configureProduction() {
  mocks.developmentPreview = false;
  mocks.supabaseConfigured = true;
  mocks.createClient.mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: "44444444-4444-4444-8444-444444444444" } },
        error: null,
      }),
    },
  });
}

function planGenerationRequest(overrides: Record<string, unknown> = {}) {
  return new Request("http://localhost/api/plans/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...planRequest, ...overrides }),
  });
}

function diagnosticGenerationRequest() {
  return new Request("http://localhost/api/plans/generate?mode=diagnostic", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(planRequest),
  });
}

function generatedDiagnostic() {
  return {
    questions: [{
      id: "22222222-2222-4222-8222-222222222222",
      topicId: TOPIC_ID,
      prompt: "Which statement correctly describes the product rule?",
      options: [
        "Differentiate each factor and add the two cross terms.",
        "Differentiate only the first factor.",
        "Multiply both derivatives together.",
        "I don't know yet",
      ],
      correctAnswer: "Differentiate each factor and add the two cross terms.",
    }],
    stats: {
      ...generatedStats(),
      repairAttempted: undefined,
      repairSucceeded: undefined,
      validationIssueCode: undefined,
    },
  };
}

function generatedStats() {
  return {
    elapsedMs: 1_000,
    attempts: 1,
    firstAttemptPassed: true,
    failedValidator: null,
    repairAttempted: false,
    repairSucceeded: null,
    inputTokens: 100,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 200,
    model: "gpt-yova-test",
    validationIssueCode: null,
  };
}

function generatedDraft() {
  return {
    title: "Product rule foundations",
    topic: "Differentiating products of functions",
    kind: "skill" as const,
    deadline: null,
    rationale: "Build the complete product-rule model before checking whether it can be applied independently.",
    deferredTopics: [],
    sessions: [{
      title: "Build the product rule model",
      objective: "Explain why differentiating a product requires two derivative terms.",
      method: "Guided explanation",
      methodReason: "A connected model establishes the relationship before independent application.",
      scheduledFor: "2026-08-22T18:00:00.000Z",
      estimatedMinutes: 25,
      amountLabel: "One model and one explanation check",
      learningMode: "learn" as const,
      topicIds: [TOPIC_ID],
      contentTargets: ["Why each factor contributes a derivative term"],
      completionEvidence: ["Explain both product-rule terms in your own words"],
    }],
  };
}
