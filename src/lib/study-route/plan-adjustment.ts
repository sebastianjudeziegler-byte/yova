import {
  makeUuid,
  type LearningPlan,
  type LearningPlanSession,
} from "@/lib/domain";
import { adaptLegacySessionToStudyRoute } from "@/lib/study-route/adapters";
import { materialStudyRouteChanges } from "@/lib/study-route/revisions";
import {
  createCommittedInitialSessionStudyRoute,
  createCommittedScalarSuccessorStudyRoute,
} from "@/lib/study-route/session-route-creation";
import { StudyRouteSchema, type StudyRoute } from "@/lib/study-route/schema";
import { canonicalStudyRouteSessionScalars } from "@/lib/study-route/scalar-contract";

/**
 * Applies route lifecycle semantics to the already-built replacement session
 * list. It does not decide how content is split or scheduled; it only preserves
 * or revises the exact learning decision attached to each resulting session.
 */
export function preparePlanAdjustmentStudyRoutes({
  plan,
  replacementSessions,
  nextStudyMode,
  changedAt,
  reason,
  newSessionOriginIds,
}: {
  plan: LearningPlan;
  replacementSessions: LearningPlanSession[];
  nextStudyMode: LearningPlan["studyMode"];
  changedAt: string;
  reason: string;
  /**
   * Supplies an exact existing route origin for newly included plan targets
   * that have no prior session row. This is transaction input, not durable
   * split metadata, so a later content rebuild cannot accidentally merge two
   * independent targets into one origin group.
   */
  newSessionOriginIds?: Readonly<Record<string, string>>;
}): LearningPlanSession[] {
  const changeReason = reason.trim();
  if (changeReason.length < 3 || changeReason.length > 500) {
    throw new Error("A route-aware plan adjustment needs a reason between 3 and 500 characters.");
  }
  if (nextStudyMode !== "inside_yova" && nextStudyMode !== "outside_yova") {
    throw new Error("A route-aware plan adjustment needs a supported study mode.");
  }
  assertUniqueSessionIds(plan.sessions, "current plan");
  assertUniqueSessionIds(replacementSessions, "replacement plan");

  const routedCount = plan.sessions.filter((session) => session.studyRoute !== undefined).length;
  if (routedCount === 0) {
    if (replacementSessions.some((session) => session.studyRoute !== undefined)) {
      throw new Error("A legacy plan adjustment cannot introduce a StudyRoute.");
    }
    return replacementSessions;
  }
  if (routedCount !== plan.sessions.length) {
    throw new Error("YOVA cannot adjust a partially routed plan.");
  }
  if (
    nextStudyMode !== plan.studyMode
    && replacementSessions.some((session) => session.reviewType !== undefined)
  ) {
    throw new Error("A routed plan cannot change execution environment while preserving a scheduled review.");
  }

  const currentById = new Map(plan.sessions.map((session) => [session.id, session]));
  const routeBySessionId = new Map(plan.sessions.map((session) => {
    const route = StudyRouteSchema.parse(session.studyRoute);
    assertExactCommittedRoute(route, plan.id, session.id);
    return [session.id, route] as const;
  }));
  const adjustedPlan: LearningPlan = {
    ...plan,
    studyMode: nextStudyMode,
    sessions: replacementSessions,
  };

  return replacementSessions.map((replacementInput) => {
    const replacement = canonicalStudyRouteSessionScalars(replacementInput);
    const current = currentById.get(replacement.id);
    if (current) {
      const previousRoute = routeBySessionId.get(current.id)!;
      assertSuppliedRouteIsCurrent(replacement, previousRoute);

      if (current.reviewType || replacement.reviewType) {
        if (!current.reviewType || replacement.reviewType !== current.reviewType) {
          throw new Error("A protected scheduled review cannot change its review contract.");
        }
        const protectedChanges = materialChangesFromScalars({
          plan: { ...plan, sessions: replacementSessions },
          session: replacement,
          previousRoute,
          changedAt,
        });
        if (protectedChanges.length > 0) {
          throw new Error("A protected scheduled review cannot change its committed StudyRoute.");
        }
        return {
          ...replacement,
          // Keep the exact object and revision pointer; sequence and schedule
          // live outside the route and may still be moved transactionally.
          studyRoute: current.studyRoute,
        };
      }

      const materialChanges = materialChangesFromScalars({
        plan: adjustedPlan,
        session: replacement,
        previousRoute,
        changedAt,
      });
      if (materialChanges.length === 0) {
        return { ...replacement, studyRoute: current.studyRoute };
      }

      return {
        ...replacement,
        studyRoute: createCommittedScalarSuccessorStudyRoute({
          plan: adjustedPlan,
          session: replacement,
          previousRoute,
          now: changedAt,
          changeReason,
          origin: {
            source: "plan_adjustment",
            reason: changeReason,
            evidenceRefs: [`route-revision:${previousRoute.identity.routeRevisionId}`],
          },
          ...(replacement.estimatedMinutes === previousRoute.timing.activeMinutes
            ? {}
            : {
                durationDecision: learnerDurationDecision(
                  replacement.estimatedMinutes,
                  previousRoute.provenance.profileVersion,
                ),
              }),
        }),
      };
    }

    if (replacement.studyRoute) {
      throw new Error("A new adjusted session cannot supply its own StudyRoute identity.");
    }
    const explicitOriginSessionId = replacement.originSessionId?.trim()
      || newSessionOriginIds?.[replacement.id]?.trim();
    const origin = resolveNewSessionOrigin({
      replacement,
      explicitOriginSessionId,
      currentById,
      routeBySessionId,
    });
    const { session: originSession, route: originRoute } = origin;
    assertExactCommittedRoute(originRoute, plan.id, originSession.id);

    const studyRoute = createCommittedInitialSessionStudyRoute({
      plan: adjustedPlan,
      session: replacement,
      now: changedAt,
      origin: {
        source: hasSplitMetadata(replacement)
          ? "plan_adjustment_split"
          : replacement.originSessionId?.trim()
            ? "plan_adjustment_new_session"
            : "plan_adjustment_deferred",
        reason: changeReason,
        evidenceRefs: [`route-revision:${originRoute.identity.routeRevisionId}`],
      },
      durationDecision: learnerDurationDecision(
        replacement.estimatedMinutes,
        originRoute.provenance.profileVersion,
      ),
    });
    if (studyRoute.identity.routeLineageId === originRoute.identity.routeLineageId) {
      throw new Error("A new adjusted session must have an independent StudyRoute lineage.");
    }
    return { ...replacement, studyRoute };
  });
}

