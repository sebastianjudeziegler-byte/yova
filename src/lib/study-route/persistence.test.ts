import { describe, expect, it } from "vitest";
import { adaptLegacySessionToStudyRoute } from "@/lib/study-route/adapters";
import { studyRouteFromPersistenceRow } from "@/lib/study-route/persistence";
import type { LearningPlan } from "@/lib/domain";

const plan: LearningPlan = {
  id: "11111111-1111-4111-8111-111111111111",
  learningItemId: "22222222-2222-4222-8222-222222222222",
  title: "Retrieval practice",
  topic: "Why recall should happen before review",
  kind: "topic",
  deadline: null,
  status: "active",
  sourceMode: "yova_generated",
  studyMode: "inside_yova",
  learningIntent: "study",
  rationale: "Use an unsupported attempt before targeted feedback and repair.",
  createdAt: "2026-08-23T09:00:00.000Z",
  sessions: [{
    id: "33333333-3333-4333-8333-333333333333",
    sequence: 1,
    title: "Retrieve before review",
    objective: "Explain why attempting an answer first creates useful evidence.",
    method: "Retrieval practice",
    methodReason: "An unsupported attempt reveals the exact gap before repair.",
    scheduledFor: "2026-08-23T10:00:00.000Z",
    estimatedMinutes: 15,
    amountLabel: "Retrieval practice · about 15 min",
    learningMode: "study",
    topicIds: ["44444444-4444-4444-8444-444444444444"],
    contentTargets: ["The purpose of attempting an answer before review"],
    completionEvidence: ["Explain why the first attempt should happen before answer review"],
    status: "ready",
  }],
};

describe("persisted StudyRoute reconstruction", () => {
  it("rebuilds and validates the canonical identity envelope", () => {
    const route = adaptLegacySessionToStudyRoute({
      plan,
      session: plan.sessions[0]!,
      adaptedAt: "2026-08-23T09:00:00.000Z",
      identity: {
        routeLineageId: "55555555-5555-4555-8555-555555555555",
        routeRevisionId: "66666666-6666-4666-8666-666666666666",
        lifecycleStatus: "committed",
        committedAt: "2026-08-23T09:05:00.000Z",
      },
    }).route!;
    const { identity, ...payload } = route;

    expect(studyRouteFromPersistenceRow({
      route_revision_id: identity.routeRevisionId,
      route_lineage_id: identity.routeLineageId,
      revision_number: identity.revisionNumber,
      schema_version: identity.schemaVersion,
      lifecycle: identity.lifecycleStatus,
      plan_id: identity.planId,
      plan_session_id: identity.sessionId,
      predecessor_revision_id: identity.supersedesRevisionId ?? null,
      route_payload: payload,
      created_at: "2026-08-23 09:00:00+00",
      committed_at: "2026-08-23 09:05:00+00",
    })).toEqual(route);
  });

  it("rejects an invalid semantic payload", () => {
    expect(studyRouteFromPersistenceRow({
      route_revision_id: "66666666-6666-4666-8666-666666666666",
      route_lineage_id: "55555555-5555-4555-8555-555555555555",
      revision_number: 1,
      schema_version: 1,
      lifecycle: "committed",
      plan_id: plan.id,
      plan_session_id: plan.sessions[0]!.id,
      predecessor_revision_id: null,
      route_payload: { target: "not-a-route" },
      created_at: "2026-08-23T09:00:00.000Z",
      committed_at: "2026-08-23T09:05:00.000Z",
    })).toBeNull();
  });
});
