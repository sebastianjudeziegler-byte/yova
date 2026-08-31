import { z } from "zod";
import type {
  LearningPlan,
  LearningPlanSession,
} from "@/lib/domain";
import {
  selectCanonicalStudyMethod,
} from "@/lib/learning/canonical-method-selection";
import {
  CORE_METHOD_IDS,
  METHOD_PRESENTATION_POLICY_VERSION,
  type CoreMethodId,
} from "@/lib/learning/method-catalog";
import { stableFingerprint } from "@/lib/stable-fingerprint";
import {
  studyRouteToLegacySessionProjection,
} from "@/lib/study-route/adapters";
import {
  immutableStudyRouteMethodEligibility,
  isAuthorizedOtherMethodChoice,
  isExactStoredAgencyMethodChoice,
  storedAgencyChoiceEligibilityPolicyVersion,
} from "@/lib/study-route/agency-mode-controller";
import {
  integrateStudyRouteMethodDecision,
  methodSelectionContextForStudyRoute,
  STUDY_ROUTE_METHOD_PLAN_INTEGRATION_VERSION,
} from "@/lib/study-route/method-plan-integration";
import { METHOD_RUNTIME_CAPABILITY_POLICY_VERSION } from "@/lib/session-generation/method-runtime-capability";
import {
  commitStudyRouteRevision,
  createSuccessorStudyRoute,
  materialStudyRouteChanges,
} from "@/lib/study-route/revisions";
import {
  canonicalStudyRouteSessionScalars,
} from "@/lib/study-route/scalar-contract";
import {
  StudyRouteRuleTraceEntrySchema,
  StudyRouteSchema,
  type StudyRoute,
} from "@/lib/study-route/schema";

export const COMMITTED_METHOD_CHOICE_POLICY_VERSION =
  "post_commit_method_choice_v1" as const;

export const COMMITTED_METHOD_CHOICE_ERROR_CODES = [
  "invalid_plan_state",
  "session_not_found",
  "invalid_session_state",
  "saved_work_present",
  "route_required",
  "stale_route_revision",
  "invalid_route_state",
  "method_not_offered",
  "invalid_change_time",
  "invalid_route_revision_id",
  "route_construction_failed",
  "route_invariant_violation",
] as const;

export type CommittedMethodChoiceErrorCode =
  (typeof COMMITTED_METHOD_CHOICE_ERROR_CODES)[number];

export class CommittedMethodChoiceError extends Error {
  constructor(
    readonly code: CommittedMethodChoiceErrorCode,
    message: string,
    readonly internalCause?: unknown,
  ) {
    super(message);
    this.name = "CommittedMethodChoiceError";
  }
}

export const COMMITTED_METHOD_CHOICE_UNPROCESSABLE_CODES = [
  "invalid_change_time",
  "invalid_route_revision_id",
] as const satisfies readonly CommittedMethodChoiceErrorCode[];

export function committedMethodChoiceErrorStatus(
  code: CommittedMethodChoiceErrorCode,
): 409 | 422 {
  return (COMMITTED_METHOD_CHOICE_UNPROCESSABLE_CODES as readonly string[])
    .includes(code)
    ? 422
    : 409;
}

export type CommittedMethodChoiceSessionProjection = Readonly<
  Pick<
    LearningPlanSession,
    "id" | "method" | "methodReason" | "estimatedMinutes"
  > & { studyRoute: StudyRoute }
>;

export type CommittedMethodChoiceSessionInput = Readonly<
  Pick<
    LearningPlanSession,
    | "id"
    | "status"
    | "objective"
    | "method"
    | "methodReason"
    | "estimatedMinutes"
    | "learningMode"
    | "topicIds"
    | "completionEvidence"
    | "reviewConcept"
    | "reviewType"
    | "resource"
    | "studyRoute"
  > & {
    activityProgress?: unknown;
    sessionAdjustment?: unknown;
  }
>;

export type CommittedMethodChoicePlanInput = Readonly<
  Pick<LearningPlan, "id" | "status" | "sourceMode" | "studyMode"> & {
    sessions: readonly CommittedMethodChoiceSessionInput[];
  }
>;

