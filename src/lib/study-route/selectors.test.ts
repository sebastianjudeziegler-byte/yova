import { describe, expect, it } from "vitest";
import type { LearningPlan, LearningPlanSession } from "@/lib/domain";
import {
  resolveExecutedStudyRouteSessionContract,
  resolveExecutedStudyRoute,
  resolvePlannedStudyRoute,
  resolveStudyRouteSessionContract,
  selectSessionActiveMinutes,
  selectSessionExecutionEnvironment,
  selectSessionLearningMode,
  selectSessionMethodName,
  selectSessionMethodReason,
} from "@/lib/study-route/selectors";

function legacyPlan(): LearningPlan {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    learningItemId: "22222222-2222-4222-8222-222222222222",
    title: "Algebra review",
    topic: "Linear equations",
    kind: "test",
    deadline: null,
    status: "active",
    sourceMode: "yova_generated",
    studyMode: "inside_yova",
    learningIntent: "study",
    rationale: "Use a bounded review before the assessment.",
    createdAt: "2026-08-23T09:00:00.000Z",
    materials: [],
    sessions: [{
      id: "33333333-3333-4333-8333-333333333333",
      sequence: 1,
      title: "Retrieve linear-equation steps",
      objective: "Solve and explain one linear equation without notes.",
      method: "Retrieval practice",
      methodReason: "An unsupported attempt exposes the exact step that still needs repair.",
      scheduledFor: "2026-08-23T10:00:00.000Z",
      estimatedMinutes: 15,
      amountLabel: "One target · about 15 min",
      learningMode: "study",
      topicIds: ["44444444-4444-4444-8444-444444444444"],
      contentTargets: ["Solve a linear equation"],
      completionEvidence: ["Solve and explain one equation without notes."],
      status: "ready",
    }],
  };
}

describe("StudyRoute selectors", () => {
  it("keeps every legacy learner-facing scalar identical through reconstruction", () => {
    const plan = legacyPlan();
    const session = plan.sessions[0]!;

    expect(resolvePlannedStudyRoute(plan, session).source).toBe("legacy_plan");
    expect(selectSessionMethodName(plan, session)).toBe(session.method);
    expect(selectSessionMethodReason(plan, session)).toBe(session.methodReason);
    expect(selectSessionActiveMinutes(plan, session)).toBe(session.estimatedMinutes);
    expect(selectSessionLearningMode(plan, session)).toBe(session.learningMode);
    expect(selectSessionExecutionEnvironment(plan, session)).toBe(plan.studyMode);
  });

  it("falls back to untouched scalars when ambiguous prose cannot be canonicalized", () => {
    const plan = legacyPlan();
    const session = {
      ...plan.sessions[0]!,
      method: "Use my usual approach",
      methodReason: "Keep the existing legacy promise exactly as it was shown.",
    };

    expect(resolvePlannedStudyRoute(plan, session)).toEqual({
      route: null,
      source: "legacy_scalar",
    });
    expect(selectSessionMethodName(plan, session)).toBe(session.method);
    expect(selectSessionMethodReason(plan, session)).toBe(session.methodReason);
  });

  it("prefers one valid stored route over both legacy reconstruction and generated output", () => {
    const plan = legacyPlan();
    const legacySession = plan.sessions[0]!;
    const route = resolvePlannedStudyRoute(plan, legacySession).route!;
    const storedRoute = {
      ...route,
      approach: {
        ...route.approach,
        visibleMethodName: "Stored canonical method name",
      },
      explanation: {
        ...route.explanation,
        shortReason: "The committed route remains authoritative across every learner-facing surface.",
      },
    };
    const session = {
      ...legacySession,
      studyRoute: storedRoute,
      resource: {
        rationale: "A resource must not silently replace the stored route.",
        activities: [],
        generatedAt: "2026-08-23T09:30:00.000Z",
        origin: "built_in" as const,
      },
    };

    expect(resolvePlannedStudyRoute(plan, session).source).toBe("stored");
    expect(resolveExecutedStudyRoute(plan, session).source).toBe("stored");
    expect(resolveExecutedStudyRouteSessionContract(plan, session).session.method)
      .toBe("Stored canonical method name");
    expect(selectSessionMethodName(plan, session)).toBe("Stored canonical method name");
  });

  it("ignores a malformed stored route and retains a safe legacy fallback", () => {
    const plan = legacyPlan();
    const session = {
      ...plan.sessions[0]!,
      studyRoute: { identity: { routeRevisionId: "not-a-route" } },
    } as unknown as LearningPlanSession;

    expect(resolvePlannedStudyRoute(plan, session).source).toBe("legacy_plan");
    expect(selectSessionMethodName(plan, session)).toBe(plan.sessions[0]!.method);
  });

  it("projects one stored route into the legacy plan/session boundary", () => {
    const plan = legacyPlan();
    const session = plan.sessions[0]!;
    const route = resolvePlannedStudyRoute(plan, session).route!;
    const stored = {
      ...session,
      method: "Stale scalar method",
      methodReason: "This stale scalar reason must not become a second route authority.",
      studyRoute: {
        ...route,
        approach: {
          ...route.approach,
          executionEnvironment: "outside_yova" as const,
          visibleMethodName: "Committed retrieval route",
        },
        explanation: {
          ...route.explanation,
          shortReason: "The committed route is the learner-facing promise for this session.",
        },
      },
    };

    const contract = resolveStudyRouteSessionContract(plan, stored);

    expect(contract.resolution.source).toBe("stored");
    expect(contract.plan.studyMode).toBe("outside_yova");
    expect(contract.session).toMatchObject({
      method: "Committed retrieval route",
      methodReason: "The committed route is the learner-facing promise for this session.",
      estimatedMinutes: route.timing.activeMinutes,
      learningMode: "study",
    });
  });

  it("uses the validated executed method only when recovering a route-free legacy resource", () => {
    const plan = legacyPlan();
    const legacySession: LearningPlanSession = {
      ...plan.sessions[0]!,
      method: "Practice test and error repair",
      methodReason: "The old plan scalar promised a practice test and targeted repair.",
      resource: {
        schemaVersion: 15,
        topicIds: ["44444444-4444-4444-8444-444444444444"],
        rationale: "The saved lesson executes an Active Recall round.",
        methodBriefing: {
          learningMode: "study",
          taskType: "conceptual_learning",
          methodId: "retrieval_practice",
          name: "Active Recall",
          what: "Retrieve the relationship before reviewing it.",
          why: "The saved activity begins with unsupported recall.",
          how: ["Recall first.", "Check and repair."],
          completion: "Complete the recall and repair.",
          personalization: [],
        },
        activities: [],
        generatedAt: "2026-08-23T09:30:00.000Z",
        origin: "generated",
      },
    };

    const planned = resolveStudyRouteSessionContract(plan, legacySession);
    const recovery = resolveExecutedStudyRouteSessionContract(plan, legacySession);

    expect(planned.resolution.source).toBe("legacy_plan");
    expect(planned.session.method).toBe("Practice test and error repair");
    expect(recovery.resolution.source).toBe("executed_resource");
    expect(recovery.session.method).toBe("Active Recall");
    expect(recovery.session.methodReason).toBe(
      "The saved activity begins with unsupported recall.",
    );
  });
});
