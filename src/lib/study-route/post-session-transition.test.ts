import { describe, expect, it } from "vitest";
import type { LearningPlan, LearningPlanSession, NextSessionAdaptation } from "@/lib/domain";
import {
  prepareConceptReviewSessionStudyRoute,
  preparePostSessionStudyRouteTransition,
} from "@/lib/study-route/post-session-transition";
import { STUDY_ROUTE_AGENCY_MODE_CONTROLLER_VERSION } from "@/lib/study-route/agency-mode-controller";
import { createCommittedInitialSessionStudyRoute } from "@/lib/study-route/session-route-creation";
import {
  StudyRouteSchema,
  type StudyRouteControlMode,
} from "@/lib/study-route/schema";

const IDS = {
  plan: "11111111-1111-4111-8111-111111111111",
  item: "22222222-2222-4222-8222-222222222222",
  completed: "33333333-3333-4333-8333-333333333333",
  next: "44444444-4444-4444-8444-444444444444",
  followUp: "55555555-5555-4555-8555-555555555555",
  completedTarget: "66666666-6666-4666-8666-666666666666",
  nextTarget: "77777777-7777-4777-8777-777777777777",
} as const;
const CREATED_AT = "2026-08-23T09:00:00.000Z";
const CHANGED_AT = "2026-08-23T10:00:00.000Z";

function session(
  id: string,
  sequence: number,
  status: LearningPlanSession["status"],
  method: string,
  topicId: string,
): LearningPlanSession {
  return {
    id,
    sequence,
    title: `Session ${sequence}`,
    objective: `Explain and apply the planned target for session ${sequence}.`,
    method,
    methodReason: "This evidence-backed method matches the current target and stage.",
    scheduledFor: `2026-08-${23 + sequence}T10:00:00.000Z`,
    estimatedMinutes: 15,
    amountLabel: "One target · about 15 min",
    learningMode: sequence === 1 ? "learn" : "study",
    topicIds: [topicId],
    contentTargets: [`Target ${sequence}`],
    completionEvidence: [`Explain target ${sequence} without notes.`],
    status,
  };
}

function basePlan(): LearningPlan {
  return {
    id: IDS.plan,
    learningItemId: IDS.item,
    title: "Cell respiration",
    topic: "Cell respiration",
    kind: "test",
    deadline: null,
    status: "active",
    sourceMode: "yova_generated",
    studyMode: "inside_yova",
    learningIntent: "learn",
    rationale: "Learn the mechanism, then retrieve and apply it.",
    createdAt: CREATED_AT,
    sessions: [
      session(IDS.completed, 1, "ready", "Self-explanation", IDS.completedTarget),
      session(IDS.next, 2, "upcoming", "Retrieval practice", IDS.nextTarget),
    ],
  };
}

function routedPlan(controlMode: StudyRouteControlMode = "legacy_unknown") {
  const plan = basePlan();
  return {
    ...plan,
    sessions: plan.sessions.map((current) => {
      const route = createCommittedInitialSessionStudyRoute({
        plan,
        session: current,
        now: CREATED_AT,
        origin: {
          source: "plan_activation",
          reason: "The learner activated this planned session.",
        },
      });
      return {
        ...current,
        studyRoute: StudyRouteSchema.parse({
          ...route,
          agency: {
            ...route.agency,
            controlMode,
          },
        }),
      };
    }),
  };
}

function adaptation(): NextSessionAdaptation {
  return {
    planSessionId: IDS.next,
    title: "Session 2",
    objective: "Explain and apply the planned target for session 2.",
    method: "Independent application and mixed practice",
    methodReason: "The earlier target was secure, so the next session can begin with transfer and discrimination.",
    estimatedMinutes: 15,
    amountLabel: "One target · about 15 min",
    learningMode: "study",
    explanation: "YOVA increased challenge after a strong independent result while preserving the planned target.",
  };
}

