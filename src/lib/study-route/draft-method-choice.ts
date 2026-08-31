import {
  makeUuid,
  type LearningPlan,
} from "@/lib/domain";
import {
  selectCanonicalStudyMethod,
} from "@/lib/learning/canonical-method-selection";
import {
  METHOD_PRESENTATION_POLICY_VERSION,
  type CoreMethodId,
} from "@/lib/learning/method-catalog";
import { studyRouteToLegacySessionProjection } from "@/lib/study-route/adapters";
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
  StudyRouteRuleTraceEntrySchema,
  StudyRouteSchema,
  type StudyRoute,
} from "@/lib/study-route/schema";

export const DRAFT_METHOD_CHOICE_POLICY_VERSION =
  "normal_plan_draft_method_choice_v1" as const;

export const DRAFT_METHOD_CHOICE_ERROR_CODES = [
  "invalid_plan_state",
  "session_not_found",
  "route_required",
  "stale_route_revision",
  "invalid_route_state",
  "method_not_offered",
  "invalid_change_time",
] as const;

export type DraftMethodChoiceErrorCode =
  (typeof DRAFT_METHOD_CHOICE_ERROR_CODES)[number];

export class DraftMethodChoiceError extends Error {
  constructor(
    readonly code: DraftMethodChoiceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "DraftMethodChoiceError";
  }
}

export type DraftSessionMethodSelection = Readonly<{
  sessionId: string;
  expectedRouteRevisionId: string;
  methodId: CoreMethodId;
  choiceScope?: "stored_alternative" | "other_eligible_method";
}>;

export type ReviseDraftSessionMethodResult = Readonly<
  | { status: "unchanged"; plan: LearningPlan }
  | { status: "updated"; plan: LearningPlan }
>;

/**
 * Replaces one uncommitted normal-plan route candidate with a learner-chosen
 * eligible method. This is deliberately not a StudyRoute successor: no route
 * has been committed yet, so the winning candidate remains revision 1 with no
 * predecessor. A fresh route-revision ID prevents two differently signed
 * draft payloads from sharing one persistence/retry identity.
 */
export function reviseDraftSessionMethod({
  plan,
  selection,
  changedAt,
}: {
  plan: LearningPlan;
  selection: DraftSessionMethodSelection;
  changedAt: string;
}): ReviseDraftSessionMethodResult {
  if (plan.status !== "draft" || plan.creationIntent !== "plan") {
    throw new DraftMethodChoiceError(
      "invalid_plan_state",
      "A draft method choice applies only to an ordinary uncommitted plan.",
    );
  }

  const sessionIndex = plan.sessions.findIndex((session) => (
    session.id === selection.sessionId
  ));
  if (sessionIndex < 0) {
    throw new DraftMethodChoiceError(
      "session_not_found",
      "The selected plan session does not exist in this draft.",
    );
  }
  const session = plan.sessions[sessionIndex]!;
  if (session.reviewType || session.reviewConcept?.trim()) {
    throw new DraftMethodChoiceError(
      "invalid_route_state",
      "Scheduled reviews keep their separate lightweight method contract.",
    );
  }

  const parsedRoute = StudyRouteSchema.safeParse(session.studyRoute);
  if (!parsedRoute.success) {
    throw new DraftMethodChoiceError(
      "route_required",
      "A normal-plan method choice requires its exact provisional StudyRoute.",
    );
  }
  const route = parsedRoute.data;
  if (
    route.identity.planId !== plan.id
    || route.identity.sessionId !== session.id
  ) {
    throw new DraftMethodChoiceError(
      "invalid_route_state",
      "The selected StudyRoute does not belong to this plan session.",
    );
  }
  if (route.identity.routeRevisionId !== selection.expectedRouteRevisionId) {
    throw new DraftMethodChoiceError(
      "stale_route_revision",
      "The session recipe changed before this method choice was applied.",
    );
  }
  if (
    route.identity.lifecycleStatus !== "provisional"
    || route.identity.revisionNumber !== 1
    || route.identity.supersedesRevisionId
    || route.timing.durationSource === "scheduled_review"
  ) {
    throw new DraftMethodChoiceError(
      "invalid_route_state",
      "Only an initial provisional route candidate can be changed before activation.",
    );
  }

  if (route.approach.primaryMethodId === selection.methodId) {
    return Object.freeze({ status: "unchanged" as const, plan });
  }
  const otherEligibleChoice = selection.choiceScope === "other_eligible_method";
  if (
    otherEligibleChoice
      ? !isAuthorizedOtherMethodChoice(route, selection.methodId)
      : !isExactStoredAgencyMethodChoice(route, selection.methodId)
  ) {
    throw new DraftMethodChoiceError(
      "method_not_offered",
      otherEligibleChoice
        ? "The requested Other method is outside this customize route's immutable eligible set."
        : "The selected method was not one of the exact method-only alternatives shown for this session.",
    );
  }

  const changeTime = parseChangeTime(changedAt, route.identity.createdAt);
  const choiceEvidenceRef = [
    "learner-choice",
    "plan-draft",
    plan.id,
    session.id,
    selection.methodId,
  ].join(":");
  const decisionContext = methodSelectionContextForStudyRoute(route);
  const baseRoute = prepareRouteForChoice({
    route,
    changedAt: changeTime,
    choiceEvidenceRef,
    methodId: selection.methodId,
    choiceScope: selection.choiceScope ?? "stored_alternative",
  });
  const canonicalSelection = selectCanonicalStudyMethod({
    ...decisionContext,
    eligibilityPolicyVersion: otherEligibleChoice
      ? immutableStudyRouteMethodEligibility(route).policyVersion
      : storedAgencyChoiceEligibilityPolicyVersion(route),
    learnerChoice: {
      methodId: selection.methodId,
      evidenceRef: choiceEvidenceRef,
    },
  });
  const integrated = integrateStudyRouteMethodDecision({
    route: baseRoute,
    decision: {
      selection: canonicalSelection,
      // The learner choice does not consult a new profile snapshot. Preserve
      // the already authenticated context that produced the signed draft.
      profileVersion: route.provenance.profileVersion,
    },
  });
  const chosenRoute = StudyRouteSchema.parse({
    ...integrated,
    agency: {
      ...integrated.agency,
      // integrateStudyRouteMethodDecision compares with the task baseline.
      // Here the relevant fact is that the learner changed the currently
      // reviewed route, even when choosing that baseline from a personalized
      // recommendation. Always record that exact pre-commit override.
      override: {
        requestedAt: changeTime,
        changedFields: route.approach.visibleSupportingTechniqueId
          ? ["primary_method", "method_recipe"]
          : ["primary_method"],
        reason: integrated.explanation.shortReason,
      },
    },
  });
  const updatedSession = {
    ...session,
    ...studyRouteToLegacySessionProjection(chosenRoute),
    studyRoute: chosenRoute,
  };
  const updatedPlan: LearningPlan = {
    ...plan,
    sessions: plan.sessions.map((candidate, index) => (
      index === sessionIndex ? updatedSession : candidate
    )),
  };

  return Object.freeze({ status: "updated" as const, plan: updatedPlan });
}

