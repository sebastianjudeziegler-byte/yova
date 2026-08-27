import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LearningPlan, LearningPlanSession } from "@/lib/domain";
import { adaptLegacySessionToStudyRoute } from "@/lib/study-route/adapters";
import {
  CommittedMethodChoiceError,
} from "@/lib/study-route/committed-method-choice";
import { StudyRouteSchema, type StudyRoute } from "@/lib/study-route/schema";

vi.mock("server-only", () => ({}));

const USER_ID = "11111111-1111-4111-8111-111111111111";
const PLAN_ID = "22222222-2222-4222-8222-222222222222";
const ITEM_ID = "33333333-3333-4333-8333-333333333333";
const SESSION_ID = "44444444-4444-4444-8444-444444444444";
const CHANGE_ID = "55555555-5555-4555-8555-555555555555";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  rpc: vi.fn(),
  from: vi.fn(),
  createServer: vi.fn(),
  routeFromRow: vi.fn(),
  createChoice: vi.fn(),
  tableResults: new Map<string, { data: unknown; error: unknown }>(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: mocks.createServer,
}));
vi.mock("@/lib/study-route/persistence", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/study-route/persistence")>();
  return { ...actual, studyRouteFromPersistenceRow: mocks.routeFromRow };
});
vi.mock("@/lib/study-route/committed-method-choice", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/study-route/committed-method-choice")>();
  return { ...actual, createCommittedMethodChoiceSuccessor: mocks.createChoice };
});

import { PATCH } from "@/app/api/sessions/method-choice/route";

