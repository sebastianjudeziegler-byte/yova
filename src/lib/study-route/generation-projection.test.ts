import { describe, expect, it } from "vitest";
import { adaptLegacySessionToStudyRoute } from "@/lib/study-route/adapters";
import { studyRouteGenerationProjection } from "@/lib/study-route/generation-projection";
import type { LearningPlan } from "@/lib/domain";

describe("StudyRoute generation projection", () => {
  it("replaces every route-owned legacy scalar with the committed decision", () => {
    const plan = fixturePlan();
    const route = adaptLegacySessionToStudyRoute({
      plan,
      session: plan.sessions[0]!,
      adaptedAt: plan.createdAt,
      identity: {
        routeLineageId: "55555555-5555-4555-8555-555555555555",
        routeRevisionId: "66666666-6666-4666-8666-666666666666",
        lifecycleStatus: "committed",
        committedAt: plan.createdAt,
      },
    }).route!;

    expect(studyRouteGenerationProjection({
      route,
      legacy: {
        objective: "Conflicting objective",
        method: "Self-explanation",
        methodReason: "Conflicting reason that should never reach the generator.",
        activeMinutes: 60,
        learningMode: "learn",
        executionEnvironment: "outside_yova",
        topicIds: ["99999999-9999-4999-8999-999999999999"],
        completionEvidence: ["Read the notes for an hour."],
      },
    })).toEqual({
      objective: plan.sessions[0]!.objective,
      method: plan.sessions[0]!.method,
      methodReason: plan.sessions[0]!.methodReason,
      activeMinutes: 15,
      learningMode: "study",
      executionEnvironment: "inside_yova",
      topicIds: plan.sessions[0]!.topicIds,
      completionEvidence: plan.sessions[0]!.completionEvidence,
    });
  });
});

function fixturePlan(): LearningPlan {
  return {
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
}
