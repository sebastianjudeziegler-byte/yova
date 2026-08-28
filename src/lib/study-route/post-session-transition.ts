import type {
  LearningPlan,
  LearningPlanSession,
  NextSessionAdaptation,
} from "@/lib/domain";
import {
  createCommittedInitialSessionStudyRoute,
  createCommittedScalarSuccessorStudyRoute,
} from "@/lib/study-route/session-route-creation";
import { StudyRouteSchema, type StudyRoute } from "@/lib/study-route/schema";

export type PostSessionStudyRouteTransition = {
  nextSessionStudyRoute: StudyRoute | null;
  followUpSession: LearningPlanSession | null;
  continuationSession: LearningPlanSession | null;
};

/** Creates the independent route lineage for a review that reopens a plan. */
export function prepareConceptReviewSessionStudyRoute({
  plan,
  session,
  changedAt,
  originRouteRevisionId,
}: {
  plan: LearningPlan;
  session: LearningPlanSession;
  changedAt: string;
  originRouteRevisionId?: string;
}) {
  const routedSessions = plan.sessions.filter((candidate) => candidate.studyRoute !== undefined);
  if (routedSessions.length === 0) return session;
  if (routedSessions.length !== plan.sessions.length) {
    throw new Error("YOVA cannot activate a review on a partially routed plan.");
  }
  const candidates = [...plan.sessions]
    .sort((left, right) => right.sequence - left.sequence)
    .map((candidate) => ({
      session: candidate,
      route: StudyRouteSchema.parse(candidate.studyRoute),
    }));
  const topicIds = new Set(session.topicIds ?? []);
  const exactOrigin = originRouteRevisionId
    ? candidates.find(({ route }) => route.identity.routeRevisionId === originRouteRevisionId)
    : undefined;
  if (originRouteRevisionId && !exactOrigin) {
    throw new Error("The concept-review evidence route does not belong to this plan.");
  }
  const origin = exactOrigin ?? candidates.find(({ route }) => (
    route.target.targetStates.some((target) => topicIds.has(target.targetId))
  )) ?? candidates[0];
  if (!origin) throw new Error("A route-aware review needs an originating StudyRoute.");
  if (
    origin.route.identity.lifecycleStatus !== "committed"
    || origin.route.identity.planId !== plan.id
    || origin.route.identity.sessionId !== origin.session.id
  ) {
    throw new Error("The concept-review origin is not an exact committed StudyRoute.");
  }
  const originTargetIds = origin.route.target.targetStates
    .map((target) => target.targetId)
    .slice(0, 6);
  const canonicalSession: LearningPlanSession = {
    ...session,
    topicIds: session.topicIds?.length ? session.topicIds : originTargetIds,
    contentTargets: session.contentTargets?.length
      ? session.contentTargets
      : [session.reviewConcept?.trim() || session.title],
    completionEvidence: session.completionEvidence?.length
      ? session.completionEvidence
      : [session.objective],
  };
  return createNewSessionRoute({
    plan,
    session: canonicalSession,
    originRoute: origin.route,
    changedAt,
    source: "concept_review_activation",
    reason: "Recorded target evidence made a bounded concept review due.",
    originEvidence: [`route-revision:${origin.route.identity.routeRevisionId}`],
  })!;
}

/**
 * Prepares every route revision once, before the same completion payload is
 * applied locally, stored in the offline outbox, and committed in Supabase.
 * Legacy plans remain route-free; a partially routed plan fails closed.
 */
