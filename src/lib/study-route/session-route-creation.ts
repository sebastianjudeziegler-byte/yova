import {
  makeUuid,
  type LearningPlan,
  type LearningPlanSession,
} from "@/lib/domain";
import { adaptLegacySessionToStudyRoute } from "@/lib/study-route/adapters";
import {
  commitStudyRouteRevision,
  createSuccessorStudyRoute,
  type StudyRouteSuccessorChanges,
} from "@/lib/study-route/revisions";
import {
  StudyRouteDurationSourceSchema,
  StudyRouteRuleTraceEntrySchema,
  StudyRouteSchema,
  StudyRouteTimingSchema,
  type StudyRoute,
  type StudyRouteDurationSource,
  type StudyRouteRuleTraceEntry,
} from "@/lib/study-route/schema";

export const POST_ACTIVATION_ROUTE_BUILDER_VERSION = "post_activation_session_route_v1" as const;

export type StudyRouteCreationOrigin = {
  /** Stable, caller-owned source label such as `completion_review` or `session_split`. */
  source: string;
  /** Human-readable reason this post-activation route exists or changed. */
  reason: string;
  /** Durable evidence identifiers only; never raw learner answers. */
  evidenceRefs?: string[];
};

type SuccessorDurationSource = Exclude<
  StudyRouteDurationSource,
  "scheduled_review" | "legacy_reconstruction"
>;

export type StudyRouteSuccessorDurationDecision = {
  /** Exact authority for the changed duration. Generic scalar reconstruction is never authority. */
  source: SuccessorDurationSource;
  /** Optional availability ceiling retained only when it was part of this exact decision. */
  hardMaximumMinutes?: number;
  /** New duration rules only. Prior route history is preserved automatically. */
  ruleTrace: StudyRouteRuleTraceEntry[];
  /** Override only when the decision used a newer authorized profile snapshot. */
  profileVersion?: string;
};

/**
 * Canonicalizes a newly inserted post-activation session and immediately
 * commits revision one. Unlike the legacy selector adapter, this boundary owns
 * fresh random identity and records why the new route exists.
 */
export function createCommittedInitialSessionStudyRoute({
  plan,
  session,
  now,
  origin,
  durationDecision,
}: {
  plan: LearningPlan;
  session: LearningPlanSession;
  now: string;
  origin: StudyRouteCreationOrigin;
  durationDecision?: StudyRouteSuccessorDurationDecision;
}): StudyRoute {
  if (session.studyRoute) {
    throw new Error("An initial StudyRoute can be created only for a session without a route.");
  }

  const routeLineageId = distinctUuid(new Set([plan.id, session.id]));
  const routeRevisionId = distinctUuid(new Set([
    plan.id,
    session.id,
    routeLineageId,
  ]));
  const adapted = requireAdaptedRoute({
    plan,
    session,
    now,
    routeLineageId,
    routeRevisionId,
  });
  assertExactBinding(adapted, plan, session);

  const routedOrigin = withCreationOrigin(
    adapted,
    "study_route.initial_post_activation_origin",
    origin,
  );
  const provisional = durationDecision
    ? withInitialDurationDecision(routedOrigin, durationDecision)
    : routedOrigin;
  return StudyRouteSchema.parse(commitStudyRouteRevision(provisional, now));
}

/**
 * Re-canonicalizes the session's current scalar promise, creates a direct
 * successor of its committed route, and commits it at the explicit timestamp.
 * The revision helper rejects copy/provenance-only changes, preventing no-op
 * route history.
 */
export function createCommittedScalarSuccessorStudyRoute({
  plan,
  session,
  previousRoute,
  now,
  changeReason,
  origin,
  durationDecision,
}: {
  plan: LearningPlan;
  session: LearningPlanSession;
  previousRoute: StudyRoute;
  now: string;
  changeReason: string;
  origin: StudyRouteCreationOrigin;
  durationDecision?: StudyRouteSuccessorDurationDecision;
}): StudyRoute {
  const previous = StudyRouteSchema.parse(previousRoute);
  assertExactBinding(previous, plan, session);

  const routeRevisionId = distinctUuid(new Set([
    plan.id,
    session.id,
    previous.identity.routeLineageId,
    previous.identity.routeRevisionId,
  ]));
  const adapted = requireAdaptedRoute({
    plan,
    session,
    now,
    routeLineageId: previous.identity.routeLineageId,
    routeRevisionId,
  });
  assertExactBinding(adapted, plan, session);
  const durationChanged = adapted.timing.activeMinutes !== previous.timing.activeMinutes;
  if (durationChanged && !durationDecision) {
    throw new Error("A material duration change requires an explicit duration decision.");
  }
  if (!durationChanged && durationDecision) {
    throw new Error("A duration decision cannot be attached when the session duration did not change.");
  }

  const originEntry = creationOriginEntry(
    "study_route.scalar_adaptation_origin",
    origin,
  );
  const durationEntries = durationDecision?.ruleTrace.map((entry) => (
    StudyRouteRuleTraceEntrySchema.parse(entry)
  )) ?? [];
  if (durationChanged && durationEntries.length === 0) {
    throw new Error("A material duration change requires a truthful duration rule trace.");
  }
  const timing = durationChanged
    ? StudyRouteTimingSchema.parse({
        activeMinutes: adapted.timing.activeMinutes,
        elapsedMinutes: adapted.timing.activeMinutes,
        durationSource: requireSuccessorDurationSource(durationDecision!.source),
        ...(durationDecision!.hardMaximumMinutes === undefined
          ? {}
          : { hardMaximumMinutes: durationDecision!.hardMaximumMinutes }),
      })
    : previous.timing;
  const newEvidenceRefs = unique([
    ...(origin.evidenceRefs ?? []),
    ...durationEntries.flatMap((entry) => entry.evidenceRefs),
  ]);
  const changes: StudyRouteSuccessorChanges = {
    target: adapted.target,
    approach: adapted.approach,
    timing,
    execution: adapted.execution,
    agency: adapted.agency,
    explanation: adapted.explanation,
    provenance: {
      routerVersion: compositeRouterVersion(
        previous.provenance.routerVersion,
        POST_ACTIVATION_ROUTE_BUILDER_VERSION,
      ),
      profileVersion: durationDecision?.profileVersion
        ?? previous.provenance.profileVersion,
      evidenceRefs: unique([
        ...previous.provenance.evidenceRefs,
        ...newEvidenceRefs,
      ]),
      ruleTrace: [originEntry, ...durationEntries],
    },
  };

  const provisional = createSuccessorStudyRoute({
    previous,
    routeRevisionId,
    createdAt: now,
    changeReason,
    changes,
  });
  return StudyRouteSchema.parse(commitStudyRouteRevision(provisional as StudyRoute, now));
}

