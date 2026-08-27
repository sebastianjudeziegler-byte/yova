import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LearningPlan } from "@/lib/domain";
import { normalizePlanDraftGenerationContract } from "@/lib/plan-generation/draft-contract";
import { PlanGenerationRequestSchema } from "@/lib/plan-generation/schema";
import { generatePreviewPlan } from "@/lib/plan-generation/preview-generator";
import { issuePlanDraftReceipt } from "@/lib/server/plan-draft-receipt";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  persist: vi.fn(),
  createClient: vi.fn(),
  loadDurationContext: vi.fn(),
}));

vi.mock("@/lib/supabase/config", () => ({ isSupabaseConfigured: () => true }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: mocks.createClient }));
vi.mock("@/lib/supabase/plan-repository", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/supabase/plan-repository")>();
  return { ...original, persistPlanForAuthenticatedUser: mocks.persist };
});
vi.mock("@/lib/study-route/duration-context-server", () => ({
  loadAuthorizedNormalDurationContext: mocks.loadDurationContext,
}));

import { POST } from "@/app/api/plans/activate/route";
import { PlanPersistenceError } from "@/lib/supabase/plan-repository";
import {
  reconcileStudyNowDuration,
  type StudyNowDurationContext,
} from "@/lib/study-route/study-now-duration";

const generationRequest = PlanGenerationRequestSchema.parse({
  intent: "study_now",
  learningIntent: "learn",
  goal: "Understand how the product rule differentiates two multiplied functions.",
  materialMode: "none",
  materials: [],
  studyMode: "inside",
  deadline: null,
  timeZone: "Europe/London",
  diagnosticResponses: [],
  availability: [{ day: "Friday", window: "Now", minutes: 25 }],
  profileSummary: "The learner prefers a concise explanation before independent practice.",
});
const NOW = new Date("2026-08-23T10:00:00.000Z");
const USER_ID = "user-1";
const DRAFT_SECRET = "activation-route-test-secret-0123456789-abcdef";
const EMPTY_DURATION_CONTEXT: StudyNowDurationContext = {
  profileVersion: "authorized_profile_context_v1+empty",
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

describe("plan activation staged-material boundary", () => {
  beforeEach(() => {
    vi.stubEnv("YOVA_DRAFT_RECEIPT_SECRET", DRAFT_SECRET);
    mocks.createClient.mockReset().mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: USER_ID } }, error: null }) },
    });
    mocks.persist.mockReset();
    mocks.loadDurationContext.mockReset().mockResolvedValue({
      status: "empty",
      reason: "development_preview",
      ...EMPTY_DURATION_CONTEXT,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("turns transaction-time staging expiry into a rebuild response", async () => {
    mocks.persist.mockRejectedValue(new PlanPersistenceError(
      "A pending source expired before the plan could be saved.",
      "material_staging_expired",
    ));
    const plan = generatedStudyNowPlan();
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await POST(signedActivationRequest(plan));
    const body = await response.json();

    expect(response.status).toBe(410);
    expect(body).toMatchObject({ code: "material_staging_expired" });
    expect(body.error).toContain("Add that source again");
    errorLog.mockRestore();
  });

  it("describes an ambiguous persistence response as an exact safe retry", async () => {
    mocks.persist.mockRejectedValue(new PlanPersistenceError(
      "The database response was unavailable.",
    ));
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await POST(signedActivationRequest(generatedStudyNowPlan()));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toMatchObject({ code: "activation_failed" });
    expect(body.error).toContain("exact request is safe to replay");
    expect(body.error).not.toContain("Nothing was activated");
    errorLog.mockRestore();
  });

  it("commits the exact reviewed route identity before persistence", async () => {
    mocks.persist.mockResolvedValue("supabase");
    const plan = generatedStudyNowPlan();
    const provisional = plan.sessions[0]?.studyRoute;

    const response = await POST(signedActivationRequest(plan));
    const body = await response.json();
    const persistedPlan = mocks.persist.mock.calls[0]?.[0];

    expect(response.status).toBe(200);
    expect(provisional?.identity.lifecycleStatus).toBe("provisional");
    expect(persistedPlan.sessions[0].studyRoute.identity).toMatchObject({
      routeLineageId: provisional?.identity.routeLineageId,
      routeRevisionId: provisional?.identity.routeRevisionId,
      lifecycleStatus: "committed",
    });
    expect(body.plan.sessions[0].studyRoute.identity.routeRevisionId)
      .toBe(provisional?.identity.routeRevisionId);
  });

  it("rebuilds the exact same active payload when a signed activation is retried later", async () => {
    vi.useFakeTimers();
    mocks.persist.mockResolvedValue("supabase");
    const plan = generatedStudyNowPlan();
    const issuedAt = Date.parse("2026-08-23T10:01:00.000Z");
    const expiresAt = Date.parse("2026-08-23T11:01:00.000Z");

    vi.setSystemTime("2026-08-23T10:10:00.000Z");
    const first = await POST(signedActivationRequest(plan, { issuedAt, expiresAt }));
    vi.setSystemTime("2026-08-23T10:45:00.000Z");
    const retry = await POST(signedActivationRequest(plan, { issuedAt, expiresAt }));

    expect(first.status).toBe(200);
    expect(retry.status).toBe(200);
    const [firstPlan, retryPlan] = mocks.persist.mock.calls.map((call) => call[0]);
    expect(retryPlan).toEqual(firstPlan);
    expect(firstPlan.sessions[0].studyRoute.identity.committedAt)
      .toBe("2026-08-23T10:01:00.000Z");
    expect(mocks.persist.mock.calls.map((call) => call[2])).toEqual([
      "2026-08-23T10:01:00.000Z",
      "2026-08-23T10:01:00.000Z",
    ]);
  });

  it("rejects a route identity that was moved to another session", async () => {
    const plan = generatedStudyNowPlan();
    const tampered = structuredClone(plan);
    tampered.sessions[0]!.studyRoute!.identity.sessionId = "99999999-9999-4999-8999-999999999999";

    const response = await POST(signedActivationRequest(tampered));

    expect(response.status).toBe(422);
    expect(mocks.persist).not.toHaveBeenCalled();
  });

  it("rejects a current draft when every reviewed route was stripped", async () => {
    const tampered = generatedStudyNowPlan();
    for (const session of tampered.sessions) delete session.studyRoute;

    const response = await POST(signedActivationRequest(tampered));

    expect(response.status).toBe(422);
    expect(mocks.persist).not.toHaveBeenCalled();
  });

  it("rejects a coherent client-forged duration that does not match authorized context", async () => {
    const originalPlan = generatedStudyNowPlan();
    const forgedPlan = generatedStudyNowPlan({
      ...EMPTY_DURATION_CONTEXT,
      profileVersion: "forged-duration-profile-v1",
      profile: {
        ...EMPTY_DURATION_CONTEXT.profile,
        sustainableMinutes: 15,
        evidenceRefs: {
          ...EMPTY_DURATION_CONTEXT.profile.evidenceRefs,
          sustainableMinutes: ["signal:sustainable_duration"],
        },
      },
    });

    const response = await POST(signedActivationRequest(forgedPlan, {
      receiptPlan: originalPlan,
    }));

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      code: "draft_receipt_invalid",
    });
    expect(mocks.persist).not.toHaveBeenCalled();
  });

  it("rejects changing a Study Now draft into a different creation flow", async () => {
    const tampered = generatedStudyNowPlan();
    tampered.creationIntent = "plan";

    const response = await POST(signedActivationRequest(tampered));

    expect(response.status).toBe(422);
    expect(mocks.persist).not.toHaveBeenCalled();
  });

  it("rejects a signed Study Now draft that does not carry its reviewed method choice", async () => {
    const plan = generatedStudyNowPlan();
    const choiceRequest = PlanGenerationRequestSchema.parse({
      ...generationRequest,
      methodChoice: { methodId: "scaffolded_coding" },
    });

    const response = await POST(signedActivationRequest(plan, {
      receiptGenerationRequest: choiceRequest,
      submittedGenerationRequest: choiceRequest,
    }));

    expect(response.status).toBe(422);
    expect(mocks.persist).not.toHaveBeenCalled();
  });

  it("rejects an unsigned production draft before persistence", async () => {
    const response = await POST(new Request("https://yova.example/api/plans/activate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan: generatedStudyNowPlan(), generationRequest }),
    }));

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      code: "draft_receipt_required",
    });
    expect(mocks.persist).not.toHaveBeenCalled();
  });

  it("rejects a changed generation contract even when the plan itself is untouched", async () => {
    const plan = generatedStudyNowPlan();
    const response = await POST(signedActivationRequest(plan, {
      submittedGenerationRequest: {
        ...generationRequest,
        profileSummary: "A coherently changed client-side setup summary.",
      },
    }));

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      code: "draft_receipt_invalid",
    });
    expect(mocks.persist).not.toHaveBeenCalled();
  });

  it("returns an explicit rebuild response for an expired signed draft", async () => {
    const plan = generatedStudyNowPlan();
    const expiredAt = Date.now() - 1;
    const response = await POST(signedActivationRequest(plan, {
      issuedAt: expiredAt - 60_000,
      expiresAt: expiredAt,
    }));

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      code: "draft_receipt_expired",
    });
    expect(mocks.persist).not.toHaveBeenCalled();
  });
});

