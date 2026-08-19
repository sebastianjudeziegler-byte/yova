import { beforeEach, describe, expect, it, vi } from "vitest";
import { PlanGenerationRequestSchema } from "@/lib/plan-generation/schema";
import { LIVE_AI_PLAN_FALLBACK_NOTICE } from "@/lib/plan-generation/fallback";

const mocks = vi.hoisted(() => ({
  generatePlan: vi.fn(),
  recordObservation: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/openai/plan-generator", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/openai/plan-generator")>();
  return { ...original, generatePlanWithOpenAI: mocks.generatePlan };
});
vi.mock("@/lib/openai/config", () => ({ isOpenAIPlanConfigured: () => true }));
vi.mock("@/lib/analytics/generation-observation-server", () => ({
  recordGenerationObservation: mocks.recordObservation,
}));
vi.mock("@/lib/server/rate-limit", () => ({
  checkPlanGenerationRateLimit: () => ({ allowed: true, retryAfterSeconds: 0 }),
  requestRateLimitKey: () => "plan-route-test",
}));
vi.mock("@/lib/server/development-preview", () => ({
  isDevelopmentPreviewRequest: () => true,
}));
vi.mock("@/lib/supabase/config", () => ({ isSupabaseConfigured: () => false }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: vi.fn() }));

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
    mocks.generatePlan.mockReset();
    mocks.recordObservation.mockReset();
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
});
