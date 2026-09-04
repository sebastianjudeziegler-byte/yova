import { beforeEach, describe, expect, it, vi } from "vitest";
import { PlanKnowledgeMapSchema } from "@/lib/knowledge-map/schema";
import { PlanDiagnosticQuestionSchema } from "@/lib/plan-generation/schema";

const mocks = vi.hoisted(() => ({
  configured: true,
  createClient: vi.fn(),
  generateDiagnostic: vi.fn(),
  recordObservation: vi.fn(),
  rateLimit: vi.fn(),
  reserve: vi.fn(),
  release: vi.fn(),
  releaseOperation: vi.fn(),
  settle: vi.fn(),
  updateDiagnostic: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/analytics/generation-observation-server", () => ({
  recordGenerationObservation: mocks.recordObservation,
}));
vi.mock("@/lib/diagnostics/map-diagnostic", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/diagnostics/map-diagnostic")>();
  return { ...original, generateMapDiagnostic: mocks.generateDiagnostic };
});
vi.mock("@/lib/openai/config", () => ({
  getOpenAIKnowledgeMapConfig: () => mocks.configured ? { model: "diagnostic-model" } : null,
}));
vi.mock("@/lib/server/rate-limit", () => ({
  checkPlanGenerationRateLimit: mocks.rateLimit,
  requestRateLimitKey: () => "route-test",
}));
vi.mock("@/lib/server/ai-usage", () => ({
  reserveAIRequest: mocks.reserve,
  consumeAIRequestClaimAfterProviderFailure: mocks.release,
  refundAIRequestReservationBeforeProvider: mocks.releaseOperation,
  settleAIRequestClaim: mocks.settle,
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: mocks.createClient,
}));

import { GET, POST } from "@/app/api/plans/[planId]/diagnostic/route";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const PLAN_ID = "22222222-2222-4222-8222-222222222222";
const TOPIC_ID = "33333333-3333-4333-8333-333333333333";
const CLAIM_ID = "44444444-4444-4444-8444-444444444444";
const OPERATION_ID = "55555555-5555-4555-8555-555555555555";

const knowledgeMap = PlanKnowledgeMapSchema.parse({
  version: 1,
  scopeJudgment: {
    band: "focused_skill",
    label: "Focused skill",
    minimumSessions: 2,
    recommendedSessions: 3,
    maximumSessions: 4,
    minimumTeachingSessions: 1,
    explanation: "A bounded concept can be diagnosed and taught in a short sequence.",
  },
  topics: [{
    id: TOPIC_ID,
    title: "Supply and demand",
    description: "Explain how shifts in supply or demand change equilibrium price and quantity.",
    subtopics: [],
    prerequisiteTopicIds: [],
    status: "not_started",
    initialEvidence: null,
    sourceReferences: [],
    origin: "ai_generated",
    deferred: null,
  }],
  placementCheck: {
    status: "available",
    completedAt: null,
    demonstratedTopicIds: [],
    gapTopicIds: [],
  },
});

const question = PlanDiagnosticQuestionSchema.parse({
  id: "66666666-6666-4666-8666-666666666666",
  topicId: TOPIC_ID,
  prompt: "Which change would increase equilibrium price when supply stays fixed?",
  options: [
    "Demand increases",
    "Demand decreases",
    "Demand stays unchanged",
    "I don't know yet",
  ],
  correctAnswer: "Demand increases",
});

