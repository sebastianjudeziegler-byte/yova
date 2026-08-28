import { describe, expect, it } from "vitest";
import type { LearningPlan } from "@/lib/domain";
import { commitPlanStudyRoutes } from "@/lib/study-route/activation";
import { legacyPlanSessionToStudyRoute } from "@/lib/study-route/adapters";

function draftPlan(): LearningPlan {
  const plan: LearningPlan = {
    id: "11111111-1111-4111-8111-111111111111",
    learningItemId: "22222222-2222-4222-8222-222222222222",
    title: "Photosynthesis",
    topic: "Photosynthesis",
    kind: "test",
    deadline: null,
    status: "draft",
    sourceMode: "yova_generated",
    studyMode: "inside_yova",
    learningIntent: "learn",
    rationale: "Build one accurate model and then explain it independently.",
    createdAt: "2026-08-23T09:00:00.000Z",
    materials: [],
    sessions: [{
      id: "33333333-3333-4333-8333-333333333333",
      sequence: 1,
      title: "Explain photosynthesis",
      objective: "Explain how light energy becomes stored chemical energy.",
      method: "Self-explanation",
      methodReason: "A concise model followed by explanation fits this new causal process.",
      scheduledFor: "2026-08-23T10:00:00.000Z",
      estimatedMinutes: 15,
      amountLabel: "One process · about 15 min",
      learningMode: "learn",
      topicIds: ["44444444-4444-4444-8444-444444444444"],
      completionEvidence: ["Explain the energy transformation without looking at the model."],
      status: "ready",
    }],
  };
  plan.sessions[0]!.studyRoute = legacyPlanSessionToStudyRoute({
    plan,
    session: plan.sessions[0]!,
    adaptedAt: plan.createdAt,
    identity: {
      routeLineageId: "55555555-5555-4555-8555-555555555555",
      routeRevisionId: "66666666-6666-4666-8666-666666666666",
      lifecycleStatus: "provisional",
    },
  })!;
  return plan;
}

describe("StudyRoute plan activation", () => {
  it("commits the reviewed revision without changing its identity", () => {
    const draft = draftPlan();
    const active = commitPlanStudyRoutes(
      { ...draft, status: "active" },
      "2026-08-23T09:05:00.000Z",
    );

    expect(active.sessions[0]?.studyRoute?.identity).toMatchObject({
      routeLineageId: draft.sessions[0]?.studyRoute?.identity.routeLineageId,
      routeRevisionId: draft.sessions[0]?.studyRoute?.identity.routeRevisionId,
      revisionNumber: 1,
      lifecycleStatus: "committed",
      committedAt: "2026-08-23T09:05:00.000Z",
    });
    expect(draft.sessions[0]?.studyRoute?.identity.lifecycleStatus).toBe("provisional");
  });

  it("is idempotent for an already committed route", () => {
    const once = commitPlanStudyRoutes(draftPlan(), "2026-08-23T09:05:00.000Z");
    const twice = commitPlanStudyRoutes(once, "2026-08-23T09:10:00.000Z");

    expect(twice.sessions[0]?.studyRoute).toEqual(once.sessions[0]?.studyRoute);
  });
});
