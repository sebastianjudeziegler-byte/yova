import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LearningPlan } from "@/lib/domain";
import {
  CORE_METHOD_CATALOG,
  CORE_METHOD_IDS,
  type CoreMethodId,
} from "@/lib/learning/method-catalog";
import { normalizePlanDraftGenerationContract } from "@/lib/plan-generation/draft-contract";
import { generatePreviewPlan } from "@/lib/plan-generation/preview-generator";
import {
  PlanActivationRequestSchema,
  PlanDraftMethodChoiceResponseSchema,
  PlanGenerationRequestSchema,
} from "@/lib/plan-generation/schema";
import {
  issuePlanDraftReceipt,
  verifyPlanDraftReceipt,
} from "@/lib/server/plan-draft-receipt";
import {
  integrateInitialPlanMethodRoutes,
  type InitialPlanMethodRoutingContext,
} from "@/lib/study-route/initial-plan-method-routing";
import { StudyRouteSchema, type StudyRoute } from "@/lib/study-route/schema";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  configured: vi.fn(),
  createClient: vi.fn(),
  developmentPreview: vi.fn(),
}));

vi.mock("@/lib/supabase/config", () => ({
  isSupabaseConfigured: mocks.configured,
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: mocks.createClient,
}));
vi.mock("@/lib/server/development-preview", () => ({
  isDevelopmentPreviewRequest: mocks.developmentPreview,
}));

import { POST } from "@/app/api/plans/method-choice/route";

const NOW = new Date("2026-08-24T14:00:00.000Z");
const PLAN_CREATED_AT = new Date("2026-08-24T13:55:00.000Z");
const RECEIPT_ISSUED_AT = "2026-08-24T13:59:00.000Z";
const RECEIPT_EXPIRES_AT = "2026-08-24T15:00:00.000Z";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_USER_ID = "22222222-2222-4222-8222-222222222222";
const RECEIPT_SECRET = "normal-plan-method-choice-test-secret-0123456789-abcdef";

const generationRequest = PlanGenerationRequestSchema.parse({
  intent: "plan",
  learningIntent: "learn",
  goal: "Learn why the calculus product rule has two derivative terms, then solve unfamiliar product-rule problems accurately.",
  startingContext: "I have not learned the product rule yet.",
  materialMode: "none",
  materials: [],
  studyMode: "inside",
  deadline: "2026-09-10T20:00:00.000Z",
  timeZone: "UTC",
  diagnosticResponses: [],
  availability: [{ day: "Every day", window: "Evening", minutes: 25 }],
  profileSummary: "The learner wants concise teaching followed by independent practice.",
});