function prepareRouteForChoice({
  route,
  changedAt,
  choiceEvidenceRef,
  methodId,
  choiceScope,
}: {
  route: StudyRoute;
  changedAt: string;
  choiceEvidenceRef: string;
  methodId: CoreMethodId;
  choiceScope: "stored_alternative" | "other_eligible_method";
}) {
  const priorChoiceBoundary = route.provenance.ruleTrace.findIndex((entry) => (
    entry.ruleId === DRAFT_METHOD_CHOICE_POLICY_VERSION
  ));
  const baseRuleTrace = priorChoiceBoundary >= 0
    ? route.provenance.ruleTrace.slice(0, priorChoiceBoundary)
    : route.provenance.ruleTrace;
  const priorChoiceReason = route.agency.selectedBy === "learner"
    ? route.explanation.shortReason
    : null;
  const context = methodSelectionContextForStudyRoute(route);
  const priorTaskRequirement = methodTaskRequirement(
    route.approach.visibleMethodName,
    context,
  );
  const choiceTrace = StudyRouteRuleTraceEntrySchema.parse({
    ruleId: DRAFT_METHOD_CHOICE_POLICY_VERSION,
    result: `${route.approach.primaryMethodId}->${methodId}`,
    reason: choiceScope === "other_eligible_method"
      ? "The learner requested an eligible, deliverable method through I'll Customize Other methods for this uncommitted session recipe."
      : "The learner chose one of the bounded method alternatives shown for this uncommitted session recipe.",
    evidenceRefs: [choiceEvidenceRef],
  });
  return StudyRouteSchema.parse({
    ...route,
    identity: {
      routeLineageId: route.identity.routeLineageId,
      routeRevisionId: makeUuid(),
      revisionNumber: 1,
      schemaVersion: route.identity.schemaVersion,
      lifecycleStatus: "provisional",
      planId: route.identity.planId,
      sessionId: route.identity.sessionId,
      createdAt: changedAt,
    },
    explanation: {
      ...route.explanation,
      taskRequirements: route.explanation.taskRequirements.filter((requirement) => (
        requirement !== priorTaskRequirement
      )),
      learnerDeclarations: route.explanation.learnerDeclarations.filter((declaration) => (
        declaration !== priorChoiceReason
      )),
    },
    provenance: {
      ...route.provenance,
      routerVersion: baseRouterVersion(route.provenance.routerVersion),
      evidenceRefs: route.provenance.evidenceRefs.filter((reference) => (
        !reference.startsWith("learner-choice:plan-draft:")
      )),
      ruleTrace: [...baseRuleTrace, choiceTrace],
    },
  });
}

function baseRouterVersion(value: string) {
  const components = [...new Set(value.split("+").filter((component) => (
    component
    && component !== STUDY_ROUTE_METHOD_PLAN_INTEGRATION_VERSION
    && component !== METHOD_RUNTIME_CAPABILITY_POLICY_VERSION
    && component !== METHOD_PRESENTATION_POLICY_VERSION
  )))];
  if (components.length === 0) {
    throw new DraftMethodChoiceError(
      "invalid_route_state",
      "The provisional route is missing its pre-method router provenance.",
    );
  }
  return components.join("+");
}

function methodTaskRequirement(
  visibleMethodName: string,
  context: ReturnType<typeof methodSelectionContextForStudyRoute>,
) {
  return `${visibleMethodName} is eligible for this ${context.taskType.replaceAll("_", " ")} ${context.learningMode === "learn" ? "Learn" : "Practice"} route at the ${context.knowledgeStage.replaceAll("_", " ")} stage.`;
}

function parseChangeTime(value: string, currentRouteCreatedAt: string) {
  const milliseconds = Date.parse(value);
  if (
    !Number.isFinite(milliseconds)
    || new Date(milliseconds).toISOString() !== value
    || milliseconds < Date.parse(currentRouteCreatedAt)
  ) {
    throw new DraftMethodChoiceError(
      "invalid_change_time",
      "A draft method choice needs a valid timestamp after the current route candidate was created.",
    );
  }
  return value;
}