export type CreateCommittedMethodChoiceSuccessorInput = Readonly<{
  plan: CommittedMethodChoicePlanInput;
  session: CommittedMethodChoiceSessionInput;
  previousRoute: StudyRoute;
  expectedRouteRevisionId: string;
  routeRevisionId: string;
  methodId: CoreMethodId;
  changedAt: string;
  choiceScope?: "stored_alternative" | "other_eligible_method";
}>;

export type CommittedMethodChoiceResult = Readonly<
  | { status: "updated"; session: CommittedMethodChoiceSessionProjection }
  | { status: "unchanged"; session: CommittedMethodChoiceSessionProjection }
>;

const UuidSchema = z.string().uuid();

/**
 * Builds the only route candidate that the post-commit method-choice RPC may
 * persist. The function owns no database state: callers must still compare
 * and commit the expected predecessor atomically.
 *
 * Method choice is deliberately narrow. It may change the canonical method
 * and its required phase recipe, explanation, alternatives, agency, and
 * provenance. Every other executable decision remains byte-for-byte tied to
 * the committed predecessor.
 */
export function createCommittedMethodChoiceSuccessor({
  plan,
  session,
  previousRoute: previousRouteInput,
  expectedRouteRevisionId,
  routeRevisionId,
  methodId,
  changedAt,
  choiceScope = "stored_alternative",
}: CreateCommittedMethodChoiceSuccessorInput): CommittedMethodChoiceResult {
  if (plan.status !== "active") {
    throw choiceError(
      "invalid_plan_state",
      "A committed method choice requires an active learning plan.",
    );
  }

  const planMatches = plan.sessions.filter((candidate) => candidate.id === session.id);
  if (planMatches.length !== 1) {
    throw choiceError(
      "session_not_found",
      "The selected session is not an exact member of this learning plan.",
    );
  }
  const planSession = planMatches[0]!;
  if (session.status !== "ready" || planSession.status !== "ready") {
    throw choiceError(
      "invalid_session_state",
      "A method can change only before the exact ready session begins.",
    );
  }
  if (
    session.reviewType
    || session.reviewConcept?.trim()
    || planSession.reviewType
    || planSession.reviewConcept?.trim()
  ) {
    throw choiceError(
      "invalid_session_state",
      "Scheduled reviews keep their separate lightweight method contract.",
    );
  }
  if (hasSavedMethodChoiceWork(session) || hasSavedMethodChoiceWork(planSession)) {
    throw choiceError(
      "saved_work_present",
      "A method cannot change after this session has generated or saved work.",
    );
  }

  const parsedPrevious = StudyRouteSchema.safeParse(previousRouteInput);
  const parsedSessionRoute = StudyRouteSchema.safeParse(session.studyRoute);
  const parsedPlanSessionRoute = StudyRouteSchema.safeParse(planSession.studyRoute);
  if (!parsedPrevious.success || !parsedSessionRoute.success || !parsedPlanSessionRoute.success) {
    throw choiceError(
      "route_required",
      "A committed method choice requires the exact saved StudyRoute.",
    );
  }
  const previousRoute = parsedPrevious.data;
  if (
    previousRoute.identity.lifecycleStatus !== "committed"
    || previousRoute.identity.planId !== plan.id
    || previousRoute.identity.sessionId !== session.id
    || previousRoute.timing.durationSource === "scheduled_review"
    || parsedSessionRoute.data.identity.routeRevisionId
      !== previousRoute.identity.routeRevisionId
    || parsedPlanSessionRoute.data.identity.routeRevisionId
      !== previousRoute.identity.routeRevisionId
    || !sameValue(parsedSessionRoute.data, previousRoute)
    || !sameValue(parsedPlanSessionRoute.data, previousRoute)
  ) {
    throw choiceError(
      "invalid_route_state",
      "The supplied route is not the exact committed recipe for this ready session.",
    );
  }

  const parsedExpectedRevisionId = UuidSchema.safeParse(expectedRouteRevisionId);
  if (
    !parsedExpectedRevisionId.success
    || expectedRouteRevisionId !== previousRoute.identity.routeRevisionId
  ) {
    throw choiceError(
      "stale_route_revision",
      "The session recipe changed before this method choice was applied.",
    );
  }
  const parsedNextRevisionId = UuidSchema.safeParse(routeRevisionId);
  if (!parsedNextRevisionId.success) {
    throw choiceError(
      "invalid_route_revision_id",
      "A committed method choice requires a valid successor revision ID.",
    );
  }
  const changeTime = parseChangeTime(changedAt, previousRoute);
  assertCurrentSessionProjection(session, previousRoute);
  assertCurrentSessionProjection(planSession, previousRoute);
  assertPlanRouteProjection(plan, previousRoute);

  if (!CORE_METHOD_IDS.includes(methodId)) {
    throw choiceError(
      "method_not_offered",
      "The selected method is not part of YOVA's canonical method catalog.",
    );
  }
  if (previousRoute.approach.primaryMethodId === methodId) {
    return Object.freeze({
      status: "unchanged" as const,
      session: methodChoiceSessionProjection(session, previousRoute),
    });
  }
  if ([
    plan.id,
    session.id,
    previousRoute.identity.routeLineageId,
    previousRoute.identity.routeRevisionId,
  ].includes(routeRevisionId)) {
    throw choiceError(
      "invalid_route_revision_id",
      "The successor route must use a fresh revision identity.",
    );
  }

  const otherEligibleChoice = choiceScope === "other_eligible_method";
  if (
    otherEligibleChoice
      ? !isAuthorizedOtherMethodChoice(previousRoute, methodId)
      : !isExactStoredAgencyMethodChoice(previousRoute, methodId)
  ) {
    throw choiceError(
      "method_not_offered",
      otherEligibleChoice
        ? "The requested Other method is outside this customize route's immutable eligible set."
        : "The selected method was not one of the exact alternatives saved for this session.",
    );
  }

  try {
    const predecessorEvidenceRef = `route-revision:${expectedRouteRevisionId}`;
    const learnerChoiceEvidenceRef = [
      "learner-choice",
      "committed-route",
      plan.id,
      session.id,
      expectedRouteRevisionId,
      methodId,
    ].join(":");
    const context = methodSelectionContextForStudyRoute(previousRoute);
    const eligibilityPolicyVersion = otherEligibleChoice
      ? immutableStudyRouteMethodEligibility(previousRoute).policyVersion
      : storedAgencyChoiceEligibilityPolicyVersion(previousRoute);
    const selection = selectCanonicalStudyMethod({
      ...context,
      eligibilityPolicyVersion,
      learnerChoice: {
        methodId,
        evidenceRef: learnerChoiceEvidenceRef,
      },
    });
    const choiceTrace = StudyRouteRuleTraceEntrySchema.parse({
      ruleId: COMMITTED_METHOD_CHOICE_POLICY_VERSION,
      result: `${previousRoute.approach.primaryMethodId}->${methodId}`,
      reason: otherEligibleChoice
        ? "The learner requested an eligible, deliverable method through I'll Customize Other methods for this exact ready session."
        : "The learner changed the exact ready session to one of the bounded methods saved on its committed route.",
      evidenceRefs: [predecessorEvidenceRef, learnerChoiceEvidenceRef],
    });
    const provisionalBase = StudyRouteSchema.parse({
      ...previousRoute,
      identity: {
        routeLineageId: previousRoute.identity.routeLineageId,
        routeRevisionId,
        revisionNumber: previousRoute.identity.revisionNumber + 1,
        schemaVersion: previousRoute.identity.schemaVersion,
        lifecycleStatus: "provisional",
        planId: previousRoute.identity.planId,
        sessionId: previousRoute.identity.sessionId,
        createdAt: changeTime,
        supersedesRevisionId: previousRoute.identity.routeRevisionId,
      },
      explanation: currentMethodExplanationBase(previousRoute, context),
      provenance: {
        ...previousRoute.provenance,
        routerVersion: baseRouterVersion(previousRoute.provenance.routerVersion),
        evidenceRefs: unique([
          ...previousRoute.provenance.evidenceRefs,
          predecessorEvidenceRef,
        ]),
        ruleTrace: [...previousRoute.provenance.ruleTrace, choiceTrace],
      },
    });
    const integrated = integrateStudyRouteMethodDecision({
      route: provisionalBase,
      decision: {
        selection,
        // A direct learner choice does not read a new profile snapshot.
        profileVersion: previousRoute.provenance.profileVersion,
        // A committed route is an authorization boundary. Ordinary choices
        // rotate only the former primary and visible alternatives. The
        // explicit Other-method scope may add exactly its selected method,
        // already authorized from the predecessor eligibility trace, but the
        // successor still exposes at most two of the predecessor's choices.
        boundedChoiceMethodIds: unique([
          methodId,
          previousRoute.approach.primaryMethodId,
          ...previousRoute.agency.alternatives.map((alternative) => (
            alternative.primaryMethodId
          )),
        ]),
      },
    });
    const newTrace = integrated.provenance.ruleTrace.slice(
      previousRoute.provenance.ruleTrace.length,
    );
    const successor = createSuccessorStudyRoute({
      previous: previousRoute,
      routeRevisionId,
      createdAt: changeTime,
      changeReason: `The learner changed this ready session from ${previousRoute.approach.visibleMethodName} to ${integrated.approach.visibleMethodName}.`,
      changes: {
        approach: {
          ...integrated.approach,
        },
        execution: integrated.execution,
        agency: {
          ...integrated.agency,
          controlMode: "learner_customizes",
          selectedBy: "learner",
          override: {
            requestedAt: changeTime,
            changedFields: previousRoute.approach.visibleSupportingTechniqueId
              ? ["primary_method", "method_recipe"]
              : ["primary_method"],
            reason: integrated.explanation.shortReason,
          },
        },
        explanation: integrated.explanation,
        provenance: {
          routerVersion: integrated.provenance.routerVersion,
          profileVersion: integrated.provenance.profileVersion,
          evidenceRefs: integrated.provenance.evidenceRefs,
          ruleTrace: newTrace,
        },
      },
    });
    const committed = StudyRouteSchema.parse(
      commitStudyRouteRevision(successor as StudyRoute, changeTime),
    );
    assertMethodOnlySuccessor(previousRoute, committed);

    return Object.freeze({
      status: "updated" as const,
      session: methodChoiceSessionProjection(session, committed),
    });
  } catch (error) {
    if (error instanceof CommittedMethodChoiceError) throw error;
    throw choiceError(
      "route_construction_failed",
      "YOVA could not construct a bounded canonical successor for this method choice.",
      error,
    );
  }
}