export function preparePostSessionStudyRouteTransition({
  plan,
  completedSessionId,
  changedAt,
  adaptation = null,
  followUpSession = null,
  continuationSession = null,
}: {
  plan: LearningPlan;
  completedSessionId: string;
  changedAt: string;
  adaptation?: NextSessionAdaptation | null;
  followUpSession?: LearningPlanSession | null;
  continuationSession?: LearningPlanSession | null;
}): PostSessionStudyRouteTransition {
  const completedSession = plan.sessions.find((session) => session.id === completedSessionId);
  if (!completedSession) {
    throw new Error("YOVA cannot prepare route changes for a missing completed session.");
  }

  const routedSessions = plan.sessions.filter((session) => session.studyRoute !== undefined);
  if (routedSessions.length === 0) {
    if (followUpSession?.studyRoute || continuationSession?.studyRoute) {
      throw new Error("A legacy completion cannot introduce an unbound StudyRoute.");
    }
    return {
      nextSessionStudyRoute: null,
      followUpSession,
      continuationSession,
    };
  }
  if (routedSessions.length !== plan.sessions.length) {
    throw new Error("YOVA cannot rewrite a partially routed plan.");
  }

  const committedRoutes = new Map(plan.sessions.map((session) => {
    const route = StudyRouteSchema.parse(session.studyRoute);
    if (
      route.identity.lifecycleStatus !== "committed"
      || route.identity.planId !== plan.id
      || route.identity.sessionId !== session.id
    ) {
      throw new Error("Every route-aware plan session must have its exact committed StudyRoute.");
    }
    return [session.id, route] as const;
  }));
  const originRoute = committedRoutes.get(completedSession.id)!;
  const originEvidence = [`route-revision:${originRoute.identity.routeRevisionId}`];

  const nextSessionStudyRoute = adaptation
    ? createAdaptedSuccessor({
      plan,
      adaptation,
      previousRoute: committedRoutes.get(adaptation.planSessionId) ?? null,
      changedAt,
      originEvidence,
    })
    : null;

  return {
    nextSessionStudyRoute,
    followUpSession: createNewSessionRoute({
      plan,
      session: followUpSession,
      originRoute,
      changedAt,
      source: "completion_follow_up",
      reason: "A completed session scheduled a bounded verification or review.",
      originEvidence,
    }),
    continuationSession: createNewSessionRoute({
      plan,
      session: continuationSession,
      originRoute,
      changedAt,
      source: "deferred_continuation",
      reason: "A time-bounded session preserved its remaining planned targets as the next session.",
      originEvidence,
    }),
  };
}

function createAdaptedSuccessor({
  plan,
  adaptation,
  previousRoute,
  changedAt,
  originEvidence,
}: {
  plan: LearningPlan;
  adaptation: NextSessionAdaptation;
  previousRoute: StudyRoute | null;
  changedAt: string;
  originEvidence: string[];
}) {
  const existing = plan.sessions.find((session) => session.id === adaptation.planSessionId);
  if (!existing || !previousRoute) {
    throw new Error("A route-aware adaptation requires the exact next session and its committed route.");
  }
  const adaptedSession: LearningPlanSession = {
    ...existing,
    title: adaptation.title,
    objective: adaptation.objective,
    method: adaptation.method,
    methodReason: adaptation.methodReason,
    estimatedMinutes: adaptation.estimatedMinutes,
    amountLabel: adaptation.amountLabel,
    learningMode: adaptation.learningMode,
    resource: undefined,
  };
  const reason = boundedReason(adaptation.explanation);
  return createCommittedScalarSuccessorStudyRoute({
    plan,
    session: adaptedSession,
    previousRoute,
    now: changedAt,
    changeReason: reason,
    origin: {
      source: "post_session_adaptation",
      reason,
      evidenceRefs: originEvidence,
    },
  });
}

function createNewSessionRoute({
  plan,
  session,
  originRoute,
  changedAt,
  source,
  reason,
  originEvidence,
}: {
  plan: LearningPlan;
  session: LearningPlanSession | null;
  originRoute: StudyRoute;
  changedAt: string;
  source: string;
  reason: string;
  originEvidence: string[];
}) {
  if (!session) return null;
  if (session.studyRoute) {
    const route = StudyRouteSchema.parse(session.studyRoute);
    if (
      route.identity.lifecycleStatus !== "committed"
      || route.identity.revisionNumber !== 1
      || route.identity.planId !== plan.id
      || route.identity.sessionId !== session.id
      || route.identity.routeLineageId === originRoute.identity.routeLineageId
    ) {
      throw new Error("The existing post-session StudyRoute is not a valid initial lineage.");
    }
    return session;
  }

  const route = createCommittedInitialSessionStudyRoute({
    plan,
    session,
    now: changedAt,
    origin: {
      source,
      reason,
      evidenceRefs: originEvidence,
    },
  });
  if (route.identity.routeLineageId === originRoute.identity.routeLineageId) {
    throw new Error("A new post-session must not reuse its origin StudyRoute lineage.");
  }
  return { ...session, studyRoute: route };
}

function boundedReason(value: string) {
  const reason = value.trim();
  return (reason.length >= 3 ? reason : "YOVA adjusted the next session from new evidence.").slice(0, 500);
}