describe("saved-session method choice route", () => {
  let previous: StudyRoute;
  let successor: StudyRoute;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.tableResults.clear();
    previous = committedRoute();
    successor = directSuccessor(previous);
    const projection = {
      id: SESSION_ID,
      method: successor.approach.visibleMethodName,
      methodReason: successor.explanation.shortReason,
      estimatedMinutes: successor.timing.activeMinutes,
      studyRoute: successor,
    };
    mocks.getUser.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });
    mocks.rpc.mockResolvedValue({
      data: {
        status: "updated",
        planId: PLAN_ID,
        planSessionId: SESSION_ID,
        previousRouteRevisionId: previous.identity.routeRevisionId,
        session: projection,
      },
      error: null,
    });
    mocks.routeFromRow.mockReturnValue(previous);
    mocks.createChoice.mockReturnValue({ status: "updated", session: projection });
    mocks.tableResults.set("plans", {
      data: { id: PLAN_ID, learning_item_id: ITEM_ID, status: "active" },
      error: null,
    });
    mocks.tableResults.set("plan_sessions", {
      data: sessionRow(previous),
      error: null,
    });
    mocks.tableResults.set("learning_items", {
      data: { source_mode: "yova_generated", study_mode: "inside_yova" },
      error: null,
    });
    mocks.tableResults.set("study_routes", { data: { route_revision_id: previous.identity.routeRevisionId }, error: null });
    mocks.from.mockImplementation((table: string) => queryFor(table));
    mocks.createServer.mockResolvedValue({
      auth: { getUser: mocks.getUser },
      from: mocks.from,
      rpc: mocks.rpc,
    });
  });

  it("constructs and atomically commits only the exact direct successor", async () => {
    const response = await PATCH(choiceRequest());

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      status: "updated",
      planId: PLAN_ID,
      planSessionId: SESSION_ID,
      previousRouteRevisionId: previous.identity.routeRevisionId,
      session: {
        id: SESSION_ID,
        studyRoute: { identity: { routeRevisionId: CHANGE_ID } },
      },
    });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.createChoice).toHaveBeenCalledWith(expect.objectContaining({
      expectedRouteRevisionId: previous.identity.routeRevisionId,
      routeRevisionId: CHANGE_ID,
      methodId: "self_explanation",
      previousRoute: previous,
    }));
    expect(mocks.rpc).toHaveBeenCalledWith(
      "change_plan_session_method_with_route",
      { payload: {
        planId: PLAN_ID,
        planSessionId: SESSION_ID,
        expectedRouteRevisionId: previous.identity.routeRevisionId,
        successorStudyRoute: successor,
      } },
    );
  });

  it("replays the exact stored successor before constructing another route", async () => {
    mocks.tableResults.set("plan_sessions", {
      data: sessionRow(successor, CHANGE_ID),
      error: null,
    });
    mocks.routeFromRow.mockReturnValue(successor);
    mocks.rpc.mockResolvedValueOnce({
      data: {
        status: "replayed",
        planId: PLAN_ID,
        planSessionId: SESSION_ID,
        previousRouteRevisionId: previous.identity.routeRevisionId,
        session: {
          id: SESSION_ID,
          method: successor.approach.visibleMethodName,
          methodReason: successor.explanation.shortReason,
          estimatedMinutes: successor.timing.activeMinutes,
          studyRoute: successor,
        },
      },
      error: null,
    });

    const response = await PATCH(choiceRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ status: "replayed" });
    expect(mocks.createChoice).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledWith(
      "change_plan_session_method_with_route",
      { payload: expect.objectContaining({ successorStudyRoute: successor }) },
    );
  });

  it("rejects stale pointers and hidden methods without invoking persistence", async () => {
    mocks.tableResults.set("plan_sessions", {
      data: {
        ...sessionRow(previous),
        committed_route_revision_id: "66666666-6666-4666-8666-666666666666",
      },
      error: null,
    });
    const stale = await PATCH(choiceRequest());
    expect(stale.status).toBe(409);
    expect(mocks.rpc).not.toHaveBeenCalled();

    mocks.tableResults.set("plan_sessions", { data: sessionRow(previous), error: null });
    mocks.createChoice.mockImplementationOnce(() => {
      throw new CommittedMethodChoiceError(
        "method_not_offered",
        "not offered",
      );
    });
    const hidden = await PATCH(choiceRequest());
    expect(hidden.status).toBe(409);
    await expect(hidden.json()).resolves.toMatchObject({ code: "method_not_offered" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("rejects a hand-crafted current-method no-op instead of returning an unlocked read", async () => {
    const response = await PATCH(choiceRequest({
      methodId: previous.approach.primaryMethodId,
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "session_method_choice_unchanged",
    });
    expect(mocks.createChoice).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("maps explicit stale and blocked persistence conflicts to 409 responses", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: {
        code: "40001",
        message: "post_commit_method_choice_stale_revision",
        details: null,
        hint: null,
      },
    });

    const response = await PATCH(choiceRequest());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "session_method_choice_stale",
    });

    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: {
        code: "55000",
        message: "post_commit_method_choice_saved_work_protected",
        details: null,
        hint: null,
      },
    });

    const blockedResponse = await PATCH(choiceRequest());

    expect(blockedResponse.status).toBe(409);
    await expect(blockedResponse.json()).resolves.toMatchObject({
      code: "session_method_choice_blocked",
    });
  });

  it("returns retryable 503 responses for normalized and thrown RPC failures", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: {
        code: "",
        message: "TypeError: fetch failed",
        details: "",
        hint: "",
      },
    });

    const normalizedFailure = await PATCH(choiceRequest());

    expect(normalizedFailure.status).toBe(503);
    await expect(normalizedFailure.json()).resolves.toMatchObject({
      code: "session_method_choice_retryable",
    });

    mocks.rpc.mockRejectedValueOnce(new TypeError("fetch failed"));

    const thrownFailure = await PATCH(choiceRequest());

    expect(thrownFailure.status).toBe(503);
    await expect(thrownFailure.json()).resolves.toMatchObject({
      code: "session_method_choice_retryable",
    });
  });

  it("rejects an RPC readback whose legacy scalars disagree with its route", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: {
        status: "updated",
        planId: PLAN_ID,
        planSessionId: SESSION_ID,
        previousRouteRevisionId: previous.identity.routeRevisionId,
        session: {
          id: SESSION_ID,
          method: "Forged method label",
          methodReason: successor.explanation.shortReason,
          estimatedMinutes: successor.timing.activeMinutes,
          studyRoute: successor,
        },
      },
      error: null,
    });

    const response = await PATCH(choiceRequest());

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      code: "session_method_choice_receipt_invalid",
    });
  });

  it("requires authentication and a fresh typed operation identifier", async () => {
    mocks.getUser.mockResolvedValueOnce({ data: { user: null }, error: null });
    const signedOut = await PATCH(choiceRequest());
    expect(signedOut.status).toBe(401);

    const invalid = await PATCH(choiceRequest({
      changeRequestId: previous.identity.routeRevisionId,
    }));
    expect(invalid.status).toBe(422);
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  function choiceRequest(overrides: Record<string, unknown> = {}) {
    return new Request("https://yova.example/api/sessions/method-choice", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        planId: PLAN_ID,
        planSessionId: SESSION_ID,
        expectedRouteRevisionId: previous.identity.routeRevisionId,
        changeRequestId: CHANGE_ID,
        methodId: "self_explanation",
        ...overrides,
      }),
    });
  }
});