function methodChoiceSessionProjection(
  session: CommittedMethodChoiceSessionInput,
  route: StudyRoute,
): CommittedMethodChoiceSessionProjection {
  const projected = studyRouteToLegacySessionProjection(route);
  return Object.freeze({
    id: session.id,
    method: projected.method,
    methodReason: projected.methodReason,
    estimatedMinutes: projected.estimatedMinutes,
    studyRoute: route,
  });
}

function currentMethodExplanationBase(
  route: StudyRoute,
  context: ReturnType<typeof methodSelectionContextForStudyRoute>,
) {
  const priorMethodRequirement = `${route.approach.visibleMethodName} is eligible for this ${context.taskType.replaceAll("_", " ")} ${context.learningMode === "learn" ? "Learn" : "Practice"} route at the ${context.knowledgeStage.replaceAll("_", " ")} stage.`;
  const previousReason = route.explanation.shortReason;
  return {
    ...route.explanation,
    taskRequirements: route.explanation.taskRequirements.filter((item) => (
      item !== priorMethodRequirement
    )),
    learnerDeclarations: route.explanation.learnerDeclarations.filter((item) => (
      item !== previousReason
    )),
    observations: route.explanation.observations.filter((item) => (
      item !== previousReason
    )),
  };
}

function assertCurrentSessionProjection(
  session: CommittedMethodChoiceSessionInput,
  route: StudyRoute,
) {
  const projected = studyRouteToLegacySessionProjection(route);
  const canonical = canonicalStudyRouteSessionScalars(session);
  if (
    canonical.objective !== route.target.desiredOutcome
    || session.method !== projected.method
    || session.methodReason !== projected.methodReason
    || session.estimatedMinutes !== projected.estimatedMinutes
    || session.learningMode !== projected.learningMode
    || !sameValue(session.topicIds ?? [], projected.topicIds ?? [])
    || !sameValue(
      session.completionEvidence ?? [],
      projected.completionEvidence ?? [],
    )
  ) {
    throw choiceError(
      "invalid_route_state",
      "The learner-visible session does not exactly project its committed StudyRoute.",
    );
  }
}

