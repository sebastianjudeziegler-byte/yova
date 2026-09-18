import { validateTopicComposition } from "@/lib/plan-generation/topic-plan-validation";
import { applyCoveredPracticeSupport, coveredPracticeAmountLabel } from "@/lib/plan-revision/covered-practice-support";
import { type NormalPlanRevisionContext } from "@/lib/plan-generation/normal-plan-revision-context";
import { normalPlanAmountLabel } from "@/lib/plan-generation/learner-plan-copy";
import type { LearningPlan, LearningPlanSession } from "@/lib/domain";
import { materializePlanDraft } from "@/lib/plan-generation/materialize-plan";
import {
  NORMAL_PLAN_ENVELOPE_COMPOSER_VERSION,
  type NormalPlanEnvelopeComposition,
} from "@/lib/plan-generation/normal-plan-envelopes";
import {
  assertNormalPlanMethodScaffoldReplaced,
  bindNormalPlanProviderFill,
} from "@/lib/plan-generation/normal-plan-provider-fill";
import {
  GeneratedLearningPlanSchema,
  PlanGenerationRequestSchema,
  type GeneratedPlanDraft,
  type PlanGenerationRequest,
} from "@/lib/plan-generation/schema";
import {
  studyRouteToLegacySessionProjection,
} from "@/lib/study-route/adapters";
import {
  integrateInitialPlanMethodRoutes,
  type InitialPlanMethodRoutingContext,
} from "@/lib/study-route/initial-plan-method-routing";
import { studyRouteProvenanceIncludesRouterComponent } from "@/lib/study-route/method-plan-integration";
import {
  NORMAL_PLAN_ENVELOPE_ROUTE_INTEGRATION_VERSION,
  integrateNormalPlanEnvelopeRoute,
} from "@/lib/study-route/normal-plan-envelope-integration";
import { StudyRouteSchema } from "@/lib/study-route/schema";

export const NORMAL_PLAN_PIPELINE_VERSION = "normal_plan_pipeline_v1" as const;

export type NormalPlanPipelineInput = Readonly<{
  request: PlanGenerationRequest;
  composition: NormalPlanEnvelopeComposition;
  fill: unknown;
  now: Date;
  methodContext: InitialPlanMethodRoutingContext;
  revisionContext?: NormalPlanRevisionContext;
}>;

type AcceptedNormalPlanRequest = PlanGenerationRequest & {
  knowledgeMap: NonNullable<PlanGenerationRequest["knowledgeMap"]>;
};

/**
 * The only public normal-plan materialization boundary. Provider output can
 * fill prose slots, but no pending method scaffold or route-free session can
 * cross this function's return boundary.
 */
export function buildNormalPlanFromFixedEnvelope(
  input: NormalPlanPipelineInput,
): LearningPlan {
  const request = parseAcceptedRequest(input.request);
  const now = parseClock(input.now);
  assertCompositionMatchesRequest({
    request,
    composition: input.composition,
    revisionContext: input.revisionContext,
    now,
  });

  const draft = bindNormalPlanProviderFill({
    request,
    composition: input.composition,
    fill: input.fill,
  });
  const materialized = materializePlanDraft(draft, request, now, {
    normalPlanEnvelopeComposition: input.composition,
  });
  if (materialized.sessions.some((session) => session.studyRoute !== undefined)) {
    throw pipelineError(
      "The private normal-plan materialization stage must produce only route-free pending sessions.",
    );
  }

  const envelopeBound: LearningPlan = {
    ...materialized,
    sessions: materialized.sessions.map((session) => ({
      ...session,
      studyRoute: integrateNormalPlanEnvelopeRoute({
        plan: materialized,
        session,
        composition: input.composition,
      }).route,
    })),
  };
  const routed = integrateInitialPlanMethodRoutes({
    plan: envelopeBound,
    request,
    context: input.methodContext,
    methodReasons: input.composition.envelopes.map(envelope => (input.fill as import("@/lib/plan-generation/normal-plan-provider-fill").NormalPlanProviderFill).sessions[envelope.envelopeId].methodReason),
  });

  assertNormalPlanMethodScaffoldReplaced(scaffoldAssertionProjection(routed));
  const validated = validateFinalPlan({
    plan: routed,
    request,
    composition: input.composition,
    methodProfileVersion: input.methodContext.profileVersion,
  });
  return deepFreeze({ ...validated, sessions: validated.sessions.map(session => {
    const route = applyCoveredPracticeSupport({ route: session.studyRoute!, map: request.knowledgeMap,
      profile: input.methodContext.rolloutDecision?.personalizationEnabled ? input.methodContext.personalization.canonicalProfile : null });
    return route === session.studyRoute ? session : { ...session, studyRoute: route, amountLabel: coveredPracticeAmountLabel(route) };
  }) });
}

