import { describe, expect, it } from "vitest";
import type { LearningPlan, LearningPlanSession, NextSessionAdaptation } from "@/lib/domain";
import {
  prepareConceptReviewSessionStudyRoute,
  preparePostSessionStudyRouteTransition,
} from "@/lib/study-route/post-session-transition";
import { createCommittedInitialSessionStudyRoute } from "@/lib/study-route/session-route-creation";

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

function routedPlan() {
  const plan = basePlan();
  return {
    ...plan,
    sessions: plan.sessions.map((current) => ({
      ...current,
      studyRoute: createCommittedInitialSessionStudyRoute({
        plan,
        session: current,
        now: CREATED_AT,
        origin: {
          source: "plan_activation",
          reason: "The learner activated this planned session.",
        },
      }),
    })),
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