function signedActivationRequest(
  plan: LearningPlan,
  {
    receiptPlan = plan,
    receiptGenerationRequest = generationRequest,
    submittedGenerationRequest = generationRequest,
    authenticatedUserId = USER_ID,
    issuedAt = Date.now() - 1_000,
    expiresAt = issuedAt + 60 * 60 * 1_000,
  }: {
    receiptPlan?: LearningPlan;
    receiptGenerationRequest?: typeof generationRequest;
    submittedGenerationRequest?: typeof generationRequest;
    authenticatedUserId?: string;
    issuedAt?: number;
    expiresAt?: number;
  } = {},
) {
  const canonicalReceiptPlan = JSON.parse(JSON.stringify(receiptPlan)) as LearningPlan;
  const draftReceipt = issuePlanDraftReceipt({
    parsedPlan: canonicalReceiptPlan,
    normalizedGenerationContract: normalizePlanDraftGenerationContract(
      receiptGenerationRequest,
      canonicalReceiptPlan,
    ),
    authenticatedUserId,
    issuedAt,
    expiresAt,
  }).receipt;
  return new Request("https://yova.example/api/plans/activate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      plan,
      generationRequest: submittedGenerationRequest,
      draftReceipt,
    }),
  });
}

function generatedStudyNowPlan(
  durationContext: StudyNowDurationContext = EMPTY_DURATION_CONTEXT,
): LearningPlan {
  const preliminaryPlan = generatePreviewPlan(generationRequest, NOW);
  const result = reconcileStudyNowDuration({
    preliminaryPlan,
    context: durationContext,
    scheduledWindow: "morning",
    hardMaximumMinutes: generationRequest.availability[0]!.minutes,
    buildPlan: (decision) => generatePreviewPlan(
      generationRequest,
      NOW,
      { studyNowDurationDecision: decision },
    ),
  });
  if (result.status !== "resolved") throw new Error("The activation fixture must resolve.");
  return structuredClone(result.plan) as LearningPlan;
}