function assertPlanRouteProjection(
  plan: CommittedMethodChoicePlanInput,
  route: StudyRoute,
) {
  const expectedSourceMode = route.target.sourceRequirements.sourceType === "user_materials"
    ? "user_materials"
    : "yova_generated";
  if (
    plan.studyMode !== route.approach.executionEnvironment
    || plan.sourceMode !== expectedSourceMode
  ) {
    throw choiceError(
      "invalid_route_state",
      "The committed route no longer matches its plan execution or source contract.",
    );
  }
}

function assertMethodOnlySuccessor(previous: StudyRoute, successor: StudyRoute) {
  const materialChanges = materialStudyRouteChanges(previous, successor);
  const expectedMaterialChanges = previous.approach.visibleSupportingTechniqueId
    ? ["primary_method", "method_recipe", "phase_order"]
    : ["primary_method", "phase_order"];
  if (!sameValue(materialChanges, expectedMaterialChanges)) {
    throw choiceError(
      "route_invariant_violation",
      "A committed method choice may change only the primary method and its phase recipe.",
    );
  }
  if (
    successor.identity.routeLineageId !== previous.identity.routeLineageId
    || successor.identity.revisionNumber !== previous.identity.revisionNumber + 1
    || successor.identity.supersedesRevisionId !== previous.identity.routeRevisionId
    || successor.identity.planId !== previous.identity.planId
    || successor.identity.sessionId !== previous.identity.sessionId
    || successor.identity.lifecycleStatus !== "committed"
    || !sameValue(successor.target, previous.target)
    || !sameValue(successor.timing, previous.timing)
    || successor.approach.mode !== previous.approach.mode
    || successor.approach.executionEnvironment
      !== previous.approach.executionEnvironment
    || successor.approach.confidenceLevel !== previous.approach.confidenceLevel
    || successor.approach.visibleSupportingTechniqueId !== undefined
    || successor.execution.difficultyTier !== previous.execution.difficultyTier
    || successor.execution.initialSupport !== previous.execution.initialSupport
    || !sameValue(
      successor.execution.completionEvidence,
      previous.execution.completionEvidence,
    )
    || !sameValue(
      successor.execution.deferredTargets,
      previous.execution.deferredTargets,
    )
    || successor.provenance.profileVersion !== previous.provenance.profileVersion
  ) {
    throw choiceError(
      "route_invariant_violation",
      "The method successor changed a decision owned by another route boundary.",
    );
  }
}