describe("standalone plan diagnostic allowance lifecycle", () => {
  beforeEach(() => {
    mocks.configured = true;
    mocks.createClient.mockReset().mockResolvedValue(supabaseClient());
    mocks.generateDiagnostic.mockReset().mockResolvedValue(generatedDiagnostic());
    mocks.recordObservation.mockReset().mockResolvedValue(undefined);
    mocks.rateLimit.mockReset().mockReturnValue({ allowed: true, retryAfterSeconds: 0 });
    mocks.reserve.mockReset().mockResolvedValue({
      allowed: true,
      claimId: CLAIM_ID,
      operationKey: OPERATION_ID,
      reservationState: "reserved",
      replayed: false,
      retryAfterSeconds: 0,
      remainingToday: 4,
    });
    mocks.release.mockReset().mockResolvedValue(true);
    mocks.releaseOperation.mockReset().mockResolvedValue(false);
    mocks.settle.mockReset().mockResolvedValue(true);
    mocks.updateDiagnostic.mockReset().mockResolvedValue({ data: true, error: null });
  });

  it("shares the planning gate and settles only after a validated diagnostic exists", async () => {
    const response = await GET(diagnosticRequest(), routeContext());

    expect(response.status).toBe(200);
    expect(response.headers.get("X-Yova-Request-Id")).toBe(OPERATION_ID);
    await expect(response.json()).resolves.toMatchObject({
      questions: [{ topicId: TOPIC_ID }],
      requestId: OPERATION_ID,
    });
    expect(mocks.rateLimit).toHaveBeenCalledWith(`${USER_ID}:route-test`);
    expect(mocks.reserve).toHaveBeenCalledWith(
      expect.anything(),
      "plan_generation",
      OPERATION_ID,
      expect.stringMatching(/^[0-9a-f-]{36}$/),
    );
    expect(mocks.reserve.mock.calls[0]?.[3]).not.toBe(OPERATION_ID);
    expect(mocks.reserve.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.generateDiagnostic.mock.invocationCallOrder[0],
    );
    expect(mocks.settle).toHaveBeenCalledWith(expect.anything(), CLAIM_ID);
    expect(mocks.release).not.toHaveBeenCalled();
  });

  it("consumes the exact claim when provider generation fails, even if telemetry also fails", async () => {
    mocks.generateDiagnostic.mockRejectedValueOnce(new Error("provider unavailable"));
    mocks.recordObservation.mockRejectedValueOnce(new Error("telemetry unavailable"));

    const response = await GET(diagnosticRequest(), routeContext());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "YOVA could not prepare this placement check yet.",
    });
    expect(mocks.release).toHaveBeenCalledWith(expect.anything(), CLAIM_ID);
    expect(mocks.generateDiagnostic.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.release.mock.invocationCallOrder[0]!);
    expect(mocks.settle).not.toHaveBeenCalled();
  });

  it("consumes the paid attempt for an unusable provider result", async () => {
    mocks.generateDiagnostic.mockResolvedValueOnce({
      ...generatedDiagnostic(),
      questions: [],
    });

    const response = await GET(diagnosticRequest(), routeContext());

    expect(response.status).toBe(503);
    expect(mocks.release).toHaveBeenCalledWith(expect.anything(), CLAIM_ID);
    expect(mocks.generateDiagnostic.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.release.mock.invocationCallOrder[0]!);
    expect(mocks.settle).not.toHaveBeenCalled();
  });

  it("keeps a validated diagnostic usable when settlement or telemetry receipts fail", async () => {
    mocks.settle.mockRejectedValueOnce(new Error("settlement receipt lost"));
    mocks.recordObservation.mockRejectedValueOnce(new Error("telemetry unavailable"));
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await GET(diagnosticRequest(), routeContext());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ requestId: OPERATION_ID });
    expect(mocks.release).not.toHaveBeenCalled();
    errorLog.mockRestore();
  });

  it("returns the quota reset delay without starting provider work", async () => {
    mocks.reserve.mockResolvedValueOnce({
      allowed: false,
      claimId: null,
      operationKey: OPERATION_ID,
      denialReason: "usage_limit",
      retryAfterSeconds: 1_800,
      remainingToday: 0,
    });

    const response = await GET(diagnosticRequest(), routeContext());

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("1800");
    expect(mocks.generateDiagnostic).not.toHaveBeenCalled();
    expect(mocks.release).not.toHaveBeenCalled();
    expect(mocks.settle).not.toHaveBeenCalled();
  });

  it("distinguishes an in-progress idempotent replay from quota exhaustion", async () => {
    mocks.reserve.mockResolvedValueOnce({
      allowed: false,
      claimId: null,
      operationKey: OPERATION_ID,
      denialReason: "operation_in_progress",
      retryAfterSeconds: 19,
      remainingToday: 3,
    });

    const response = await GET(diagnosticRequest(), routeContext());

    expect(response.status).toBe(409);
    expect(response.headers.get("Retry-After")).toBe("19");
    await expect(response.json()).resolves.toMatchObject({
      code: "ai_operation_in_progress",
      retryable: true,
    });
    expect(mocks.generateDiagnostic).not.toHaveBeenCalled();
  });

  it("recovers an ambiguous reservation with the private key and never calls the provider", async () => {
    mocks.reserve.mockRejectedValueOnce(new Error("reservation receipt lost"));

    const response = await GET(diagnosticRequest(), routeContext());

    expect(response.status).toBe(503);
    expect(mocks.releaseOperation).toHaveBeenCalledWith(
      expect.anything(),
      "plan_generation",
      OPERATION_ID,
      expect.stringMatching(/^[0-9a-f-]{36}$/),
    );
    expect(mocks.releaseOperation.mock.calls[0]?.[3]).not.toBe(OPERATION_ID);
    expect(mocks.generateDiagnostic).not.toHaveBeenCalled();
  });

  it("rate-limits before reserving or starting provider work", async () => {
    mocks.rateLimit.mockReturnValueOnce({ allowed: false, retryAfterSeconds: 12 });

    const response = await GET(diagnosticRequest(), routeContext());

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("12");
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.generateDiagnostic).not.toHaveBeenCalled();
  });

  it("keeps deterministic preview diagnostics outside the AI allowance", async () => {
    mocks.configured = false;
    mocks.generateDiagnostic.mockResolvedValueOnce({
      ...generatedDiagnostic(),
      stats: { ...generatedDiagnostic().stats, attempts: 0, model: null },
    });

    const response = await GET(diagnosticRequest(), routeContext());

    expect(response.status).toBe(200);
    expect(mocks.rateLimit).not.toHaveBeenCalled();
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.settle).not.toHaveBeenCalled();
  });

  it("saves placement evidence through the bounded knowledge-map RPC", async () => {
    const response = await POST(new Request(
      `https://yova.example/api/plans/${PLAN_ID}/diagnostic`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questions: [question], answers: ["Demand increases"] }),
      },
    ), routeContext());

    expect(response.status).toBe(200);
    expect(mocks.updateDiagnostic).toHaveBeenCalledWith(
      "update_plan_diagnostic_knowledge_map_v1",
      {
        requested_plan_id: PLAN_ID,
        requested_knowledge_map: expect.objectContaining({
          version: 1,
          placementCheck: expect.objectContaining({ status: "completed" }),
        }),
      },
    );
  });
});