function requireAdaptedRoute({
  plan,
  session,
  now,
  routeLineageId,
  routeRevisionId,
}: {
  plan: LearningPlan;
  session: LearningPlanSession;
  now: string;
  routeLineageId: string;
  routeRevisionId: string;
}) {
  const { route } = adaptLegacySessionToStudyRoute({
    plan,
    session,
    adaptedAt: now,
    identity: {
      routeLineageId,
      routeRevisionId,
      lifecycleStatus: "provisional",
      createdAt: now,
    },
  });
  if (!route) {
    throw new Error("The session scalars do not identify a supported StudyRoute method.");
  }
  return route;
}

function withCreationOrigin(
  route: StudyRoute,
  ruleId: string,
  origin: StudyRouteCreationOrigin,
) {
  const evidenceRefs = unique(origin.evidenceRefs ?? []);
  return StudyRouteSchema.parse({
    ...route,
    provenance: {
      ...route.provenance,
      routerVersion: POST_ACTIVATION_ROUTE_BUILDER_VERSION,
      evidenceRefs: unique([...route.provenance.evidenceRefs, ...evidenceRefs]),
      ruleTrace: [
        ...route.provenance.ruleTrace,
        creationOriginEntry(ruleId, origin),
      ],
    },
  });
}

function creationOriginEntry(
  ruleId: string,
  origin: StudyRouteCreationOrigin,
) {
  return StudyRouteRuleTraceEntrySchema.parse({
    ruleId,
    result: origin.source.trim(),
    reason: origin.reason.trim(),
    evidenceRefs: unique(origin.evidenceRefs ?? []),
  });
}

function withInitialDurationDecision(
  route: StudyRoute,
  decision: StudyRouteSuccessorDurationDecision,
) {
  const durationEntries = decision.ruleTrace.map((entry) => (
    StudyRouteRuleTraceEntrySchema.parse(entry)
  ));
  if (durationEntries.length === 0) {
    throw new Error("An initial explicit duration decision requires a truthful rule trace.");
  }
  return StudyRouteSchema.parse({
    ...route,
    timing: StudyRouteTimingSchema.parse({
      activeMinutes: route.timing.activeMinutes,
      elapsedMinutes: route.timing.activeMinutes,
      durationSource: requireSuccessorDurationSource(decision.source),
      ...(decision.hardMaximumMinutes === undefined
        ? {}
        : { hardMaximumMinutes: decision.hardMaximumMinutes }),
    }),
    provenance: {
      ...route.provenance,
      routerVersion: compositeRouterVersion(
        route.provenance.routerVersion,
        POST_ACTIVATION_ROUTE_BUILDER_VERSION,
      ),
      profileVersion: decision.profileVersion ?? route.provenance.profileVersion,
      evidenceRefs: unique([
        ...route.provenance.evidenceRefs,
        ...durationEntries.flatMap((entry) => entry.evidenceRefs),
      ]),
      ruleTrace: [...route.provenance.ruleTrace, ...durationEntries],
    },
  });
}

function requireSuccessorDurationSource(source: SuccessorDurationSource) {
  const parsed = StudyRouteDurationSourceSchema.parse(source);
  if (parsed === "scheduled_review" || parsed === "legacy_reconstruction") {
    throw new Error("A changed normal-session duration needs a current decision source.");
  }
  return parsed;
}

function compositeRouterVersion(current: string, next: string) {
  return unique(current.split("+").concat(next)).join("+");
}

function assertExactBinding(
  route: StudyRoute,
  plan: LearningPlan,
  session: LearningPlanSession,
) {
  if (
    route.identity.planId !== plan.id
    || route.identity.sessionId !== session.id
  ) {
    throw new Error("The StudyRoute identity does not match the exact plan and session IDs.");
  }
}

function distinctUuid(excluded: ReadonlySet<string>) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const id = makeUuid();
    if (!excluded.has(id)) return id;
  }
  throw new Error("YOVA could not allocate a distinct StudyRoute revision identity.");
}

function unique(values: readonly string[]) {
  return [...new Set(values)];
}
