import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LearningPlan, LearningPlanSession } from "@/lib/domain";
import { buildPreviewSessionContext } from "@/lib/session-generation/preview-context";
import type { SessionAdjustment } from "@/lib/session-generation/schema";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  developmentPreview: false,
  supabaseConfigured: true,
  createClient: vi.fn(),
  providerConfigured: vi.fn(),
  generate: vi.fn(),
  rateLimit: vi.fn(),
  reserve: vi.fn(),
  release: vi.fn(),
  releaseOperation: vi.fn(),
  settle: vi.fn(),
  recordObservation: vi.fn(),
}));

vi.mock("@/lib/analytics/generation-observation-server", () => ({
  recordGenerationObservationAfterResponse: mocks.recordObservation,
}));
vi.mock("@/lib/openai/config", () => ({
  getOpenAISessionConfig: () => ({ model: "route-test-model" }),
  isOpenAISessionConfigured: mocks.providerConfigured,
}));
vi.mock("@/lib/openai/session-generation-strategy", () => ({
  generateProductionSessionWithOpenAI: mocks.generate,
}));
vi.mock("@/lib/server/ai-usage", () => ({
  reserveAIRequest: mocks.reserve,
  releaseAIRequestClaim: mocks.release,
  releaseAIRequestReservation: mocks.releaseOperation,
  settleAIRequestClaim: mocks.settle,
}));
vi.mock("@/lib/server/development-preview", () => ({
  isDevelopmentPreviewRequest: () => mocks.developmentPreview,
}));
vi.mock("@/lib/server/rate-limit", () => ({
  checkSessionGenerationRateLimit: mocks.rateLimit,
  requestRateLimitKey: () => "scheduled-review-route-test",
}));
vi.mock("@/lib/supabase/config", () => ({
  isSupabaseConfigured: () => mocks.supabaseConfigured,
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: mocks.createClient,
}));

import { POST } from "@/app/api/sessions/generate/route";

const PLAN_ID = "71000000-0000-4000-8000-000000000001";
const SESSION_ID = "71000000-0000-4000-8000-000000000002";

const reviewSession: LearningPlanSession = {
  id: SESSION_ID,
  sequence: 1,
  title: "Verify mantle convection and plate motion",
  objective: "Retrieve the mantle-convection relationship after a delay.",
  method: "Independent retrieval verification",
  methodReason: "A short delayed check tests whether the relationship remains available.",
  scheduledFor: "2026-08-22T12:00:00.000Z",
  estimatedMinutes: 10,
  amountLabel: "Required guided verification · about 10 min",
  learningMode: "study",
  topicIds: [],
  contentTargets: [],
  completionEvidence: [],
  status: "ready",
  reviewConcept: "Mantle convection and plate motion",
  reviewType: "verify",
};

const plan: LearningPlan = {
  id: PLAN_ID,
  learningItemId: "71000000-0000-4000-8000-000000000003",
  title: "Plate motion review",
  topic: "Mantle convection and plate motion",
  kind: "topic",
  deadline: null,
  status: "active",
  sourceMode: "yova_generated",
  studyMode: "inside_yova",
  learningIntent: "study",
  rationale: "Return after a delay and check whether the core relationship remains available.",
  createdAt: "2026-08-20T12:00:00.000Z",
  sessions: [reviewSession],
};

const staleAdjustments: Array<[string, SessionAdjustment]> = [
  ["teaching-first", {
    familiarity: "need_teaching",
    availableMinutes: null,
    knownTargets: [],
    note: "Teach this before checking it.",
  }],
  ["time", {
    familiarity: "as_planned",
    availableMinutes: 30,
    knownTargets: [],
    note: "",
  }],
  ["support note", {
    familiarity: "as_planned",
    availableMinutes: null,
    knownTargets: [],
    note: "Give me extra hints before every answer.",
  }],
];

