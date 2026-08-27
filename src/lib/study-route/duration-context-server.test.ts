import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LearningPlan } from "@/lib/domain";
import { encodeAdditionalLearnerContext } from "@/lib/personalization/learner-profile";
import {
  defaultPersonalizationState,
  writePersonalizationStateToAnswers,
} from "@/lib/personalization/personalization-state";
import { adaptLegacySessionToStudyRoute } from "@/lib/study-route/adapters";

const mocks = vi.hoisted(() => ({
  isSupabaseConfigured: vi.fn(),
  createSupabaseServerClient: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/config", () => ({
  isSupabaseConfigured: mocks.isSupabaseConfigured,
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: mocks.createSupabaseServerClient,
}));

import {
  NORMAL_DURATION_AUTHORITY_READ_LIMIT,
  NORMAL_DURATION_HISTORY_READ_LIMIT,
  loadAuthorizedNormalDurationContext,
  type LoadAuthorizedNormalDurationContextOptions,
} from "@/lib/study-route/duration-context-server";

const IDS = {
  user: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  otherUser: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  plan: "11111111-1111-4111-8111-111111111111",
  item: "22222222-2222-4222-8222-222222222222",
  session: "33333333-3333-4333-8333-333333333333",
  completion: "44444444-4444-4444-8444-444444444444",
  interruption: "55555555-5555-4555-8555-555555555555",
  otherRoute: "66666666-6666-4666-8666-666666666666",
} as const;
const PROFILE_UPDATED_AT = "2026-08-23T09:30:00.000Z";
const PROFILE_REVISION = `profile_revision_${Date.parse(PROFILE_UPDATED_AT).toString(36)}`;

type InjectedClient = NonNullable<LoadAuthorizedNormalDurationContextOptions["supabase"]>;
type QueryResult = { data: unknown; error: unknown };
type QueryOperation = {
  table: string;
  method: string;
  args: unknown[];
};

type FakeClient = {
  auth: { getUser: ReturnType<typeof vi.fn> };
  from: ReturnType<typeof vi.fn>;
  operations: QueryOperation[];
};

