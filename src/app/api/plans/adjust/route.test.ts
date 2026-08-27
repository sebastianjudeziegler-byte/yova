import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LearningPlan, LearningPlanSession } from "@/lib/domain";
import { createCommittedInitialSessionStudyRoute } from "@/lib/study-route/session-route-creation";

vi.mock("server-only", () => ({}));

const USER_ID = "11111111-1111-4111-8111-111111111111";
const PLAN_ID = "22222222-2222-4222-8222-222222222222";
const ITEM_ID = "33333333-3333-4333-8333-333333333333";
const TOPIC_ID = "44444444-4444-4444-8444-444444444444";
const CONTENT_SESSION_ID = "55555555-5555-4555-8555-555555555555";
const REVIEW_SESSION_ID = "66666666-6666-4666-8666-666666666666";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getUser: vi.fn(),
  from: vi.fn(),
  rpc: vi.fn(),
  sessionRows: [] as Array<Record<string, unknown>>,
  routeRows: [] as Array<Record<string, unknown>>,
  interruptionRows: [] as Array<{ plan_session_id: string }>,
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: mocks.createClient,
}));

import { PATCH } from "@/app/api/plans/adjust/route";

describe("protected plan adjustment route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sessionRows = [contentRow()];
    mocks.routeRows = [];
    mocks.interruptionRows = [];
    mocks.getUser.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });
    mocks.from.mockImplementation((table: string) => {
      if (table === "plan_sessions") {
        const builder = {
          select: () => builder,
          eq: () => builder,
          order: async () => ({ data: mocks.sessionRows, error: null }),
        };
        return builder;
      }
      if (table === "plans") {
        const builder = {
          select: () => builder,
          eq: () => builder,
          maybeSingle: async () => ({
            data: {
              learning_item_id: ITEM_ID,
              knowledge_map: knowledgeMap(),
              status: "active",
              rationale: "Build the model, then verify it.",
              generation_inputs: { learningIntent: "learn" },
              created_at: "2026-08-20T10:00:00.000Z",
            },
            error: null,
          }),
        };
        return builder;
      }
      if (table === "learning_items") {
        const builder = {
          select: () => builder,
          eq: () => builder,
          maybeSingle: async () => ({
            data: {
              id: ITEM_ID,
              title: "Arbitrary causal model",
              kind: "topic",
              topic: "Arbitrary causal model",
              deadline: null,
              source_mode: "yova_generated",
              study_mode: "inside_yova",
              created_at: "2026-08-20T10:00:00.000Z",
            },
            error: null,
          }),
        };
        return builder;
      }
      if (table === "study_routes") {
        const builder = {
          select: () => builder,
          eq: () => builder,
          then: (resolve: (result: { data: unknown[]; error: null }) => unknown) => (
            Promise.resolve({ data: mocks.routeRows, error: null }).then(resolve)
          ),
        };
        return builder;
      }
      if (table === "learning_events") {
        const builder = {
          select: () => builder,
          eq: () => builder,
          in: async () => ({ data: mocks.interruptionRows, error: null }),
        };
        return builder;
      }
      throw new Error(`Unexpected table ${table}`);
    });
    mocks.rpc.mockImplementation(async (_name: string, input: { payload: Record<string, unknown> }) => ({
      data: {
        planId: PLAN_ID,
        deadline: input.payload.deadline,
        studyMode: input.payload.studyMode,
        sessions: input.payload.sessions,
      },
      error: null,
    }));
    mocks.createClient.mockResolvedValue({
      auth: { getUser: mocks.getUser },
      from: mocks.from,
      rpc: mocks.rpc,
    });
  });

  it("fails before the mutation when generated material or a checkpoint exists", async () => {
    const base = contentRow();
    mocks.sessionRows = [contentRow({
      step_data: {
        ...(base.step_data as Record<string, unknown>),
        generatedSession: { generatedAt: "2026-08-21T10:00:00.000Z" },
      },
    })];

    const response = await PATCH(request());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "plan_adjustment_saved_work_protected",
      planSessionId: CONTENT_SESSION_ID,
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("fails before the mutation when a durable interruption exists", async () => {
    mocks.interruptionRows = [{ plan_session_id: CONTENT_SESSION_ID }];

    const response = await PATCH(request());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "plan_adjustment_saved_work_protected",
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("rebuilds ordinary content while passing a five-minute review through as protected", async () => {
    mocks.sessionRows = [contentRow(), reviewRow()];

    const response = await PATCH(request());

    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledOnce();
    const payload = mocks.rpc.mock.calls[0]?.[1]?.payload as {
      sessions: Array<Record<string, unknown>>;
    };
    const protectedReview = payload.sessions.find((session) => session.id === REVIEW_SESSION_ID);
    const contentParts = payload.sessions.filter((session) => session.id !== REVIEW_SESSION_ID);
    expect(protectedReview).toMatchObject({
      title: "Verify arbitrary concept",
      estimatedMinutes: 5,
      reviewConcept: "Arbitrary concept",
      reviewType: "verify",
      protected: true,
      status: "upcoming",
    });
    expect(contentParts).toHaveLength(2);
    expect(contentParts.every((session) => session.estimatedMinutes === 15)).toBe(true);

    const body = await response.json();
    expect(body.sessions.find((session: { id: string }) => session.id === REVIEW_SESSION_ID)).toMatchObject({
      estimatedMinutes: 5,
      reviewConcept: "Arbitrary concept",
      reviewType: "verify",
    });
  });

  it("never sends an undersized ordinary replacement to the database RPC", async () => {
    mocks.sessionRows = [contentRow({ estimated_minutes: 8 })];

    const response = await PATCH(request());

    expect(response.status).toBe(200);
    const payload = mocks.rpc.mock.calls[0]?.[1]?.payload as {
      sessions: Array<{ estimatedMinutes: number; protected?: boolean }>;
    };
    expect(payload.sessions).toHaveLength(1);
    expect(payload.sessions[0]).toMatchObject({ estimatedMinutes: 10 });
    expect(payload.sessions[0].protected).not.toBe(true);
  });

  it("uses the RPC's authoritative review time when it changed after the preview read", async () => {
    mocks.sessionRows = [contentRow(), reviewRow()];
    const authoritativeReviewTime = "2026-08-25T14:30:00.000Z";
    mocks.rpc.mockImplementationOnce(async (
      _name: string,
      input: { payload: Record<string, unknown> },
    ) => {
      const sessions = input.payload.sessions as Array<Record<string, unknown>>;
      return {
        data: {
          planId: PLAN_ID,
          deadline: input.payload.deadline,
          studyMode: input.payload.studyMode,
          sessions: sessions.map((session) => session.id === REVIEW_SESSION_ID
            ? { ...session, scheduledFor: authoritativeReviewTime }
            : session),
        },
        error: null,
      };
    });

    const response = await PATCH(request());

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.sessions.find((session: { id: string }) => session.id === REVIEW_SESSION_ID))
      .toMatchObject({ scheduledFor: authoritativeReviewTime });
  });

  it("atomically sends a successor and an independent split route for a routed plan", async () => {
    const { sessionRow, routeRow, route } = routedContentFixture();
    mocks.sessionRows = [sessionRow];
    mocks.routeRows = [routeRow];

    const response = await PATCH(request());

    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("adjust_learning_plan_with_routes", expect.anything());
    const payload = mocks.rpc.mock.calls[0]?.[1]?.payload as {
      sessions: Array<LearningPlanSession>;
    };
    expect(payload.sessions).toHaveLength(2);
    expect(payload.sessions[0]?.studyRoute?.identity).toMatchObject({
      routeLineageId: route.identity.routeLineageId,
      revisionNumber: 2,
      supersedesRevisionId: route.identity.routeRevisionId,
      lifecycleStatus: "committed",
      sessionId: CONTENT_SESSION_ID,
    });
    expect(payload.sessions[1]?.studyRoute?.identity).toMatchObject({
      revisionNumber: 1,
      lifecycleStatus: "committed",
      sessionId: payload.sessions[1]?.id,
    });
    expect(payload.sessions[1]?.studyRoute?.identity.routeLineageId).not.toBe(
      route.identity.routeLineageId,
    );
  });
});

function request() {
  return new Request("https://yova.example/api/plans/adjust", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      planId: PLAN_ID,
      deadline: new Date(Date.now() + 14 * 24 * 60 * 60 * 1_000).toISOString(),
      studyMode: "inside_yova",
      futureSessionMinutes: 15,
      direction: null,
    }),
  });
}

function contentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: CONTENT_SESSION_ID,
    sequence: 1,
    title: "Build an arbitrary causal model",
    objective: "Explain the arbitrary causal model, then apply it once.",
    method: "Self-explanation",
    method_rationale: "The learner needs an accurate model before an independent check.",
    scheduled_for: "2026-08-22T10:00:00.000Z",
    estimated_minutes: 25,
    status: "ready",
    step_data: {
      amountLabel: "One model and one check · about 25 min",
      learningMode: "learn",
      topicIds: [TOPIC_ID],
      contentTargets: ["Arbitrary causal model"],
      completionEvidence: ["Explain and apply the model"],
    },
    ...overrides,
  };
}

function reviewRow() {
  return {
    id: REVIEW_SESSION_ID,
    sequence: 2,
    title: "Verify arbitrary concept",
    objective: "Answer three self-contained questions about the arbitrary concept.",
    method: "Independent retrieval verification",
    method_rationale: "This is a scheduled delayed check of the exact concept.",
    scheduled_for: "2026-08-24T10:00:00.000Z",
    estimated_minutes: 5,
    status: "upcoming",
    step_data: {
      amountLabel: "Verify in 2 days · about 5 min",
      learningMode: "study",
      topicIds: [TOPIC_ID],
      contentTargets: ["Arbitrary concept"],
      completionEvidence: ["Answer three independent questions"],
      reviewConcept: "Arbitrary concept",
      reviewType: "verify",
    },
  };
}