function parseAcceptedRequest(request: PlanGenerationRequest): AcceptedNormalPlanRequest {
  const parsed = PlanGenerationRequestSchema.safeParse(request);
  if (!parsed.success || parsed.data.intent !== "plan" || !parsed.data.knowledgeMap) {
    throw pipelineError(
      "The atomic normal-plan pipeline requires one valid ordinary request with its accepted knowledge map.",
    );
  }
  return parsed.data as AcceptedNormalPlanRequest;
}

function parseClock(value: Date) {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw pipelineError("The atomic normal-plan pipeline requires one valid current time.");
  }
  return new Date(value.getTime());
}

function assertCompositionMatchesRequest({
  request,
  composition,
  now,
  revisionContext,
}: {
  revisionContext?: NormalPlanRevisionContext;
  request: AcceptedNormalPlanRequest;
  composition: NormalPlanEnvelopeComposition;
  now: Date;
}) {
  if (
    !composition
    || composition.version !== NORMAL_PLAN_ENVELOPE_COMPOSER_VERSION
    || !["complete", "partial"].includes(composition.status)
    || !Array.isArray(composition.envelopes)
    || !Array.isArray(composition.deferrals)
  ) {
    throw pipelineError("The atomic pipeline received an unsupported envelope composition.");
  }

  validateTopicComposition(request, composition, now, revisionContext);
}

