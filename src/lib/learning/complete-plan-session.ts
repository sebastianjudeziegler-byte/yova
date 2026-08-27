import type {
  LearningPlan,
  LearningPlanSession,
  NextSessionAdaptation,
} from "@/lib/domain";
import { createSessionAdaptationNote } from "@/lib/personalization/adaptation-note";
import { studyRouteToLegacySessionProjection } from "@/lib/study-route/adapters";
import { supersedeStudyRouteRevision } from "@/lib/study-route/revisions";
import { StudyRouteSchema, type StudyRoute } from "@/lib/study-route/schema";

type CompletePlanSessionInput = {
  plan: LearningPlan;
  completedSessionId: string;
  completedAt: string;
  adaptation?: NextSessionAdaptation | null;
  nextSessionStudyRoute?: StudyRoute | null;
  followUpSession?: LearningPlanSession | null;
  continuationSession?: LearningPlanSession | null;
};

/**
 * Applies the learner-approved result of one completed session without
 * rewriting the curriculum that was already planned.
 */
export function completePlanSession({
  plan,
  completedSessionId,
  completedAt,
  adaptation = null,
  nextSessionStudyRoute = null,
  followUpSession = null,
  continuationSession = null,
}: CompletePlanSessionInput): LearningPlan {
  const completedSession = plan.sessions.find((session) => session.id === completedSessionId);
  if (!completedSession) return plan;

  const completedRoute = committedRoute(completedSession);
  assertNewSessionRoute({
    plan,
    session: followUpSession,
    originRoute: completedRoute,
    label: "follow-up",
  });
  assertNewSessionRoute({
    plan,
    session: continuationSession,
    originRoute: completedRoute,
    label: "continuation",
  });
  if (!adaptation && nextSessionStudyRoute) {
    throw new Error("A next-session StudyRoute cannot be supplied without a matching adaptation.");
  }

  const sessionsWithContinuation = insertFollowUpOnce(plan.sessions, continuationSession);
  const sessionsWithFollowUp = insertFollowUpOnce(sessionsWithContinuation, followUpSession);
  const nextSequence = completedSession.sequence + 1;
  const sessions = sessionsWithFollowUp.map((session) => {
    if (session.id === completedSession.id) {
      return { ...session, status: "complete" as const };
    }

    if (session.sequence !== nextSequence || !isPendingSession(session)) return session;

    if (adaptation?.planSessionId !== session.id) {
      return { ...session, status: "ready" as const };
    }

    const currentRoute = committedRoute(session);
    const successorRoute = nextSessionStudyRoute
      ? StudyRouteSchema.parse(nextSessionStudyRoute)
      : null;
    if (currentRoute && !successorRoute) {
      throw new Error("A route-aware next-session adaptation requires a committed successor StudyRoute.");
    }
    if (!currentRoute && successorRoute) {
      throw new Error("A StudyRoute successor requires a committed predecessor on the adapted session.");
    }
    if (currentRoute && successorRoute) {
      // The returned superseded view is intentionally discarded. This call is
      // the shared direct-successor validator for lineage and material change.
      supersedeStudyRouteRevision(currentRoute, successorRoute);
      assertRouteMatchesSession(plan, session, successorRoute, "adapted next session");
      assertRouteProjectionMatchesAdaptation(successorRoute, adaptation);
    }

    return {
      ...session,
      title: adaptation.title,
      objective: adaptation.objective,
      method: adaptation.method,
      methodReason: adaptation.methodReason,
      estimatedMinutes: adaptation.estimatedMinutes,
      amountLabel: adaptation.amountLabel,
      learningMode: adaptation.learningMode,
      resource: undefined,
      adaptationNote: createSessionAdaptationNote(adaptation.explanation, completedAt),
      status: "ready" as const,
      ...(successorRoute ? { studyRoute: successorRoute } : {}),
    };
  });
  const hasRemainingWork = sessions.some(isPendingSession);

  return {
    ...plan,
    status: hasRemainingWork ? "active" : "completed",
    sessions,
  };
}

function committedRoute(session: LearningPlanSession | null) {
  if (!session?.studyRoute) return null;
  const route = StudyRouteSchema.parse(session.studyRoute);
  if (route.identity.lifecycleStatus !== "committed") {
    throw new Error("Post-activation session changes require a committed StudyRoute.");
  }
  return route;
}

function assertNewSessionRoute({
  plan,
  session,
  originRoute,
  label,
}: {
  plan: LearningPlan;
  session: LearningPlanSession | null;
  originRoute: StudyRoute | null;
  label: "follow-up" | "continuation";
}) {
  if (!session) return;
  const route = session.studyRoute ? StudyRouteSchema.parse(session.studyRoute) : null;
  if (originRoute && !route) {
    throw new Error(`A route-aware ${label} session requires its own committed StudyRoute.`);
  }
  if (!originRoute && route) {
    throw new Error(`A ${label} StudyRoute requires a committed originating route.`);
  }
  if (!route) return;
  if (route.identity.lifecycleStatus !== "committed" || route.identity.revisionNumber !== 1) {
    throw new Error(`A new ${label} session must start a committed StudyRoute lineage.`);
  }
  if (route.identity.routeLineageId === originRoute?.identity.routeLineageId) {
    throw new Error(`A new ${label} session cannot reuse its origin StudyRoute lineage.`);
  }
  assertRouteMatchesSession(plan, session, route, label);
  assertRouteProjectionMatchesSession(route, session, label);
}

function assertRouteMatchesSession(
  plan: LearningPlan,
  session: LearningPlanSession,
  route: StudyRoute,
  label: string,
) {
  if (route.identity.planId !== plan.id || route.identity.sessionId !== session.id) {
    throw new Error(`The ${label} StudyRoute is bound to another plan or session.`);
  }
}

function assertRouteProjectionMatchesSession(
  route: StudyRoute,
  session: LearningPlanSession,
  label: string,
) {
  const projection = studyRouteToLegacySessionProjection(route);
  if (
    projection.method !== session.method
    || projection.methodReason !== session.methodReason
    || projection.estimatedMinutes !== session.estimatedMinutes
    || projection.learningMode !== session.learningMode
  ) {
    throw new Error(`The ${label} StudyRoute does not match the session shown to the learner.`);
  }
}

function assertRouteProjectionMatchesAdaptation(
  route: StudyRoute,
  adaptation: NextSessionAdaptation,
) {
  const projection = studyRouteToLegacySessionProjection(route);
  if (
    projection.method !== adaptation.method
    || projection.methodReason !== adaptation.methodReason
    || projection.estimatedMinutes !== adaptation.estimatedMinutes
    || projection.learningMode !== adaptation.learningMode
  ) {
    throw new Error("The successor StudyRoute does not match the approved next-session adaptation.");
  }
}

function insertFollowUpOnce(
  sessions: LearningPlanSession[],
  followUpSession: LearningPlanSession | null,
) {
  if (!followUpSession) return sessions;
  if (sessions.some((session) => session.id === followUpSession.id)) return sessions;

  return [
    ...sessions.map((session) => session.sequence >= followUpSession.sequence
      ? { ...session, sequence: session.sequence + 1 }
      : session),
    followUpSession,
  ].sort((left, right) => left.sequence - right.sequence);
}

function isPendingSession(session: LearningPlanSession) {
  return session.status === "ready" || session.status === "upcoming";
}