function knowledgeMap() {
  return {
    version: 1,
    scopeJudgment: {
      band: "focused_skill",
      label: "Arbitrary causal model",
      minimumSessions: 1,
      recommendedSessions: 2,
      maximumSessions: 4,
      minimumTeachingSessions: 1,
      explanation: "The bounded goal needs one model-building session and one independent return check.",
    },
    topics: [{
      id: TOPIC_ID,
      title: "Arbitrary concept",
      description: "A subject-independent concept used to verify the plan-adjustment contract.",
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
  };
}

function routedContentFixture() {
  const row = contentRow();
  const session: LearningPlanSession = {
    id: CONTENT_SESSION_ID,
    sequence: 1,
    title: row.title,
    objective: row.objective,
    method: row.method,
    methodReason: row.method_rationale,
    scheduledFor: row.scheduled_for,
    estimatedMinutes: row.estimated_minutes,
    amountLabel: "One model and one check · about 25 min",
    learningMode: "learn",
    topicIds: [TOPIC_ID],
    contentTargets: ["Arbitrary causal model"],
    completionEvidence: ["Explain and apply the model"],
    status: "ready",
  };
  const plan: LearningPlan = {
    id: PLAN_ID,
    learningItemId: ITEM_ID,
    title: "Arbitrary causal model",
    topic: "Arbitrary causal model",
    kind: "topic",
    deadline: null,
    status: "active",
    sourceMode: "yova_generated",
    studyMode: "inside_yova",
    learningIntent: "learn",
    rationale: "Build the model, then verify it.",
    createdAt: "2026-08-20T10:00:00.000Z",
    sessions: [session],
  };
  const route = createCommittedInitialSessionStudyRoute({
    plan,
    session,
    now: "2026-08-20T10:00:00.000Z",
    origin: {
      source: "plan_activation",
      reason: "The learner activated the original route.",
    },
  });
  const { identity, ...routePayload } = route;
  return {
    route,
    sessionRow: {
      ...row,
      committed_route_revision_id: identity.routeRevisionId,
    },
    routeRow: {
      route_revision_id: identity.routeRevisionId,
      route_lineage_id: identity.routeLineageId,
      revision_number: identity.revisionNumber,
      schema_version: identity.schemaVersion,
      lifecycle: identity.lifecycleStatus,
      plan_id: identity.planId,
      plan_session_id: identity.sessionId,
      predecessor_revision_id: identity.supersedesRevisionId ?? null,
      route_payload: routePayload,
      created_at: identity.createdAt,
      committed_at: identity.committedAt ?? null,
    },
  };
}