describe("scheduled-review route adjustment boundary", () => {
  beforeEach(() => {
    mocks.developmentPreview = false;
    mocks.supabaseConfigured = true;
    mocks.createClient.mockReset();
    mocks.providerConfigured.mockReset().mockReturnValue(true);
    mocks.generate.mockReset();
    mocks.rateLimit.mockReset().mockReturnValue({ allowed: true, retryAfterSeconds: 0 });
    mocks.reserve.mockReset();
    mocks.release.mockReset();
    mocks.releaseOperation.mockReset();
    mocks.settle.mockReset();
    mocks.recordObservation.mockReset();
  });

  it.each(staleAdjustments)(
    "rejects a stale browser-preview %s adjustment without rate, claim, or provider work",
    async (_label, sessionAdjustment) => {
      mocks.developmentPreview = true;
      mocks.supabaseConfigured = false;

      const response = await POST(request({
        planId: PLAN_ID,
        planSessionId: SESSION_ID,
        sessionAdjustment,
        previewContext: buildPreviewSessionContext({
          plan,
          session: reviewSession,
          onboardingAnswers: [],
          completions: [],
          interruptions: [],
        }),
      }));

      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toMatchObject({
        code: "scheduled_review_adjustment_not_supported",
        retryable: false,
      });
      expect(mocks.providerConfigured).not.toHaveBeenCalled();
      expect(mocks.rateLimit).not.toHaveBeenCalled();
      expect(mocks.reserve).not.toHaveBeenCalled();
      expect(mocks.generate).not.toHaveBeenCalled();
      expect(mocks.recordObservation).not.toHaveBeenCalled();
    },
  );

  it.each(staleAdjustments)(
    "rejects an authenticated stale %s adjustment before loading plan context or claiming allowance",
    async (_label, sessionAdjustment) => {
      const sessionQuery = queryReturning({
        id: SESSION_ID,
        plan_id: PLAN_ID,
        sequence: 1,
        status: "ready",
        title: reviewSession.title,
        objective: reviewSession.objective,
        method: reviewSession.method,
        method_rationale: reviewSession.methodReason,
        estimated_minutes: reviewSession.estimatedMinutes,
        step_data: {
          reviewType: reviewSession.reviewType,
          reviewConcept: reviewSession.reviewConcept,
          topicIds: [],
          contentTargets: [],
          completionEvidence: [],
        },
        updated_at: "2026-08-22T12:00:00.000Z",
      });
      const from = vi.fn().mockReturnValue(sessionQuery);
      mocks.createClient.mockResolvedValue({
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: { id: "71000000-0000-4000-8000-000000000004" } },
            error: null,
          }),
        },
        from,
      });

      const response = await POST(request({
        planId: PLAN_ID,
        planSessionId: SESSION_ID,
        sessionAdjustment,
      }));

      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toMatchObject({
        code: "scheduled_review_adjustment_not_supported",
        retryable: false,
      });
      expect(from).toHaveBeenCalledTimes(1);
      expect(from).toHaveBeenCalledWith("plan_sessions");
      expect(mocks.providerConfigured).not.toHaveBeenCalled();
      expect(mocks.rateLimit).not.toHaveBeenCalled();
      expect(mocks.reserve).not.toHaveBeenCalled();
      expect(mocks.generate).not.toHaveBeenCalled();
      expect(mocks.recordObservation).toHaveBeenCalledWith(
        expect.anything(),
        "71000000-0000-4000-8000-000000000004",
        expect.objectContaining({
          generationType: "session",
          finalOutcome: "failure",
          attempts: 0,
          inputTokens: 0,
          outputTokens: 0,
          diagnostics: expect.objectContaining({
            sessionGenerationStage: "preflight",
            sessionGenerationCause: "route_conflict",
          }),
        }),
      );
    },
  );
});

function request(body: unknown) {
  return new Request("https://yova.example/api/sessions/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function queryReturning(data: unknown) {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error: null }),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  return query;
}