function resolveNewSessionOrigin({
  replacement,
  explicitOriginSessionId,
  currentById,
  routeBySessionId,
}: {
  replacement: LearningPlanSession;
  explicitOriginSessionId: string | undefined;
  currentById: ReadonlyMap<string, LearningPlanSession>;
  routeBySessionId: ReadonlyMap<string, StudyRoute>;
}) {
  if (explicitOriginSessionId) {
    const session = currentById.get(explicitOriginSessionId);
    const route = routeBySessionId.get(explicitOriginSessionId);
    if (!session || !route) {
      throw new Error("The adjusted session origin is missing from this plan.");
    }
    return { session, route };
  }

  // Deferred replacements predate explicit originSessionId metadata. Accept a
  // fallback only when their exact target IDs identify one unambiguous current
  // route; never guess from sequence, title, or prose similarity.
  const targetIds = new Set(replacement.topicIds ?? []);
  const matches = [...routeBySessionId.entries()].filter(([, route]) => (
    route.target.targetStates.some((target) => targetIds.has(target.targetId))
  ));
  if (matches.length !== 1) {
    throw new Error("The adjusted session origin is missing or ambiguous in this plan.");
  }
  const [sessionId, route] = matches[0]!;
  const session = currentById.get(sessionId);
  if (!session) {
    throw new Error("The adjusted session origin is missing from this plan.");
  }
  return { session, route };
}

function materialChangesFromScalars({
  plan,
  session,
  previousRoute,
  changedAt,
}: {
  plan: LearningPlan;
  session: LearningPlanSession;
  previousRoute: StudyRoute;
  changedAt: string;
}) {
  const { route } = adaptLegacySessionToStudyRoute({
    plan,
    session,
    adaptedAt: changedAt,
    identity: {
      routeLineageId: previousRoute.identity.routeLineageId,
      routeRevisionId: makeUuid(),
      lifecycleStatus: "provisional",
      createdAt: changedAt,
    },
  });
  if (!route) {
    throw new Error("The adjusted session method does not map to a supported StudyRoute.");
  }
  if (route.identity.planId !== plan.id || route.identity.sessionId !== session.id) {
    throw new Error("The adjusted StudyRoute does not match the exact plan and session IDs.");
  }
  const comparableRoute = route.timing.activeMinutes === previousRoute.timing.activeMinutes
    ? StudyRouteSchema.parse({ ...route, timing: previousRoute.timing })
    : route;
  return materialStudyRouteChanges(previousRoute, comparableRoute);
}

function learnerDurationDecision(minutes: number, profileVersion: string) {
  return {
    source: "learner_override" as const,
    profileVersion,
    ruleTrace: [{
      ruleId: "duration.learner_override",
      result: `selected_${minutes}_minutes`,
      reason: `The learner selected ${minutes} minutes for each rebuilt ordinary session.`,
      evidenceRefs: [],
    }],
  };
}

function assertExactCommittedRoute(
  route: StudyRoute,
  planId: string,
  sessionId: string,
) {
  if (
    route.identity.lifecycleStatus !== "committed"
    || route.identity.planId !== planId
    || route.identity.sessionId !== sessionId
  ) {
    throw new Error("Every routed plan session must have its exact committed StudyRoute.");
  }
}

function assertSuppliedRouteIsCurrent(
  session: LearningPlanSession,
  currentRoute: StudyRoute,
) {
  if (
    session.studyRoute
    && session.studyRoute.identity.routeRevisionId !== currentRoute.identity.routeRevisionId
  ) {
    throw new Error("A replacement session cannot inject a different StudyRoute revision.");
  }
}

function assertUniqueSessionIds(
  sessions: readonly LearningPlanSession[],
  label: string,
) {
  const ids = sessions.map((session) => session.id);
  if (new Set(ids).size !== ids.length) {
    throw new Error(`The ${label} contains duplicate session IDs.`);
  }
}

function hasSplitMetadata(session: LearningPlanSession) {
  return session.originalContentMinutes !== undefined
    || session.segmentIndex !== undefined
    || session.segmentCount !== undefined;
}
