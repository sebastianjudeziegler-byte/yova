import { describe, expect, it } from "vitest";
import type { LearningPlan, LearningPlanSession } from "@/lib/domain";
import { preparePlanAdjustmentStudyRoutes } from "@/lib/study-route/plan-adjustment";
import { createCommittedInitialSessionStudyRoute } from "@/lib/study-route/session-route-creation";

const IDS = {
  plan: "11111111-1111-4111-8111-111111111111",
  item: "22222222-2222-4222-8222-222222222222",
  ordinary: "33333333-3333-4333-8333-333333333333",
  review: "44444444-4444-4444-8444-444444444444",
  split: "55555555-5555-4555-8555-555555555555",
  target: "66666666-6666-4666-8666-666666666666",
  reviewTarget: "77777777-7777-4777-8777-777777777777",
  missing: "88888888-8888-4888-8888-888888888888",
} as const;

const CREATED_AT = "2026-08-23T09:00:00.000Z";
const CHANGED_AT = "2026-08-23T10:00:00.000Z";

function ordinarySession(): LearningPlanSession {
  return {
    id: IDS.ordinary,
    sequence: 1,
    title: "Build the causal model",
    objective: "Explain and apply the causal model independently.",
    method: "Self-explanation",
    methodReason: "Explaining the model exposes gaps before independent application.",
    scheduledFor: "2026-08-24T10:00:00.000Z",
    estimatedMinutes: 20,
    amountLabel: "One target · about 20 min",
    learningMode: "learn",
    topicIds: [IDS.target],
    contentTargets: ["Trace the causal model."],
    completionEvidence: ["Explain the causal model without notes."],
    status: "ready",
  };
}

function reviewSession(): LearningPlanSession {
  return {
    id: IDS.review,
    sequence: 2,
    title: "Verify the causal model",
    objective: "Retrieve and apply the causal model after a delay.",
    method: "Independent retrieval verification",
    methodReason: "A delayed independent check tests retention.",
    scheduledFor: "2026-08-26T10:00:00.000Z",
    estimatedMinutes: 5,
    amountLabel: "Scheduled review · about 5 min",
    learningMode: "study",
    topicIds: [IDS.reviewTarget],
    contentTargets: ["Retrieve the causal model."],
    completionEvidence: ["Answer the verification questions independently."],
    status: "upcoming",
    reviewConcept: "Causal model",
    reviewType: "verify",
  };
}

function basePlan(): LearningPlan {
  return {
    id: IDS.plan,
    learningItemId: IDS.item,
    title: "Causal systems",
    topic: "Causal systems",
    kind: "topic",
    deadline: null,
    status: "active",
    sourceMode: "yova_generated",
    studyMode: "inside_yova",
    learningIntent: "learn",
    rationale: "Build the model, then verify it after a delay.",
    createdAt: CREATED_AT,
    sessions: [ordinarySession(), reviewSession()],
  };
}

function routedPlan(): LearningPlan {
  const plan = basePlan();
  return {
    ...plan,
    sessions: plan.sessions.map((session) => ({
      ...session,
      studyRoute: createCommittedInitialSessionStudyRoute({
        plan,
        session,
        now: CREATED_AT,
        origin: {
          source: "plan_activation",
          reason: "The learner activated the original route.",
        },
      }),
    })),
  };
}

function adjust(
  plan: LearningPlan,
  replacementSessions: LearningPlanSession[],
  nextStudyMode: LearningPlan["studyMode"] = plan.studyMode,
) {
  return preparePlanAdjustmentStudyRoutes({
    plan,
    replacementSessions,
    nextStudyMode,
    changedAt: CHANGED_AT,
    reason: "The learner changed the remaining plan structure.",
  });
}