describe("authorized normal-duration server context", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isSupabaseConfigured.mockReturnValue(false);
  });

  it("returns empty context without touching auth in preview or unconfigured environments", async () => {
    await expect(loadAuthorizedNormalDurationContext({ developmentPreview: true }))
      .resolves.toMatchObject({
        status: "empty",
        reason: "development_preview",
        recentOutcomes: [],
      });
    await expect(loadAuthorizedNormalDurationContext()).resolves.toMatchObject({
      status: "empty",
      reason: "supabase_unavailable",
      recentOutcomes: [],
    });
    expect(mocks.createSupabaseServerClient).not.toHaveBeenCalled();
  });

  it("uses the default auth path and distinguishes unauthenticated from failed reads", async () => {
    mocks.isSupabaseConfigured.mockReturnValue(true);
    const unauthenticated = fakeClient({}, {
      data: { user: null },
      error: null,
    });
    mocks.createSupabaseServerClient.mockResolvedValueOnce(unauthenticated);
    await expect(loadAuthorizedNormalDurationContext()).resolves.toMatchObject({
      status: "empty",
      reason: "unauthenticated",
    });
    expect(unauthenticated.from).not.toHaveBeenCalled();

    const authFailure = fakeClient({}, {
      data: { user: null },
      error: { message: "private auth failure" },
    });
    mocks.createSupabaseServerClient.mockResolvedValueOnce(authFailure);
    await expect(loadAuthorizedNormalDurationContext()).resolves.toMatchObject({
      status: "degraded",
      reason: "authentication_read_failed",
      recentOutcomes: [],
    });
  });

  it("requires a complete, valid injected authentication context", async () => {
    const client = fakeClient({});
    await expect(loadAuthorizedNormalDurationContext({
      supabase: client as unknown as InjectedClient,
    })).resolves.toMatchObject({
      status: "degraded",
      reason: "authentication_context_invalid",
    });
    await expect(loadAuthorizedNormalDurationContext({
      supabase: client as unknown as InjectedClient,
      authenticatedUserId: "not-a-user-id",
    })).resolves.toMatchObject({
      status: "degraded",
      reason: "authentication_context_invalid",
    });
    expect(client.auth.getUser).not.toHaveBeenCalled();
    expect(client.from).not.toHaveBeenCalled();
  });

  it("returns empty for a missing profile and degraded for a profile read error", async () => {
    const missing = fakeClient({ learner_profiles: { data: null, error: null } });
    await expect(loadInjected(missing)).resolves.toMatchObject({
      status: "empty",
      reason: "profile_missing",
      recentOutcomes: [],
    });
    expect(missing.from).toHaveBeenCalledTimes(1);

    const failed = fakeClient({
      learner_profiles: { data: null, error: { message: "private database failure" } },
    });
    await expect(loadInjected(failed)).resolves.toMatchObject({
      status: "degraded",
      reason: "profile_read_failed",
      recentOutcomes: [],
    });
  });

  it("loads structured profile and exact current route history with bounded owner reads", async () => {
    const fixture = completeFixture();
    const client = fakeClient(fixture.results);
    const result = await loadInjected(client);

    expect(result).toMatchObject({
      status: "ready",
      reason: "loaded",
      profile: {
        sustainableMinutes: 25,
        startingFrictionRisk: "high",
        fatigueRisk: "high",
        preferredWindow: "evening",
      },
    });
    expect(result.profileVersion).toBe(
      `authorized_profile_context_v1+${PROFILE_REVISION}+learner_profile_schema_v1+additional_context_v3+personalization_state_v1+profile_model_v1`,
    );
    expect(result.methodProfileVersion).toBe(result.profileVersion);
    expect(result.methodEvidence.observedEvidence[0]).toMatchObject({
      signal: {
        methodId: "self_explanation",
        taskType: fixture.route.target.taskFamily,
        knowledgeStage: "novice",
        sessions: 1,
        checkedAnswers: 5,
        status: "early_signal",
      },
      distinctStudyDays: 1,
      latestObservedAt: "2026-08-23T10:25:00.000Z",
    });
    expect(result.recentOutcomes).toEqual([
      {
        kind: "interruption",
        sessionClass: "normal",
        taskFamily: fixture.route.target.taskFamily,
        mode: fixture.route.approach.mode,
        occurredAt: "2026-08-23T11:08:00.000Z",
        routeRevisionId: fixture.route.identity.routeRevisionId,
        plannedMinutes: 25,
        actualMinutes: 8,
        completedSteps: 1,
        totalSteps: 4,
        evidenceRef: IDS.interruption,
      },
      {
        kind: "completion",
        sessionClass: "normal",
        taskFamily: fixture.route.target.taskFamily,
        mode: fixture.route.approach.mode,
        occurredAt: "2026-08-23T10:25:00.000Z",
        routeRevisionId: fixture.route.identity.routeRevisionId,
        plannedMinutes: 25,
        actualMinutes: 24,
        correctAnswers: 4,
        totalAnswers: 5,
        feedback: "about_right",
        evidenceRef: IDS.completion,
      },
    ]);
    expect(client.auth.getUser).not.toHaveBeenCalled();
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.profile)).toBe(true);
    expect(Object.isFrozen(result.recentOutcomes)).toBe(true);
    expect(Object.isFrozen(result.methodEvidence)).toBe(true);

    const profileSelect = client.operations.find((operation) => (
      operation.table === "learner_profiles" && operation.method === "select"
    ));
    expect(String(profileSelect?.args[0])).not.toContain("profileSummary");
    for (const table of [
      "learner_profiles",
      "session_attempts",
      "learning_events",
      "plan_sessions",
      "plans",
      "study_routes",
    ]) {
      expect(client.operations).toContainEqual({
        table,
        method: "eq",
        args: ["user_id", IDS.user],
      });
    }
    expectLimit(client, "session_attempts", NORMAL_DURATION_HISTORY_READ_LIMIT);
    expectLimit(client, "learning_events", NORMAL_DURATION_HISTORY_READ_LIMIT);
    expectLimit(client, "plan_sessions", NORMAL_DURATION_AUTHORITY_READ_LIMIT);
    expectLimit(client, "plans", NORMAL_DURATION_AUTHORITY_READ_LIMIT);
    expectLimit(client, "study_routes", NORMAL_DURATION_AUTHORITY_READ_LIMIT);
  });

  it("keeps the authorized profile but drops outcome evidence for history errors and owner mismatches", async () => {
    const historyError = completeFixture();
    historyError.results.session_attempts = {
      data: null,
      error: { message: "private history failure" },
    };
    await expect(loadInjected(fakeClient(historyError.results))).resolves.toMatchObject({
      status: "degraded",
      reason: "history_read_failed",
      profile: {
        sustainableMinutes: 25,
        startingFrictionRisk: "high",
        fatigueRisk: "high",
        preferredWindow: "evening",
      },
      recentOutcomes: [],
    });

    const foreignRow = completeFixture();
    foreignRow.results.session_attempts = {
      data: [{
        ...(foreignRow.results.session_attempts.data as Record<string, unknown>[])[0],
        user_id: IDS.otherUser,
      }],
      error: null,
    };
    await expect(loadInjected(fakeClient(foreignRow.results))).resolves.toMatchObject({
      status: "degraded",
      reason: "history_read_failed",
      profile: { sustainableMinutes: 25 },
      recentOutcomes: [],
    });
  });

  it("fails closed on route/event mismatches and malformed generated resources", async () => {
    const routeMismatch = completeFixture();
    const completion = (routeMismatch.results.session_attempts.data as Record<string, unknown>[])[0]!;
    routeMismatch.results.session_attempts = {
      data: [{
        ...completion,
        result_data: {
          ...(completion.result_data as Record<string, unknown>),
          routeRevisionId: IDS.otherRoute,
        },
      }],
      error: null,
    };
    routeMismatch.results.learning_events = { data: [], error: null };
    await expect(loadInjected(fakeClient(routeMismatch.results))).resolves.toMatchObject({
      status: "ready",
      recentOutcomes: [],
    });

    const malformedResource = completeFixture();
    const session = (malformedResource.results.plan_sessions.data as Record<string, unknown>[])[0]!;
    malformedResource.results.plan_sessions = {
      data: [{ ...session, step_data: { generatedSession: { schemaVersion: 999 } } }],
      error: null,
    };
    malformedResource.results.learning_events = { data: [], error: null };
    await expect(loadInjected(fakeClient(malformedResource.results))).resolves.toMatchObject({
      status: "ready",
      recentOutcomes: [],
    });
  });

  it.each([
    ["malformed JSON", "not valid personalization JSON"],
    ["future state", JSON.stringify({
      version: 999,
      studyProfile: { modelVersion: "future_model" },
    })],
    ["partial current state", JSON.stringify({
      version: 1,
      studyProfile: { modelVersion: "profile_model_v1", answers: {} },
    })],
  ])("fails closed before history reads for an explicit nonempty %s", async (_, state) => {
    const fixture = completeFixture();
    fixture.results.learner_profiles = {
      data: {
        ...(fixture.results.learner_profiles.data as Record<string, unknown>),
        additional_context: JSON.stringify({
          schemaVersion: 3,
          personalizationState: state,
        }),
      },
      error: null,
    };
    const client = fakeClient(fixture.results);
    const result = await loadInjected(client);

    expect(result).toMatchObject({
      status: "degraded",
      reason: "personalization_state_invalid",
      profile: {
        sustainableMinutes: null,
        startingFrictionRisk: null,
        fatigueRisk: null,
        preferredWindow: null,
      },
      recentOutcomes: [],
    });
    expect(result.profileVersion).toContain("degraded");
    expect(result.profileVersion).not.toContain("profile_model_v1");
    expect(client.from).toHaveBeenCalledTimes(1);
  });

  it("keeps an absent legacy state on the structured profile/history path", async () => {
    const fixture = completeFixture();
    fixture.results.learner_profiles = {
      data: {
        ...(fixture.results.learner_profiles.data as Record<string, unknown>),
        additional_context: JSON.stringify({ schemaVersion: 2 }),
      },
      error: null,
    };
    const result = await loadInjected(fakeClient(fixture.results));

    expect(result).toMatchObject({
      status: "ready",
      reason: "loaded",
      profile: {
        sustainableMinutes: 25,
        startingFrictionRisk: "high",
        preferredWindow: "evening",
      },
    });
    expect(result.profile.fatigueRisk).toBeNull();
    expect(result.recentOutcomes).toHaveLength(2);
    expect(result.profileVersion).toBe(
      `authorized_profile_context_v1+${PROFILE_REVISION}+learner_profile_schema_v1+additional_context_v2`,
    );
  });
});