describe("normal-plan draft method-choice route", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.stubEnv("YOVA_DRAFT_RECEIPT_SECRET", RECEIPT_SECRET);
    mocks.configured.mockReset().mockReturnValue(true);
    mocks.developmentPreview.mockReset().mockReturnValue(false);
    mocks.createClient.mockReset().mockResolvedValue(authenticatedClient(USER_ID));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("re-signs one exact offered choice with a fresh route identity and leaves every other session untouched", async () => {
    const plan = routedPlan();
    const { sessionIndex, session, route: beforeRoute, methodId } = offeredChoice(plan);
    const issued = sign(plan, USER_ID);

    const response = await POST(methodChoiceRequest({
      plan,
      draftReceipt: issued.receipt,
      selection: {
        sessionId: session.id,
        expectedRouteRevisionId: beforeRoute.identity.routeRevisionId,
        methodId,
      },
    }));
    const parsed = PlanDraftMethodChoiceResponseSchema.parse(await response.json());

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(parsed.revision).toMatchObject({ status: "updated" });
    expect(parsed.draftReceipt).not.toBe(issued.receipt);
    expect(parsed.draftReceipt).not.toBeNull();

    const afterRoute = route(parsed.plan.sessions[sessionIndex]!.studyRoute);
    expect(afterRoute.approach.primaryMethodId).toBe(methodId);
    expect(afterRoute.identity.routeRevisionId).not.toBe(
      beforeRoute.identity.routeRevisionId,
    );
    expect(afterRoute.identity).toMatchObject({
      routeLineageId: beforeRoute.identity.routeLineageId,
      revisionNumber: 1,
      lifecycleStatus: "provisional",
      planId: plan.id,
      sessionId: session.id,
      createdAt: NOW.toISOString(),
    });
    expect(afterRoute.identity).not.toHaveProperty("supersedesRevisionId");
    expect(afterRoute.agency).toMatchObject({
      controlMode: "learner_customizes",
      selectedBy: "learner",
      override: {
        requestedAt: NOW.toISOString(),
        changedFields: ["primary_method"],
      },
    });
    expect(parsed.plan.sessions.filter((_, index) => index !== sessionIndex))
      .toEqual(plan.sessions.filter((_, index) => index !== sessionIndex));

    const replacementVerification = verifyPlanDraftReceipt({
      receipt: parsed.draftReceipt!,
      parsedPlan: parsed.plan,
      normalizedGenerationContract: normalizedContract(parsed.plan),
      authenticatedUserId: USER_ID,
      now: NOW,
    });
    expect(replacementVerification).toEqual({
      ok: true,
      metadata: issued.metadata,
    });
    expect(verifyPlanDraftReceipt({
      receipt: issued.receipt,
      parsedPlan: parsed.plan,
      normalizedGenerationContract: normalizedContract(parsed.plan),
      authenticatedUserId: USER_ID,
      now: NOW,
    })).toEqual({ ok: false, reason: "signature_mismatch" });
    expect(verifyPlanDraftReceipt({
      receipt: parsed.draftReceipt!,
      parsedPlan: plan,
      normalizedGenerationContract: normalizedContract(plan),
      authenticatedUserId: USER_ID,
      now: NOW,
    })).toEqual({ ok: false, reason: "signature_mismatch" });
  });

  it("keeps the exact plan and receipt when the selected method is already current", async () => {
    const plan = routedPlan();
    const session = plan.sessions[0]!;
    const currentRoute = route(session.studyRoute);
    const issued = sign(plan, USER_ID);

    const response = await POST(methodChoiceRequest({
      plan,
      draftReceipt: issued.receipt,
      selection: {
        sessionId: session.id,
        expectedRouteRevisionId: currentRoute.identity.routeRevisionId,
        methodId: currentRoute.approach.primaryMethodId,
      },
    }));
    const parsed = PlanDraftMethodChoiceResponseSchema.parse(await response.json());

    expect(response.status).toBe(200);
    expect(parsed.revision.status).toBe("unchanged");
    expect(parsed.plan).toEqual(plan);
    expect(parsed.draftReceipt).toBe(issued.receipt);
  });

  it("resolves an I'll Customize Other method inside the signed route eligibility cohort", async () => {
    const original = routedPlan();
    const { sessionIndex, session, route: currentRoute, methodId } = offeredChoice(original);
    const customizeRoute = StudyRouteSchema.parse({
      ...currentRoute,
      agency: {
        ...currentRoute.agency,
        controlMode: "learner_customizes",
        alternatives: [],
      },
    });
    const plan: LearningPlan = {
      ...original,
      sessions: original.sessions.map((candidate, index) => (
        index === sessionIndex
          ? { ...candidate, studyRoute: customizeRoute }
          : candidate
      )),
    };
    const issued = sign(plan, USER_ID);

    const response = await POST(methodChoiceRequest({
      plan,
      draftReceipt: issued.receipt,
      selection: {
        sessionId: session.id,
        expectedRouteRevisionId: customizeRoute.identity.routeRevisionId,
        choiceScope: "other_eligible_method",
        requestedMethod: CORE_METHOD_CATALOG[methodId].name,
      },
    }));
    const parsed = PlanDraftMethodChoiceResponseSchema.parse(await response.json());

    expect(response.status).toBe(200);
    expect(parsed.revision.status).toBe("updated");
    expect(parsed.methodRequestResolution).toMatchObject({
      status: "accepted",
      mappingKind: "exact_method",
      requestedMethodId: methodId,
      selectedMethodId: methodId,
    });
    expect(route(parsed.plan.sessions[sessionIndex]!.studyRoute).approach.primaryMethodId)
      .toBe(methodId);
  });

  it("rejects a stale route revision and an unoffered method without returning a changed draft", async () => {
    const plan = routedPlan();
    const { session, route: currentRoute, methodId } = offeredChoice(plan);
    const issued = sign(plan, USER_ID);

    const stale = await POST(methodChoiceRequest({
      plan,
      draftReceipt: issued.receipt,
      selection: {
        sessionId: session.id,
        expectedRouteRevisionId: "99999999-9999-4999-8999-999999999999",
        methodId,
      },
    }));
    expect(stale.status).toBe(422);
    await expect(stale.json()).resolves.toMatchObject({
      code: "stale_route_revision",
    });

    const unoffered = await POST(methodChoiceRequest({
      plan,
      draftReceipt: issued.receipt,
      selection: {
        sessionId: session.id,
        expectedRouteRevisionId: currentRoute.identity.routeRevisionId,
        methodId: unofferedMethod(currentRoute),
      },
    }));
    expect(unoffered.status).toBe(422);
    await expect(unoffered.json()).resolves.toMatchObject({
      code: "method_not_offered",
    });
  });

  it("rejects a forged draft, malformed receipt, and receipt bound to another account", async () => {
    const plan = routedPlan();
    const { session, route: currentRoute, methodId } = offeredChoice(plan);
    const issued = sign(plan, USER_ID);
    const selection = {
      sessionId: session.id,
      expectedRouteRevisionId: currentRoute.identity.routeRevisionId,
      methodId,
    };
    const forgedPlan = { ...plan, rationale: `${plan.rationale} Client-forged change.` };

    const forged = await POST(methodChoiceRequest({
      plan: forgedPlan,
      draftReceipt: issued.receipt,
      selection,
    }));
    expect(forged.status).toBe(422);
    await expect(forged.json()).resolves.toMatchObject({
      code: "draft_receipt_invalid",
    });

    const malformed = await POST(methodChoiceRequest({
      plan,
      draftReceipt: "not-a-receipt",
      selection,
    }));
    expect(malformed.status).toBe(422);
    await expect(malformed.json()).resolves.toMatchObject({
      code: "draft_receipt_invalid",
    });

    mocks.createClient.mockResolvedValue(authenticatedClient(OTHER_USER_ID));
    const wrongUser = await POST(methodChoiceRequest({
      plan,
      draftReceipt: issued.receipt,
      selection,
    }));
    expect(wrongUser.status).toBe(422);
    await expect(wrongUser.json()).resolves.toMatchObject({
      code: "draft_receipt_invalid",
    });
  });

  it("requires production authentication and a signed receipt", async () => {
    const plan = routedPlan();
    const { session, route: currentRoute, methodId } = offeredChoice(plan);
    const selection = {
      sessionId: session.id,
      expectedRouteRevisionId: currentRoute.identity.routeRevisionId,
      methodId,
    };

    mocks.createClient.mockResolvedValue(authenticatedClient(null));
    const unauthenticated = await POST(methodChoiceRequest({
      plan,
      draftReceipt: null,
      selection,
    }));
    expect(unauthenticated.status).toBe(401);

    mocks.createClient.mockResolvedValue(authenticatedClient(USER_ID));
    const unsigned = await POST(methodChoiceRequest({
      plan,
      draftReceipt: null,
      selection,
    }));
    expect(unsigned.status).toBe(422);
    await expect(unsigned.json()).resolves.toMatchObject({
      code: "draft_receipt_required",
    });
  });

  it("allows development preview to revise deterministically without cloud auth or a receipt", async () => {
    mocks.developmentPreview.mockReturnValue(true);
    mocks.configured.mockReturnValue(false);
    const plan = routedPlan();
    const { sessionIndex, session, route: currentRoute, methodId } = offeredChoice(plan);

    const response = await POST(methodChoiceRequest({
      plan,
      draftReceipt: null,
      selection: {
        sessionId: session.id,
        expectedRouteRevisionId: currentRoute.identity.routeRevisionId,
        methodId,
      },
      developmentPreview: true,
    }));
    const parsed = PlanDraftMethodChoiceResponseSchema.parse(await response.json());

    expect(response.status).toBe(200);
    expect(parsed.revision.status).toBe("updated");
    expect(parsed.draftReceipt).toBeNull();
    expect(route(parsed.plan.sessions[sessionIndex]!.studyRoute).approach.primaryMethodId)
      .toBe(methodId);
    expect(mocks.createClient).not.toHaveBeenCalled();
  });
});