describe("route-aware plan adjustments", () => {
  it("keeps a fully legacy replacement set route-free", () => {
    const plan = basePlan();
    const replacements = plan.sessions.map((session, index) => ({
      ...session,
      sequence: index + 4,
    }));

    const result = adjust(plan, replacements);

    expect(result).toBe(replacements);
    expect(result.every((session) => session.studyRoute === undefined)).toBe(true);
  });

  it("fails closed when the current plan is only partially routed", () => {
    const plan = routedPlan();
    const partial = {
      ...plan,
      sessions: [plan.sessions[0]!, { ...plan.sessions[1]!, studyRoute: undefined }],
    };

    expect(() => adjust(partial, partial.sessions)).toThrow("partially routed plan");
  });

  it("preserves the exact scheduled-review route across ordering and schedule changes", () => {
    const plan = routedPlan();
    const review = plan.sessions[1]!;
    const movedReview = {
      ...review,
      sequence: 5,
      scheduledFor: "2026-08-27T12:30:00.000Z",
      studyRoute: undefined,
    };

    const [result] = adjust(plan, [movedReview]);

    expect(result?.studyRoute).toBe(review.studyRoute);
    expect(result?.studyRoute?.identity.routeRevisionId).toBe(
      review.studyRoute?.identity.routeRevisionId,
    );
    expect(result?.studyRoute?.approach.executionEnvironment).toBe("inside_yova");
  });

  it("rejects an environment change that would contradict a preserved review route", () => {
    const plan = routedPlan();

    expect(() => adjust(plan, plan.sessions, "outside_yova")).toThrow(
      "cannot change execution environment while preserving a scheduled review",
    );
  });

  it("keeps the exact pointer for schedule/sequence-only ordinary changes", () => {
    const plan = routedPlan();
    const ordinary = plan.sessions[0]!;
    const moved = {
      ...ordinary,
      sequence: 7,
      scheduledFor: "2026-08-30T14:00:00.000Z",
      studyRoute: undefined,
    };

    const [result] = adjust(plan, [moved]);

    expect(result?.studyRoute).toBe(ordinary.studyRoute);
  });

  it("commits a same-lineage successor for a material scalar or environment change", () => {
    const plan = routedPlan();
    const ordinary = plan.sessions[0]!;
    const resized = {
      ...ordinary,
      estimatedMinutes: 30,
      amountLabel: "One target · about 30 min",
      studyRoute: undefined,
    };

    const [result] = adjust(plan, [resized], "outside_yova");
    const successor = result?.studyRoute;

    expect(successor?.identity).toMatchObject({
      routeLineageId: ordinary.studyRoute?.identity.routeLineageId,
      revisionNumber: 2,
      lifecycleStatus: "committed",
      planId: IDS.plan,
      sessionId: IDS.ordinary,
      supersedesRevisionId: ordinary.studyRoute?.identity.routeRevisionId,
      createdAt: CHANGED_AT,
      committedAt: CHANGED_AT,
    });
    expect(successor?.timing.activeMinutes).toBe(30);
    expect(successor?.timing.durationSource).toBe("learner_override");
    expect(successor?.provenance.profileVersion).toBe(
      ordinary.studyRoute?.provenance.profileVersion,
    );
    expect(successor?.provenance.ruleTrace).toContainEqual(expect.objectContaining({
      ruleId: "duration.learner_override",
      result: "selected_30_minutes",
    }));
    expect(successor?.approach.executionEnvironment).toBe("outside_yova");
  });

  it("retains the complete normal-plan router chain on a post-activation successor", () => {
    const plan = routedPlan();
    const ordinary = plan.sessions[0]!;
    const routerComponents = [
      "legacy_adapter_v1",
      "normal_plan_envelope_route_integration_v1",
      "normal_plan_envelope_composer_v1",
      "normal_duration_recommender_v1",
      "study_route_method_plan_integration_v1",
      "method_runtime_capability_v1",
    ];
    const routedOrdinary = {
      ...ordinary,
      studyRoute: {
        ...ordinary.studyRoute!,
        provenance: {
          ...ordinary.studyRoute!.provenance,
          routerVersion: routerComponents.join("+"),
        },
      },
    };
    const normalPlan = {
      ...plan,
      sessions: [routedOrdinary, plan.sessions[1]!],
    };
    const resized = {
      ...routedOrdinary,
      estimatedMinutes: 30,
      amountLabel: "One target · about 30 min",
      studyRoute: undefined,
    };

    const [result] = adjust(normalPlan, [resized]);
    const components = result?.studyRoute?.provenance.routerVersion.split("+");

    expect(components).toEqual([
      ...routerComponents,
      "post_activation_session_route_v1",
    ]);
    expect(result?.studyRoute?.provenance.routerVersion.length).toBeLessThanOrEqual(256);
  });

  it("preserves personalized timing and its history when only the method changes", () => {
    const plan = routedPlan();
    const ordinary = plan.sessions[0]!;
    const personalizedRoute = {
      ...ordinary.studyRoute!,
      timing: {
        ...ordinary.studyRoute!.timing,
        durationSource: "profile_recommendation" as const,
        hardMaximumMinutes: 40,
      },
      provenance: {
        ...ordinary.studyRoute!.provenance,
        profileVersion: "normal_duration_context_v1+profile_snapshot_7",
        ruleTrace: [
          ...ordinary.studyRoute!.provenance.ruleTrace,
          {
            ruleId: "duration.profile_baseline",
            result: "recommended_20_minutes",
            reason: "The authorized profile supplied the sustainable session baseline.",
            evidenceRefs: ["profile:snapshot:7"],
          },
        ],
        evidenceRefs: [
          ...ordinary.studyRoute!.provenance.evidenceRefs,
          "profile:snapshot:7",
        ],
      },
    };
    const personalizedPlan = {
      ...plan,
      sessions: [
        { ...ordinary, studyRoute: personalizedRoute },
        plan.sessions[1]!,
      ],
    };
    const changedMethod = {
      ...personalizedPlan.sessions[0]!,
      method: "Worked example fading",
      methodReason: "Start with a complete model, then remove support in bounded steps.",
      studyRoute: undefined,
    };

    const [result] = adjust(personalizedPlan, [changedMethod]);

    expect(result?.studyRoute?.timing).toEqual(personalizedRoute.timing);
    expect(result?.studyRoute?.provenance.profileVersion).toBe(
      personalizedRoute.provenance.profileVersion,
    );
    expect(result?.studyRoute?.provenance.ruleTrace).toContainEqual(
      expect.objectContaining({ ruleId: "duration.profile_baseline" }),
    );
    expect(result?.studyRoute?.timing.durationSource).not.toBe("legacy_reconstruction");
  });

  it("gives a new split ID an independent committed lineage pointing to its origin route", () => {
    const plan = routedPlan();
    const origin = plan.sessions[0]!;
    const split: LearningPlanSession = {
      ...ordinarySession(),
      id: IDS.split,
      sequence: 2,
      title: "Build the causal model · Part 2 of 2",
      objective: "Explain and apply the remaining bounded part independently.",
      estimatedMinutes: 10,
      amountLabel: "One split target · about 10 min",
      status: "upcoming",
      originSessionId: IDS.ordinary,
      originalContentMinutes: 20,
      segmentIndex: 2,
      segmentCount: 2,
    };

    const [result] = adjust(plan, [split]);
    const route = result?.studyRoute;

    expect(route?.identity).toMatchObject({
      revisionNumber: 1,
      lifecycleStatus: "committed",
      planId: IDS.plan,
      sessionId: IDS.split,
    });
    expect(route?.identity.routeLineageId).not.toBe(
      origin.studyRoute?.identity.routeLineageId,
    );
    expect(route?.provenance.ruleTrace).toContainEqual(expect.objectContaining({
      result: "plan_adjustment_split",
      evidenceRefs: [`route-revision:${origin.studyRoute?.identity.routeRevisionId}`],
    }));
    expect(route?.timing.durationSource).toBe("learner_override");
    expect(route?.provenance.profileVersion).toBe(
      origin.studyRoute?.provenance.profileVersion,
    );
  });

  it("binds a deferred ID without metadata only when its target has one exact origin", () => {
    const plan = routedPlan();
    const origin = plan.sessions[0]!;
    const deferred: LearningPlanSession = {
      ...ordinarySession(),
      id: IDS.split,
      sequence: 3,
      title: "Continue the deferred target",
      objective: "Complete the exact target deferred from the earlier route.",
      status: "upcoming",
    };

    const [result] = adjust(plan, [deferred]);

    expect(result?.studyRoute?.identity.routeLineageId).not.toBe(
      origin.studyRoute?.identity.routeLineageId,
    );
    expect(result?.studyRoute?.provenance.ruleTrace).toContainEqual(expect.objectContaining({
      result: "plan_adjustment_deferred",
      evidenceRefs: [`route-revision:${origin.studyRoute?.identity.routeRevisionId}`],
    }));
  });

  it("accepts an explicit transaction-only origin for a newly included deferred target", () => {
    const plan = routedPlan();
    const deferred: LearningPlanSession = {
      ...ordinarySession(),
      id: IDS.split,
      topicIds: [IDS.missing],
      title: "Learn the newly included deferred target",
      status: "upcoming",
    };

    const [result] = preparePlanAdjustmentStudyRoutes({
      plan,
      replacementSessions: [deferred],
      nextStudyMode: plan.studyMode,
      changedAt: CHANGED_AT,
      reason: "The learner included a target that was previously deferred.",
      newSessionOriginIds: { [deferred.id]: IDS.ordinary },
    });

    expect(result?.originSessionId).toBeUndefined();
    expect(result?.studyRoute?.provenance.ruleTrace).toContainEqual(expect.objectContaining({
      result: "plan_adjustment_deferred",
      evidenceRefs: [`route-revision:${plan.sessions[0]!.studyRoute?.identity.routeRevisionId}`],
    }));
  });

  it("rejects missing origins and unsupported replacement methods", () => {
    const plan = routedPlan();
    const newWithoutOrigin: LearningPlanSession = {
      ...ordinarySession(),
      id: IDS.split,
      topicIds: [IDS.missing],
    };
    expect(() => adjust(plan, [newWithoutOrigin])).toThrow("origin is missing or ambiguous");

    const crossPlanOrigin = {
      ...newWithoutOrigin,
      originSessionId: IDS.missing,
    };
    expect(() => adjust(plan, [crossPlanOrigin])).toThrow("origin is missing from this plan");

    const unsupported = {
      ...plan.sessions[0]!,
      method: "Use my usual approach",
      studyRoute: undefined,
    };
    expect(() => adjust(plan, [unsupported])).toThrow("does not map to a supported StudyRoute");
  });

  it("rejects material edits to a protected scheduled review", () => {
    const plan = routedPlan();
    const changedReview = {
      ...plan.sessions[1]!,
      estimatedMinutes: 10,
      studyRoute: undefined,
    };

    expect(() => adjust(plan, [changedReview])).toThrow(
      "protected scheduled review cannot change its committed StudyRoute",
    );
  });
});
