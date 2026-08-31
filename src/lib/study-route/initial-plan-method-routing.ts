import {
  makeUuid,
  type LearningPlan,
  type LearningPlanSession,
} from "@/lib/domain";
import {
  selectCanonicalStudyMethod,
  type CanonicalObservedMethodEvidence,
} from "@/lib/learning/canonical-method-selection";
import { CORE_METHOD_CATALOG } from "@/lib/learning/method-catalog";
import { classifyLearningTask } from "@/lib/learning/method-router";
import type { GenerationPersonalizationContext } from "@/lib/personalization/personalization-generation";
import { NORMAL_PLAN_INTERNAL_METHOD_SCAFFOLD } from "@/lib/plan-generation/normal-plan-provider-fill";
import type { PlanGenerationRequest } from "@/lib/plan-generation/schema";
import {
  legacyPlanSessionToStudyRoute,
  studyRouteToLegacySessionProjection,
} from "@/lib/study-route/adapters";
import {
  integrateStudyRouteMethodDecision,
  methodSelectionContextForStudyRoute,
} from "@/lib/study-route/method-plan-integration";
import { resolveStudyRouteAgencyMode } from "@/lib/study-route/agency-mode-controller";
import {
  methodEvidenceComparisonContextForRoute,
  methodEvidenceComparisonKey,
} from "@/lib/study-route/method-evidence-policy";
import {
  StudyRouteRuleTraceEntrySchema,
  StudyRouteSchema,
  type StudyRoute,
} from "@/lib/study-route/schema";
import {
  personalizationInputsForRollout,
  resolvePersonalizationRollout,
  type PersonalizationRolloutDecision,
} from "@/lib/study-route/personalization-rollout";
import { NORMAL_PLAN_ENVELOPE_ROUTE_INTEGRATION_VERSION } from "@/lib/study-route/normal-plan-envelope-integration";

export const INITIAL_PLAN_METHOD_ROUTING_VERSION =
  "initial_plan_method_routing_v1" as const;

export type InitialPlanMethodRoutingContext = {
  /** Authorized learner-context snapshot, never profile-summary prose. */
  profileVersion: string;
  personalization: DeepReadonly<GenerationPersonalizationContext>;
  observedEvidence: readonly CanonicalObservedMethodEvidence[];
  /** Server-owned, account-stable assignment for this new route issuance. */
  rolloutDecision?: PersonalizationRolloutDecision;
};

/**
 * Applies the canonical method policy to every ordinary draft session after
 * the model or deterministic preview has proposed the learning sequence.
 * Generated method prose is deliberately excluded from task classification
 * and selection; it survives only long enough to satisfy the legacy draft
 * schema before this code-owned route projection replaces it.
 */
export function integrateInitialPlanMethodRoutes({
  plan,
  request,
  context,
}: {
  plan: LearningPlan;
  request: PlanGenerationRequest;
  context: InitialPlanMethodRoutingContext;
}): LearningPlan {
  if (request.intent !== "plan" || plan.creationIntent !== "plan") {
    throw new Error("Initial multi-session method routing applies only to ordinary plan drafts.");
  }
  if (plan.status !== "draft") {
    throw new Error("Initial plan methods must be selected before the plan is activated.");
  }

  const rolloutDecision = context.rolloutDecision
    ?? resolvePersonalizationRollout({
      rolloutPercent: 0,
      subjectKey: null,
    });
  const routedInputs = personalizationInputsForRollout({
    decision: rolloutDecision,
    personalization: context.personalization,
    observedEvidence: context.observedEvidence,
  });
  const sessions = plan.sessions.map((session) => {
    if (session.reviewType || session.reviewConcept?.trim()) {
      throw new Error("Initial plan method routing cannot rewrite a scheduled review contract.");
    }
    const route = canonicalDraftRouteScaffold({ plan, request, session });
    const selection = selectCanonicalStudyMethod({
      ...methodSelectionContextForStudyRoute(route),
      currentComparisonKey: methodEvidenceComparisonKey(
        methodEvidenceComparisonContextForRoute(route),
      ),
      ...routedInputs,
    });
    const integratedRoute = integrateStudyRouteMethodDecision({
      route,
      decision: {
        selection,
        profileVersion: context.profileVersion,
        rolloutDecision,
        agencyMode: resolveStudyRouteAgencyMode(
          context.personalization.canonicalProfile,
        ),
      },
    });

    return {
      ...session,
      ...studyRouteToLegacySessionProjection(integratedRoute),
      studyRoute: integratedRoute,
    };
  });

  if (sessions.some(hasInternalNormalPlanMethodScaffold)) {
    throw new Error("Initial plan method routing must replace every internal normal-plan method scaffold.");
  }

  return { ...plan, sessions };
}