function routedPlan(): LearningPlan {
  const context: InitialPlanMethodRoutingContext = {
    profileVersion: "authorized_profile_context_v1+empty",
    personalization: {
      decisions: [],
      methodTie: {
        state: {
          controls: { experiments: false },
          activeExperiment: null,
          experimentHistory: [],
        },
        signals: [],
      },
    },
    observedEvidence: [],
  };
  const routed = integrateInitialPlanMethodRoutes({
    plan: generatePreviewPlan(generationRequest, PLAN_CREATED_AT),
    request: generationRequest,
    context,
  });
  const parsed = PlanActivationRequestSchema.parse({
    plan: routed,
    generationRequest,
    draftReceipt: null,
  }).plan;
  // Match the real request boundary: JSON transport omits optional properties
  // whose in-memory value is undefined before the receipt is canonicalized.
  return JSON.parse(JSON.stringify(parsed)) as LearningPlan;
}

function offeredChoice(plan: LearningPlan) {
  const sessionIndex = plan.sessions.findIndex((session) => (
    route(session.studyRoute).agency.alternatives.length > 0
  ));
  if (sessionIndex < 0) throw new Error("The fixture needs an offered method alternative.");
  const session = plan.sessions[sessionIndex]!;
  const currentRoute = route(session.studyRoute);
  return {
    sessionIndex,
    session,
    route: currentRoute,
    methodId: currentRoute.agency.alternatives[0]!.primaryMethodId,
  };
}