function validateFinalPlan({
  plan,
  request,
  composition,
  methodProfileVersion,
}: {
  plan: LearningPlan;
  request: AcceptedNormalPlanRequest;
  composition: NormalPlanEnvelopeComposition;
  methodProfileVersion: string;
}) {
  const parsed = GeneratedLearningPlanSchema.safeParse(plan);
  if (
    !parsed.success
    || parsed.data.status !== "draft"
    || parsed.data.creationIntent !== "plan"
    || parsed.data.sessions.length !== composition.envelopes.length
    || parsed.data.deadline !== request.deadline
  ) {
    throw pipelineError("The atomic pipeline did not produce one valid ordinary draft plan.");
  }

  parsed.data.sessions.forEach((session, index) => {
    const envelope = composition.envelopes[index]!;
    const routeResult = StudyRouteSchema.safeParse(session.studyRoute);
    if (!routeResult.success) {
      throw pipelineError("Every final normal-plan session must have one valid provisional StudyRoute.");
    }
    const route = routeResult.data;
    const projection = studyRouteToLegacySessionProjection(route);
    const profileVersions = route.provenance.profileVersion.split("+");
    const envelopeTracePreserved = [
      ...envelope.modeRuleTrace,
      ...envelope.durationRuleTrace,
    ].every((expected) => route.provenance.ruleTrace.some((actual) => (
      sameJson(actual, expected)
    )));
    const composerTracePreserved = route.provenance.ruleTrace.some((entry) => (
      entry.ruleId === NORMAL_PLAN_ENVELOPE_COMPOSER_VERSION
      && entry.result === `${composition.status}:${envelope.kind}:${envelope.envelopeId}`
      && sameValues(entry.evidenceRefs, envelope.prerequisiteEvidenceRefs)
    ));
    if (
      session.sequence !== envelope.sequence
      || session.status !== (index === 0 ? "ready" : "upcoming")
      || session.scheduledFor !== envelope.scheduledFor
      || session.estimatedMinutes !== envelope.timing.activeMinutes
      || session.learningMode !== envelope.learningMode
      || !sameValues(session.topicIds ?? [], envelope.topicIds)
      || session.amountLabel !== amountLabel(
        envelope.topicIds.length,
        session.completionEvidence?.length ?? 0,
        envelope.timing.activeMinutes,
      )
      || route.identity.lifecycleStatus !== "provisional"
      || route.identity.planId !== parsed.data.id
      || route.identity.sessionId !== session.id
      || route.target.taskFamily !== envelope.taskFamily
      || route.target.desiredOutcome !== session.objective
      || !sameValues(
        route.target.targetStates.map((target) => target.targetId),
        envelope.topicIds,
      )
      || route.approach.mode !== (envelope.learningMode === "learn" ? "learn" : "practice")
      || !sameJson(route.timing, envelope.timing)
      || !sameSessionProjection(session, projection)
      || !studyRouteProvenanceIncludesRouterComponent(
        route.provenance,
        NORMAL_PLAN_ENVELOPE_ROUTE_INTEGRATION_VERSION,
      )
      || !studyRouteProvenanceIncludesRouterComponent(
        route.provenance,
        NORMAL_PLAN_ENVELOPE_COMPOSER_VERSION,
      )
      || !studyRouteProvenanceIncludesRouterComponent(
        route.provenance,
        envelope.durationRouterVersion,
      )
      || !envelopeTracePreserved
      || !composerTracePreserved
      || !envelope.prerequisiteEvidenceRefs.every((evidenceRef) => (
        route.provenance.evidenceRefs.includes(evidenceRef)
      ))
      || !profileComponents(composition.profileVersion).every((component) => (
        profileVersions.includes(component)
      ))
      || !profileComponents(methodProfileVersion).every((component) => (
        profileVersions.includes(component)
      ))
    ) {
      throw pipelineError("A final session route no longer exactly projects its fixed envelope and plan identity.");
    }
  });
  return parsed.data;
}

function scaffoldAssertionProjection(
  plan: LearningPlan,
): Pick<GeneratedPlanDraft, "sessions"> {
  return {
    sessions: plan.sessions.map((session) => ({
      title: session.title,
      objective: session.objective,
      method: session.method,
      methodReason: session.methodReason,
      scheduledFor: session.scheduledFor,
      estimatedMinutes: session.estimatedMinutes,
      amountLabel: session.amountLabel,
      learningMode: session.learningMode,
      topicIds: session.topicIds ?? [],
      contentTargets: session.contentTargets ?? [],
      completionEvidence: session.completionEvidence ?? [],
    })),
  };
}

function sameSessionProjection(
  session: LearningPlanSession,
  projection: ReturnType<typeof studyRouteToLegacySessionProjection>,
) {
  return session.method === projection.method
    && session.methodReason === projection.methodReason
    && session.estimatedMinutes === projection.estimatedMinutes
    && session.learningMode === projection.learningMode
    && sameValues(session.topicIds ?? [], projection.topicIds ?? [])
    && sameValues(session.completionEvidence ?? [], projection.completionEvidence ?? []);
}

const amountLabel = normalPlanAmountLabel;

function sameValues(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameJson(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function profileComponents(value: string) {
  return value
    .split("+")
    .map((component) => component.trim())
    .filter((component) => component && component !== "legacy_unknown");
}



function pipelineError(message: string) {
  return new Error(`${NORMAL_PLAN_PIPELINE_VERSION}: ${message}`);
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