function diagnosticRequest() {
  return new Request(`https://yova.example/api/plans/${PLAN_ID}/diagnostic`, {
    headers: { "X-Yova-Request-Id": OPERATION_ID },
  });
}

function routeContext() {
  return { params: Promise.resolve({ planId: PLAN_ID }) };
}

function generatedDiagnostic() {
  return {
    questions: [question],
    stats: {
      elapsedMs: 250,
      attempts: 1,
      inputTokens: 100,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 80,
      firstAttemptPassed: true,
      failedValidator: null,
      model: "diagnostic-model",
    },
  };
}

function supabaseClient() {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: USER_ID } },
        error: null,
      }),
    },
    from: vi.fn((table: string) => {
      if (table === "plans") {
        return selectQuery({ knowledge_map: knowledgeMap, learning_item_id: "item-1" });
      }
      if (table === "learning_items") {
        return selectQuery({ title: "Economics exam", topic: "Supply and demand" });
      }
      if (table === "plan_sessions") {
        return listQuery([]);
      }
      throw new Error(`Unexpected table ${table}`);
    }),
    rpc: mocks.updateDiagnostic,
  };
}

function selectQuery(data: unknown) {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error: null }),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  return query;
}

function listQuery(data: unknown[]) {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    in: vi.fn().mockResolvedValue({ data, error: null }),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  return query;
}