function unofferedMethod(currentRoute: StudyRoute): CoreMethodId {
  const offered = new Set([
    currentRoute.approach.primaryMethodId,
    ...currentRoute.agency.alternatives.map((alternative) => alternative.primaryMethodId),
  ]);
  const methodId = CORE_METHOD_IDS.find((candidate) => !offered.has(candidate));
  if (!methodId) throw new Error("The fixture needs an unoffered catalog method.");
  return methodId;
}

function sign(plan: LearningPlan, authenticatedUserId: string) {
  return issuePlanDraftReceipt({
    parsedPlan: plan,
    normalizedGenerationContract: normalizedContract(plan),
    authenticatedUserId,
    issuedAt: RECEIPT_ISSUED_AT,
    expiresAt: RECEIPT_EXPIRES_AT,
  });
}

function normalizedContract(plan: LearningPlan) {
  return normalizePlanDraftGenerationContract(generationRequest, plan);
}

function methodChoiceRequest({
  plan,
  draftReceipt,
  selection,
  developmentPreview = false,
}: {
  plan: LearningPlan;
  draftReceipt: string | null;
  selection: {
    sessionId: string;
    expectedRouteRevisionId: string;
  } & (
    | { methodId: CoreMethodId; choiceScope?: "stored_alternative" }
    | {
        choiceScope: "other_eligible_method";
        requestedMethod: string;
      }
  );
  developmentPreview?: boolean;
}) {
  return new Request("https://yova.example/api/plans/method-choice", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(developmentPreview
        ? { "X-Yova-Development-Preview": "plan-creator" }
        : {}),
    },
    body: JSON.stringify({
      plan,
      generationRequest,
      draftReceipt,
      selection,
    }),
  });
}

function authenticatedClient(userId: string | null) {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: userId ? { id: userId } : null },
        error: userId ? null : { message: "not authenticated" },
      }),
    },
  };
}

function route(value: unknown): StudyRoute {
  return StudyRouteSchema.parse(value);
}