function followUp(): LearningPlanSession {
  return {
    ...session(
      IDS.followUp,
      2,
      "ready",
      "Independent retrieval verification",
      IDS.completedTarget,
    ),
    title: "Verify the completed target",
    objective: "Retrieve and apply the completed target after a delay.",
    estimatedMinutes: 5,
    amountLabel: "Scheduled review · about 5 min",
    learningMode: "study",
    reviewConcept: "Completed target",
    reviewType: "verify",
  };
}

describe("post-session StudyRoute transition", () => {
  it("keeps a fully legacy completion route-free", () => {
    const review = followUp();
    expect(preparePostSessionStudyRouteTransition({
      plan: basePlan(),
      completedSessionId: IDS.completed,
      changedAt: CHANGED_AT,
      followUpSession: review,
    })).toEqual({
      nextSessionStudyRoute: null,
      followUpSession: review,
      continuationSession: null,
    });
  });

  it("creates a committed material successor for an adapted existing session", () => {
    const plan = routedPlan();
    const previous = plan.sessions[1]!.studyRoute;
    const result = preparePostSessionStudyRouteTransition({
      plan,
      completedSessionId: IDS.completed,
      changedAt: CHANGED_AT,
      adaptation: adaptation(),
    });

    expect(result.nextSessionStudyRoute).toMatchObject({
      identity: {
        routeLineageId: previous.identity.routeLineageId,
        revisionNumber: 2,
        lifecycleStatus: "committed",
        planId: IDS.plan,
        sessionId: IDS.next,
        supersedesRevisionId: previous.identity.routeRevisionId,
      },
      approach: {
        primaryMethodId: "interleaved_practice",
        visibleMethodName: "Independent application and mixed practice",
      },
    });
    expect(result.nextSessionStudyRoute?.provenance.evidenceRefs).toContain(
      `route-revision:${plan.sessions[0]!.studyRoute.identity.routeRevisionId}`,
    );
  });

  it("auto-applies a supported between-session recommendation in YOVA Decides", () => {
    const plan = routedPlan("yova_decides");
    const previous = plan.sessions[1]!.studyRoute;
    const result = preparePostSessionStudyRouteTransition({
      plan,
      completedSessionId: IDS.completed,
      changedAt: CHANGED_AT,
      adaptation: adaptation(),
      adaptationAgency: {
        changeKind: "system_recommendation",
        support: "sufficient",
      },
    });

    expect(result.adaptationAgencyDecision).toMatchObject({
      policyVersion: STUDY_ROUTE_AGENCY_MODE_CONTROLLER_VERSION,
      status: "applied",
      mode: "yova_decides",
      reasonCode: "agency_policy_applied",
      supersededRoute: {
        identity: {
          routeRevisionId: previous.identity.routeRevisionId,
          lifecycleStatus: "superseded",
        },
      },
    });
    expect(result.appliedAdaptation).toEqual(adaptation());
    expect(result.nextSessionStudyRoute?.identity).toMatchObject({
      lifecycleStatus: "committed",
      supersedesRevisionId: previous.identity.routeRevisionId,
    });
  });

  it("requires exact confirmation when a historical route did not record agency authority", () => {
    const plan = routedPlan("legacy_unknown");
    const result = preparePostSessionStudyRouteTransition({
      plan,
      completedSessionId: IDS.completed,
      changedAt: CHANGED_AT,
      adaptation: adaptation(),
      adaptationAgency: {
        changeKind: "system_recommendation",
        support: "sufficient",
      },
    });

    expect(result.nextSessionStudyRoute).toBeNull();
    expect(result.appliedAdaptation).toBeNull();
    expect(result.adaptationAgencyDecision).toMatchObject({
      status: "confirmation_required",
      mode: "help_me_choose",
      reasonCode: "exact_confirmation_required",
      requiredConfirmation: {
        expectedRouteRevisionId: plan.sessions[1]!.studyRoute!.identity.routeRevisionId,
      },
    });
  });

  it("keeps the exact Help Me Choose candidate provisional until confirmation", () => {
    const plan = routedPlan("help_me_choose");
    const first = preparePostSessionStudyRouteTransition({
      plan,
      completedSessionId: IDS.completed,
      changedAt: CHANGED_AT,
      adaptation: adaptation(),
      adaptationAgency: {
        changeKind: "system_recommendation",
        support: "sufficient",
      },
    });
    const required = first.adaptationAgencyDecision?.requiredConfirmation;
    const candidate = first.adaptationAgencyDecision?.candidateRoute;

    expect(first.nextSessionStudyRoute).toBeNull();
    expect(first.appliedAdaptation).toBeNull();
    expect(first.adaptationAgencyDecision).toMatchObject({
      status: "confirmation_required",
      mode: "help_me_choose",
      reasonCode: "exact_confirmation_required",
      candidateRoute: { identity: { lifecycleStatus: "provisional" } },
    });
    expect(required).not.toBeNull();
    expect(candidate).not.toBeNull();

    const confirmedAt = "2026-08-23T10:05:00.000Z";
    const confirmed = preparePostSessionStudyRouteTransition({
      plan,
      completedSessionId: IDS.completed,
      changedAt: CHANGED_AT,
      adaptation: adaptation(),
      adaptationAgency: {
        changeKind: "system_recommendation",
        support: "sufficient",
        candidateRoute: candidate!,
        confirmation: {
          policyVersion: STUDY_ROUTE_AGENCY_MODE_CONTROLLER_VERSION,
          expectedRouteRevisionId: required!.expectedRouteRevisionId,
          candidateRouteRevisionId: required!.candidateRouteRevisionId,
          confirmedAt,
        },
      },
    });

    expect(confirmed.adaptationAgencyDecision?.status).toBe("applied");
    expect(confirmed.appliedAdaptation).toEqual(adaptation());
    expect(confirmed.nextSessionStudyRoute?.identity).toMatchObject({
      routeRevisionId: required!.candidateRouteRevisionId,
      lifecycleStatus: "committed",
      committedAt: confirmedAt,
    });
  });

  it("preserves I'll Customize and offers a system recommendation separately", () => {
    const plan = routedPlan("learner_customizes");
    const previous = plan.sessions[1]!.studyRoute;
    const result = preparePostSessionStudyRouteTransition({
      plan,
      completedSessionId: IDS.completed,
      changedAt: CHANGED_AT,
      adaptation: adaptation(),
      adaptationAgency: {
        changeKind: "system_recommendation",
        support: "sufficient",
      },
    });

    expect(result.nextSessionStudyRoute).toBeNull();
    expect(result.appliedAdaptation).toBeNull();
    expect(result.adaptationAgencyDecision).toMatchObject({
      status: "recommendation_available",
      mode: "ill_customize",
      reasonCode: "learner_selection_preserved",
      currentRoute: {
        identity: { routeRevisionId: previous.identity.routeRevisionId },
      },
      candidateRoute: { identity: { lifecycleStatus: "provisional" } },
    });
  });

  it("applies only the exact prepared I'll Customize recommendation after the learner selects it", () => {
    const plan = routedPlan("learner_customizes");
    const prepared = preparePostSessionStudyRouteTransition({
      plan,
      completedSessionId: IDS.completed,
      changedAt: CHANGED_AT,
      adaptation: adaptation(),
      adaptationAgency: {
        changeKind: "system_recommendation",
        support: "sufficient",
      },
    });
    const candidate = prepared.adaptationAgencyDecision?.candidateRoute;
    expect(candidate).not.toBeNull();

    const applied = preparePostSessionStudyRouteTransition({
      plan,
      completedSessionId: IDS.completed,
      changedAt: CHANGED_AT,
      adaptation: adaptation(),
      adaptationAgency: {
        candidateRoute: candidate!,
        changeKind: "learner_request",
        support: "not_required",
      },
    });

    expect(applied.adaptationAgencyDecision).toMatchObject({
      status: "applied",
      mode: "ill_customize",
      reasonCode: "agency_policy_applied",
    });
    expect(applied.appliedAdaptation).toEqual(adaptation());
    expect(applied.nextSessionStudyRoute?.identity).toMatchObject({
      routeRevisionId: candidate!.identity.routeRevisionId,
      lifecycleStatus: "committed",
      committedAt: CHANGED_AT,
    });

    const unrelatedPlan = routedPlan("learner_customizes");
    const unrelatedCandidate = preparePostSessionStudyRouteTransition({
      plan: unrelatedPlan,
      completedSessionId: IDS.completed,
      changedAt: CHANGED_AT,
      adaptation: adaptation(),
      adaptationAgency: {
        changeKind: "system_recommendation",
        support: "sufficient",
      },
    }).adaptationAgencyDecision?.candidateRoute;
    expect(() => preparePostSessionStudyRouteTransition({
      plan,
      completedSessionId: IDS.completed,
      changedAt: CHANGED_AT,
      adaptation: adaptation(),
      adaptationAgency: {
        candidateRoute: unrelatedCandidate!,
        changeKind: "learner_request",
        support: "not_required",
      },
    })).toThrow("direct successor");

    const stalePlan: LearningPlan = {
      ...plan,
      sessions: plan.sessions.map((current) => (
        current.id === IDS.next
          ? { ...current, studyRoute: applied.nextSessionStudyRoute! }
          : current
      )),
    };
    expect(() => preparePostSessionStudyRouteTransition({
      plan: stalePlan,
      completedSessionId: IDS.completed,
      changedAt: CHANGED_AT,
      adaptation: adaptation(),
      adaptationAgency: {
        candidateRoute: candidate!,
        changeKind: "learner_request",
        support: "not_required",
      },
    })).toThrow("direct successor");
  });

  it("gives a new follow-up its own committed lineage with origin provenance", () => {
    const plan = routedPlan();
    const result = preparePostSessionStudyRouteTransition({
      plan,
      completedSessionId: IDS.completed,
      changedAt: CHANGED_AT,
      followUpSession: followUp(),
    });
    const route = result.followUpSession?.studyRoute;

    expect(route?.identity).toMatchObject({
      revisionNumber: 1,
      lifecycleStatus: "committed",
      planId: IDS.plan,
      sessionId: IDS.followUp,
    });
    expect(route?.identity.routeLineageId).not.toBe(
      plan.sessions[0]!.studyRoute.identity.routeLineageId,
    );
    expect(route?.provenance.ruleTrace).toContainEqual(expect.objectContaining({
      result: "completion_follow_up",
      evidenceRefs: [`route-revision:${plan.sessions[0]!.studyRoute.identity.routeRevisionId}`],
    }));
  });

  it("fails closed when only part of a plan carries canonical routes", () => {
    const plan = routedPlan();
    const partial = {
      ...plan,
      sessions: [plan.sessions[0]!, { ...plan.sessions[1]!, studyRoute: undefined }],
    };
    expect(() => preparePostSessionStudyRouteTransition({
      plan: partial,
      completedSessionId: IDS.completed,
      changedAt: CHANGED_AT,
      adaptation: adaptation(),
    })).toThrow("partially routed plan");
  });

  it("binds an activated concept review to a new lineage and the matching target route", () => {
    const plan = routedPlan();
    const review = {
      ...followUp(),
      topicIds: [],
      contentTargets: undefined,
      completionEvidence: undefined,
    };
    const result = prepareConceptReviewSessionStudyRoute({
      plan: { ...plan, status: "completed" },
      session: review,
      changedAt: CHANGED_AT,
      originRouteRevisionId: plan.sessions[0]!.studyRoute.identity.routeRevisionId,
    });

    expect(result.studyRoute?.identity).toMatchObject({
      planId: IDS.plan,
      sessionId: IDS.followUp,
      revisionNumber: 1,
      lifecycleStatus: "committed",
    });
    expect(result.studyRoute?.identity.routeLineageId).not.toBe(
      plan.sessions[0]!.studyRoute.identity.routeLineageId,
    );
    expect(result.studyRoute?.provenance.evidenceRefs).toContain(
      `route-revision:${plan.sessions[0]!.studyRoute.identity.routeRevisionId}`,
    );
    expect(result.topicIds).toEqual([IDS.completedTarget]);
    expect(result.contentTargets).toEqual(["Completed target"]);
    expect(result.completionEvidence).toEqual([review.objective]);
  });
});