function canonicalDraftRouteScaffold({
  plan,
  request,
  session,
}: {
  plan: LearningPlan;
  request: PlanGenerationRequest;
  session: LearningPlanSession;
}): StudyRoute {
  const parsedStoredRoute = StudyRouteSchema.safeParse(session.studyRoute);
  if (session.studyRoute != null && !parsedStoredRoute.success) {
    throw new Error("The generated plan contains an invalid provisional StudyRoute.");
  }
  const route = parsedStoredRoute.success
    ? parsedStoredRoute.data
    : legacyPlanSessionToStudyRoute({
        plan,
        // The legacy adapter needs a recognized method to build the neutral
        // route shell. Canonical routing below always replaces this seed.
        session: {
          ...session,
          method: CORE_METHOD_CATALOG.self_explanation.name,
          methodReason: "Temporary method scaffold for the code-owned initial-plan router.",
        },
        adaptedAt: plan.createdAt,
        identity: {
          routeLineageId: makeUuid(),
          routeRevisionId: makeUuid(),
          lifecycleStatus: "provisional",
          createdAt: plan.createdAt,
        },
      });
  if (!route) {
    throw new Error("YOVA could not build a canonical route scaffold for a generated plan session.");
  }
  if (
    route.identity.lifecycleStatus !== "provisional"
    || route.identity.planId !== plan.id
    || route.identity.sessionId !== session.id
  ) {
    throw new Error("Initial plan method routing requires an exact provisional route identity.");
  }
  if (route.timing.durationSource === "scheduled_review") {
    throw new Error("Initial plan method routing cannot consume a scheduled-review route.");
  }

  const envelopeOwnsTaskFamily = route.provenance.routerVersion
    .split("+")
    .includes(NORMAL_PLAN_ENVELOPE_ROUTE_INTEGRATION_VERSION);
  const taskClassification = envelopeOwnsTaskFamily
    ? null
    : classifyLearningTask([
        request.goal,
        request.startingContext ?? "",
        plan.kind,
        plan.title,
        plan.topic,
        session.title,
        session.objective,
        ...(session.contentTargets ?? []),
        ...(session.completionEvidence ?? []),
      ].join(" "));
  const taskFamily = taskClassification?.taskType ?? route.target.taskFamily;
  const classificationTrace = StudyRouteRuleTraceEntrySchema.parse({
    ruleId: INITIAL_PLAN_METHOD_ROUTING_VERSION,
    result: taskClassification
      ? `${taskClassification.taskType}:${taskClassification.confidence}`
      : `${taskFamily}:normal_plan_envelope`,
    reason: taskClassification
      ? "Task family was classified from the learner request, plan target, objective, and evidence contract. Generated method prose was excluded from the decision."
      : "Task family was preserved from the deterministic normal-plan envelope. Provider plan, session, evidence, and method prose were excluded from the decision.",
    evidenceRefs: [],
  });

  return StudyRouteSchema.parse({
    ...route,
    target: {
      ...route.target,
      taskFamily,
    },
    provenance: {
      ...route.provenance,
      ruleTrace: [...route.provenance.ruleTrace, classificationTrace],
    },
  });
}

function hasInternalNormalPlanMethodScaffold(
  session: Pick<LearningPlanSession, "method" | "methodReason">,
) {
  return session.method === NORMAL_PLAN_INTERNAL_METHOD_SCAFFOLD.method
    && session.methodReason === NORMAL_PLAN_INTERNAL_METHOD_SCAFFOLD.methodReason;
}

type Primitive = string | number | boolean | bigint | symbol | null | undefined;
type DeepReadonly<T> = T extends Primitive | ((...args: never[]) => unknown)
  ? T
  : T extends readonly (infer Item)[]
    ? readonly DeepReadonly<Item>[]
    : { readonly [Key in keyof T]: DeepReadonly<T[Key]> };