function queryFor(table: string) {
  const builder: Record<string, unknown> = {};
  builder.select = vi.fn(() => builder);
  builder.eq = vi.fn(() => builder);
  builder.maybeSingle = vi.fn(async () => (
    mocks.tableResults.get(table) ?? { data: null, error: null }
  ));
  return builder;
}

function basePlanAndSession(): { plan: LearningPlan; session: LearningPlanSession } {
  const session: LearningPlanSession = {
    id: SESSION_ID,
    sequence: 1,
    title: "Understand the product rule",
    objective: "Explain why the product rule has two terms, then solve one unfamiliar problem independently.",
    method: "Worked example fading",
    methodReason: "A worked example makes the new procedure visible before support fades.",
    scheduledFor: "2026-08-24T13:00:00.000Z",
    estimatedMinutes: 25,
    amountLabel: "25 min",
    learningMode: "learn",
    topicIds: ["77777777-7777-4777-8777-777777777777"],
    contentTargets: ["Product rule"],
    completionEvidence: ["Solve one unfamiliar product-rule problem without hints."],
    status: "ready",
  };
  return {
    session,
    plan: {
      id: PLAN_ID,
      learningItemId: ITEM_ID,
      title: "Calculus",
      topic: "Product rule",
      kind: "course",
      deadline: "2026-09-10T20:00:00.000Z",
      status: "active",
      sourceMode: "yova_generated",
      studyMode: "inside_yova",
      learningIntent: "learn",
      rationale: "Learn then practice.",
      createdAt: "2026-08-24T12:00:00.000Z",
      sessions: [session],
    },
  };
}

function committedRoute() {
  const { plan, session } = basePlanAndSession();
  const adaptation = adaptLegacySessionToStudyRoute({
    plan,
    session,
    adaptedAt: "2026-08-24T12:00:00.000Z",
    identity: {
      routeLineageId: "88888888-8888-4888-8888-888888888888",
      routeRevisionId: "99999999-9999-4999-8999-999999999999",
      revisionNumber: 1,
      lifecycleStatus: "committed",
      createdAt: "2026-08-24T12:00:00.000Z",
      committedAt: "2026-08-24T12:01:00.000Z",
    },
  });
  return StudyRouteSchema.parse(adaptation.route);
}

function directSuccessor(previous: StudyRoute) {
  return StudyRouteSchema.parse({
    ...previous,
    identity: {
      ...previous.identity,
      routeRevisionId: CHANGE_ID,
      revisionNumber: previous.identity.revisionNumber + 1,
      lifecycleStatus: "committed",
      createdAt: "2026-08-24T12:05:00.000Z",
      committedAt: "2026-08-24T12:05:00.000Z",
      supersedesRevisionId: previous.identity.routeRevisionId,
    },
    approach: {
      ...previous.approach,
      primaryMethodId: "self_explanation",
      visibleMethodName: "Self-explanation",
    },
    explanation: {
      ...previous.explanation,
      shortReason: "You chose Self-explanation from the methods that also fit this exact session.",
    },
  });
}

function sessionRow(route: StudyRoute, pointer = route.identity.routeRevisionId) {
  return {
    id: SESSION_ID,
    plan_id: PLAN_ID,
    objective: route.target.desiredOutcome,
    method: route.approach.visibleMethodName,
    method_rationale: route.explanation.shortReason,
    estimated_minutes: route.timing.activeMinutes,
    status: "ready",
    step_data: {
      learningMode: route.approach.mode === "learn" ? "learn" : "study",
      topicIds: route.target.targetStates.map((target) => target.targetId),
      completionEvidence: route.execution.completionEvidence.map((evidence) => evidence.description),
    },
    committed_route_revision_id: pointer,
  };
}