function loadInjected(client: FakeClient) {
  return loadAuthorizedNormalDurationContext({
    supabase: client as unknown as InjectedClient,
    authenticatedUserId: IDS.user,
    now: new Date("2026-08-24T12:00:00.000Z"),
  });
}

function completeFixture() {
  const plan = basePlan();
  const session = plan.sessions[0]!;
  const route = adaptLegacySessionToStudyRoute({ plan, session }).route;
  if (!route) throw new Error("The server-context fixture requires a committed route.");

  const state = {
    ...defaultPersonalizationState(),
    studyProfile: {
      ...defaultPersonalizationState().studyProfile,
      answers: {
        q1: "d" as const,
        q2: "c" as const,
        q11: "c" as const,
        q12: "d" as const,
      },
    },
  };
  const answers = writePersonalizationStateToAnswers([
    "struggle_to_start",
    "",
    "minutes_20_30",
    "",
    "",
    "often_delay",
    "evening",
  ], state);

  const results: Record<string, QueryResult> = {
    learner_profiles: {
      data: {
        user_id: IDS.user,
        common_blocker: "struggle_to_start",
        guidance_preference: null,
        preferred_session_min: 20,
        preferred_session_max: 30,
        explanation_preference: null,
        focus_frequency: null,
        starting_pattern: "often_delay",
        energy_window: "evening",
        primary_improvement_goal: null,
        additional_context: encodeAdditionalLearnerContext(answers),
        profile_version: 1,
        updated_at: PROFILE_UPDATED_AT,
      },
      error: null,
    },
    session_attempts: {
      data: [{
        user_id: IDS.user,
        id: IDS.completion,
        plan_session_id: IDS.session,
        started_at: "2026-08-23T10:00:00.000Z",
        completed_at: "2026-08-23T10:25:00.000Z",
        actual_minutes: 24,
        correct_answers: 4,
        total_answers: 5,
        user_feedback: "about_right",
        result_data: {
          routeRevisionId: route.identity.routeRevisionId,
          plannedMinutes: 25,
        },
      }],
      error: null,
    },
    learning_events: {
      data: [{
        user_id: IDS.user,
        plan_session_id: IDS.session,
        occurred_at: "2026-08-23T11:08:00.000Z",
        event_data: {
          attemptId: IDS.interruption,
          routeRevisionId: route.identity.routeRevisionId,
          startedAt: "2026-08-23T11:00:00.000Z",
          plannedMinutes: 25,
          actualMinutes: 8,
          completedSteps: 1,
          totalSteps: 4,
        },
      }],
      error: null,
    },
    plan_sessions: {
      data: [{
        user_id: IDS.user,
        id: IDS.session,
        plan_id: IDS.plan,
        estimated_minutes: 25,
        step_data: {},
        committed_route_revision_id: route.identity.routeRevisionId,
      }],
      error: null,
    },
    plans: {
      data: [{ user_id: IDS.user, id: IDS.plan }],
      error: null,
    },
    study_routes: {
      data: [{
        user_id: IDS.user,
        route_revision_id: route.identity.routeRevisionId,
        route_lineage_id: route.identity.routeLineageId,
        revision_number: route.identity.revisionNumber,
        schema_version: route.identity.schemaVersion,
        lifecycle: route.identity.lifecycleStatus,
        plan_id: route.identity.planId,
        plan_session_id: route.identity.sessionId,
        predecessor_revision_id: route.identity.supersedesRevisionId ?? null,
        route_payload: route,
        created_at: route.identity.createdAt,
        committed_at: route.identity.committedAt ?? null,
      }],
      error: null,
    },
  };
  return { plan, route, results };
}

