import { stableFingerprint } from "@/lib/stable-fingerprint";
import {
  StudyRouteSchema,
  type StudyRoute,
  type StudyRouteProvenance,
  type StudyRouteRuleTraceEntry,
} from "@/lib/study-route/schema";

export const STUDY_ROUTE_MATERIAL_CHANGE_KINDS = [
  "targets",
  "mode",
  "execution_environment",
  "primary_method",
  "method_recipe",
  "duration",
  "phase_order",
  "support_bounds",
  "review_contract",
] as const;

export type StudyRouteMaterialChangeKind = (typeof STUDY_ROUTE_MATERIAL_CHANGE_KINDS)[number];

type StudyRouteRevisionContent = Omit<StudyRoute, "identity">;

export type StudyRouteSuccessorChanges = Partial<Omit<StudyRouteRevisionContent, "provenance">> & {
  /** Rule-trace entries supplied here are appended to, rather than replacing, predecessor history. */
  provenance?: Partial<Omit<StudyRouteProvenance, "ruleTrace">> & {
    ruleTrace?: StudyRouteRuleTraceEntry[];
  };
};

export type ImmutableStudyRoute = DeepReadonly<StudyRoute>;

export function materialStudyRouteChanges(
  previousInput: StudyRoute,
  candidateInput: StudyRoute,
): StudyRouteMaterialChangeKind[] {
  const previous = StudyRouteSchema.parse(previousInput);
  const candidate = StudyRouteSchema.parse(candidateInput);
  const previousProjection = materialProjection(previous);
  const candidateProjection = materialProjection(candidate);

  return STUDY_ROUTE_MATERIAL_CHANGE_KINDS.filter((kind) => (
    stableFingerprint(previousProjection[kind], `study-route-${kind}`)
    !== stableFingerprint(candidateProjection[kind], `study-route-${kind}`)
  ));
}

export function hasMaterialStudyRouteChange(previous: StudyRoute, candidate: StudyRoute) {
  return materialStudyRouteChanges(previous, candidate).length > 0;
}

/**
 * Creates, validates, and deeply freezes a provisional successor without
 * mutating its committed predecessor. Identity and lineage fields are owned by
 * this helper; callers may change only route content.
 */
export function createSuccessorStudyRoute({
  previous: previousInput,
  routeRevisionId,
  createdAt,
  changeReason,
  changes,
}: {
  previous: StudyRoute;
  routeRevisionId: string;
  createdAt: string;
  changeReason: string;
  changes: StudyRouteSuccessorChanges;
}): ImmutableStudyRoute {
  const previous = StudyRouteSchema.parse(previousInput);
  if (previous.identity.lifecycleStatus !== "committed") {
    throw new Error("A StudyRoute successor can be created only from the committed revision.");
  }

  const suppliedProvenance = changes.provenance;
  const revisionReason = changeReason.trim();
  if (revisionReason.length < 3 || revisionReason.length > 500) {
    throw new Error("A StudyRoute successor needs a change reason between 3 and 500 characters.");
  }
  const predecessorBoundary = Date.parse(previous.identity.committedAt ?? previous.identity.createdAt);
  const successorCreatedAt = Date.parse(createdAt);
  if (Number.isFinite(successorCreatedAt) && successorCreatedAt < predecessorBoundary) {
    throw new Error("A StudyRoute successor cannot be created before its predecessor was committed.");
  }

  const candidate = StudyRouteSchema.parse({
    ...previous,
    ...changes,
    identity: {
      routeLineageId: previous.identity.routeLineageId,
      routeRevisionId,
      revisionNumber: previous.identity.revisionNumber + 1,
      schemaVersion: previous.identity.schemaVersion,
      lifecycleStatus: "provisional",
      planId: previous.identity.planId,
      sessionId: previous.identity.sessionId,
      createdAt,
      supersedesRevisionId: previous.identity.routeRevisionId,
    },
    provenance: {
      ...previous.provenance,
      ...suppliedProvenance,
      ruleTrace: [
        ...previous.provenance.ruleTrace,
        ...(suppliedProvenance?.ruleTrace ?? []),
        {
          ruleId: "study_route.material_successor",
          result: "created_provisional_successor",
          reason: revisionReason,
          evidenceRefs: [],
        },
      ],
    },
  });

  const materialChanges = materialStudyRouteChanges(previous, candidate);
  if (materialChanges.length === 0) {
    throw new Error("A new StudyRoute revision requires a material route change.");
  }

  return deepFreeze(candidate);
}

/** Same operation with the noun-first name used by some callers. */
export const createStudyRouteSuccessor = createSuccessorStudyRoute;

/**
 * Returns a new frozen lifecycle view of the same immutable payload. The
 * revision identity is preserved; only provisional lifecycle metadata changes.
 */
export function commitStudyRouteRevision(
  provisionalInput: StudyRoute,
  committedAt: string,
): ImmutableStudyRoute {
  const provisional = StudyRouteSchema.parse(provisionalInput);
  if (provisional.identity.lifecycleStatus !== "provisional") {
    throw new Error("Only a provisional StudyRoute revision can be committed.");
  }

  return deepFreeze(StudyRouteSchema.parse({
    ...provisional,
    identity: {
      ...provisional.identity,
      lifecycleStatus: "committed",
      committedAt,
    },
  }));
}

