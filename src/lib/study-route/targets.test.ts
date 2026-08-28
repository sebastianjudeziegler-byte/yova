import { describe, expect, it } from "vitest";
import { adaptLegacySessionToStudyRoute } from "@/lib/study-route/adapters";
import { studyRouteGenerationProjection } from "@/lib/study-route/generation-projection";
import { StudyRouteSchema } from "@/lib/study-route/schema";
import { activeStudyRouteTargetIds } from "@/lib/study-route/targets";

describe("active StudyRoute targets", () => {
  it("keeps deferred state in the route without projecting it into the session", () => {
    const firstTarget = "91000000-0000-4000-8000-000000000001";
    const deferredTarget = "91000000-0000-4000-8000-000000000002";
    const session = {
      id: "91000000-0000-4000-8000-000000000003",
      sequence: 1,
      title: "Compare two mechanisms",
      objective: "Explain the active mechanism without reteaching the deferred one.",
      method: "Self-explanation",
      methodReason: "Explaining the causal link makes the active gap visible.",
      scheduledFor: "2026-08-23T12:00:00.000Z",
      estimatedMinutes: 15,
      amountLabel: "One active target · about 15 min",
      learningMode: "learn" as const,
      topicIds: [firstTarget, deferredTarget],
      contentTargets: ["Active mechanism", "Deferred mechanism"],
      completionEvidence: ["Explain the active mechanism without support."],
      status: "ready" as const,
    };
    const plan = {
      id: "91000000-0000-4000-8000-000000000004",
      learningItemId: "91000000-0000-4000-8000-000000000005",
      title: "Mechanism comparison",
      topic: "Compare two mechanisms",
      kind: "topic" as const,
      deadline: null,
      status: "active" as const,
      sourceMode: "yova_generated" as const,
      studyMode: "inside_yova" as const,
      learningIntent: "learn" as const,
      rationale: "Teach one coherent target and defer the second target visibly.",
      createdAt: "2026-08-23T10:00:00.000Z",
      sessions: [session],
    };
    const route = adaptLegacySessionToStudyRoute({ plan, session }).route!;
    const deferred = {
      ...route,
      execution: {
        ...route.execution,
        orderedPhases: route.execution.orderedPhases.map((phase) => ({
          ...phase,
          targetIds: [firstTarget],
        })),
        completionEvidence: route.execution.completionEvidence.map((evidence) => ({
          ...evidence,
          targetIds: [firstTarget],
        })),
        deferredTargets: [{
          targetId: deferredTarget,
          reason: "The second target does not fit this session's coherent active recipe.",
        }],
      },
    };

    const parsed = StudyRouteSchema.parse(deferred);
    expect(activeStudyRouteTargetIds(parsed)).toEqual([firstTarget]);
    expect(studyRouteGenerationProjection({
      route: parsed,
      legacy: {
        objective: "Stale objective",
        method: "Stale method",
        methodReason: "Stale reason",
        activeMinutes: 10,
        learningMode: "study",
        executionEnvironment: "outside_yova",
        topicIds: [deferredTarget],
        completionEvidence: ["Stale evidence"],
      },
    }).topicIds).toEqual([firstTarget]);
  });
});