function basePlan(): LearningPlan {
  return {
    id: IDS.plan,
    learningItemId: IDS.item,
    title: "Cell biology foundations",
    topic: "How cell membranes regulate transport",
    kind: "topic",
    deadline: null,
    status: "active",
    sourceMode: "yova_generated",
    studyMode: "inside_yova",
    learningIntent: "learn",
    rationale: "Build an accurate model before independent explanation.",
    createdAt: "2026-08-23T09:00:00.000Z",
    sessions: [{
      id: IDS.session,
      sequence: 1,
      title: "Explain membrane transport",
      objective: "Explain how concentration gradients affect transport across a membrane.",
      method: "Self-explanation",
      methodReason: "Explaining the causal relationship exposes gaps in the learner's model.",
      scheduledFor: "2026-08-23T10:00:00.000Z",
      estimatedMinutes: 25,
      amountLabel: "One concept · about 25 min",
      learningMode: "learn",
      topicIds: ["77777777-7777-4777-8777-777777777777"],
      completionEvidence: ["Explain the relationship without support."],
      status: "ready",
    }],
  };
}

function fakeClient(
  results: Record<string, QueryResult>,
  authResult: QueryResult = {
    data: { user: { id: IDS.user } },
    error: null,
  },
): FakeClient {
  const operations: QueryOperation[] = [];
  const from = vi.fn((table: string) => {
    const result = () => results[table] ?? { data: [], error: null };
    const query: Record<string, unknown> = {};
    for (const method of ["select", "eq", "not", "order", "in", "limit"]) {
      query[method] = vi.fn((...args: unknown[]) => {
        operations.push({ table, method, args });
        return query;
      });
    }
    query.maybeSingle = vi.fn(async () => result());
    query.then = (resolve: (value: QueryResult) => unknown, reject: (reason: unknown) => unknown) => (
      Promise.resolve(result()).then(resolve, reject)
    );
    return query;
  });
  return {
    auth: { getUser: vi.fn().mockResolvedValue(authResult) },
    from,
    operations,
  };
}

function expectLimit(client: FakeClient, table: string, expected: number) {
  expect(client.operations).toContainEqual({
    table,
    method: "limit",
    args: [expected],
  });
}