/**
 * Marks an old committed lifecycle view as superseded only after validating a
 * committed direct successor. The old route's payload and commit time remain
 * unchanged.
 */
export function supersedeStudyRouteRevision(
  committedInput: StudyRoute,
  committedSuccessorInput: StudyRoute,
): ImmutableStudyRoute {
  const committed = StudyRouteSchema.parse(committedInput);
  const successor = StudyRouteSchema.parse(committedSuccessorInput);
  if (committed.identity.lifecycleStatus !== "committed") {
    throw new Error("Only a committed StudyRoute revision can be superseded.");
  }
  if (successor.identity.lifecycleStatus !== "committed") {
    throw new Error("The replacement StudyRoute revision must be committed first.");
  }
  if (
    successor.identity.routeLineageId !== committed.identity.routeLineageId
    || successor.identity.planId !== committed.identity.planId
    || successor.identity.sessionId !== committed.identity.sessionId
    || successor.identity.revisionNumber !== committed.identity.revisionNumber + 1
    || successor.identity.supersedesRevisionId !== committed.identity.routeRevisionId
  ) {
    throw new Error("The replacement is not the direct successor of this StudyRoute revision.");
  }
  if (Date.parse(successor.identity.createdAt) < Date.parse(committed.identity.committedAt!)) {
    throw new Error("The replacement StudyRoute predates the revision it claims to supersede.");
  }
  if (!hasMaterialStudyRouteChange(committed, successor)) {
    throw new Error("A committed StudyRoute successor must contain a material route change.");
  }

  return deepFreeze(StudyRouteSchema.parse({
    ...committed,
    identity: {
      ...committed.identity,
      lifecycleStatus: "superseded",
    },
  }));
}

/** Parses a boundary value and freezes every nested object and array. */
export function freezeStudyRoute(input: unknown): ImmutableStudyRoute {
  return deepFreeze(StudyRouteSchema.parse(input));
}

function materialProjection(route: StudyRoute) {
  const phaseIndexById = new Map(
    route.execution.orderedPhases.map((phase, index) => [phase.phaseId, index]),
  );
  const targetStates = [...route.target.targetStates]
    .sort((left, right) => left.targetId.localeCompare(right.targetId));

  return {
    targets: {
      taskFamily: route.target.taskFamily,
      desiredOutcome: route.target.desiredOutcome,
      targetStates: targetStates.map((target) => ({
        targetId: target.targetId,
        stage: target.stage,
        uncertainty: target.uncertainty,
        evidenceRefs: [...target.evidenceRefs].sort(),
        lastObservedAt: target.lastObservedAt,
      })),
      sourceRequirements: {
        ...route.target.sourceRequirements,
        requiredSourceIds: [...route.target.sourceRequirements.requiredSourceIds].sort(),
      },
      deferredTargets: [...route.execution.deferredTargets]
        .sort((left, right) => left.targetId.localeCompare(right.targetId)),
    },
    mode: route.approach.mode,
    execution_environment: route.approach.executionEnvironment,
    primary_method: route.approach.primaryMethodId,
    method_recipe: route.approach.visibleSupportingTechniqueId ?? null,
    duration: {
      activeMinutes: route.timing.activeMinutes,
      elapsedMinutes: route.timing.elapsedMinutes,
      hardMaximumMinutes: route.timing.hardMaximumMinutes,
      optionalTimedBreak: route.timing.optionalTimedBreak
        ? {
          minutes: route.timing.optionalTimedBreak.minutes,
          afterPhaseIndex: phaseIndexById.get(route.timing.optionalTimedBreak.afterPhaseId),
        }
        : undefined,
    },
    phase_order: {
      orderedPhases: route.execution.orderedPhases.map((phase) => ({
        methodPhase: phase.methodPhase,
        activeMinutes: phase.activeMinutes,
        targetIds: [...phase.targetIds].sort(),
      })),
      activityLimit: route.execution.activityLimit,
    },
    support_bounds: {
      difficultyTier: route.execution.difficultyTier,
      initialSupport: route.execution.initialSupport,
    },
    review_contract: {
      targetReviews: targetStates.map((target) => ({
        targetId: target.targetId,
        nextReview: target.nextReview
          ? {
            ...target.nextReview,
            evidenceRefs: [...target.nextReview.evidenceRefs].sort(),
          }
          : undefined,
      })),
      completionEvidence: [...route.execution.completionEvidence]
        .sort((left, right) => left.evidenceId.localeCompare(right.evidenceId))
        .map((evidence) => ({
          ...evidence,
          targetIds: [...evidence.targetIds].sort(),
        })),
    },
  } satisfies Record<StudyRouteMaterialChangeKind, unknown>;
}

type Primitive = string | number | boolean | bigint | symbol | null | undefined;
type DeepReadonly<T> = T extends Primitive | ((...args: never[]) => unknown)
  ? T
  : T extends readonly (infer Item)[]
    ? readonly DeepReadonly<Item>[]
    : { readonly [Key in keyof T]: DeepReadonly<T[Key]> };

function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value as DeepReadonly<T>;
}