function hasSavedMethodChoiceWork(session: CommittedMethodChoiceSessionInput) {
  return session.resource != null
    || session.activityProgress != null
    || session.sessionAdjustment != null;
}

function parseChangeTime(value: string, previous: StudyRoute) {
  const timestamp = Date.parse(value);
  const predecessorBoundary = Date.parse(
    previous.identity.committedAt ?? previous.identity.createdAt,
  );
  if (
    !Number.isFinite(timestamp)
    || new Date(timestamp).toISOString() !== value
    || timestamp < predecessorBoundary
  ) {
    throw choiceError(
      "invalid_change_time",
      "A committed method choice needs a canonical timestamp after its predecessor was committed.",
    );
  }
  return value;
}

function choiceError(
  code: CommittedMethodChoiceErrorCode,
  message: string,
  internalCause?: unknown,
) {
  return new CommittedMethodChoiceError(code, message, internalCause);
}

function baseRouterVersion(value: string) {
  const components = unique(value.split("+").filter((component) => (
    component
    && component !== STUDY_ROUTE_METHOD_PLAN_INTEGRATION_VERSION
    && component !== METHOD_RUNTIME_CAPABILITY_POLICY_VERSION
    && component !== METHOD_PRESENTATION_POLICY_VERSION
  )));
  if (components.length === 0) {
    throw choiceError(
      "invalid_route_state",
      "The committed route is missing its pre-method router provenance.",
    );
  }
  return components.join("+");
}

function sameValue(left: unknown, right: unknown) {
  return stableFingerprint(left, "committed-method-choice")
    === stableFingerprint(right, "committed-method-choice");
}

function unique<T>(values: readonly T[]) {
  return [...new Set(values)];
}
