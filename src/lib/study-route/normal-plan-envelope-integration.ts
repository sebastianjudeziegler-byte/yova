import type { LearningPlan, LearningPlanSession } from "@/lib/domain";
import { CORE_METHOD_CATALOG } from "@/lib/learning/method-catalog";
import {
  NORMAL_PLAN_ENVELOPE_COMPOSER_VERSION,
  type NormalPlanEnvelopeComposition,
  type NormalPlanSessionEnvelope,
} from "@/lib/plan-generation/normal-plan-envelopes";
import { NORMAL_PLAN_INTERNAL_METHOD_SCAFFOLD } from "@/lib/plan-generation/normal-plan-provider-fill";
import { GeneratedLearningPlanSchema } from "@/lib/plan-generation/schema";
import {
  LEGACY_STUDY_ROUTE_ADAPTER_VERSION,
  legacyPlanSessionToStudyRoute,
  studyRouteToLegacySessionProjection,
} from "@/lib/study-route/adapters";
import { composeStudyRouteProfileVersion } from "@/lib/study-route/provenance-version";
import { NORMAL_DURATION_RECOMMENDER_VERSION } from "@/lib/study-route/duration-recommendation";
import {
  StudyRouteProvenanceSchema,
  StudyRouteRuleTraceEntrySchema,
  StudyRouteSchema,
  type StudyRoute,
  type StudyRouteRuleTraceEntry,
  type StudyRouteTiming,
} from "@/lib/study-route/schema";

export const NORMAL_PLAN_ENVELOPE_ROUTE_INTEGRATION_VERSION =
  "normal_plan_envelope_route_integration_v1" as const;

export const NORMAL_PLAN_PREREQUISITE_BINDING_VERSION =
  "normal_plan_prerequisite_binding_v1" as const;

export const NORMAL_PLAN_ENVELOPE_ROUTE_ERROR_CODES = [
  "invalid_plan",
  "not_normal_plan",
  "invalid_composition",
  "session_mismatch",
  "route_mismatch",
  "review_not_supported",
  "provenance_overflow",
] as const;

export type NormalPlanEnvelopeRouteErrorCode =
  (typeof NORMAL_PLAN_ENVELOPE_ROUTE_ERROR_CODES)[number];

export class NormalPlanEnvelopeRouteIntegrationError extends Error {
  constructor(
    readonly code: NormalPlanEnvelopeRouteErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "NormalPlanEnvelopeRouteIntegrationError";
  }
}

export type NormalPlanEnvelopeRouteBinding = Readonly<{
  route: StudyRoute;
}>;

const LEGACY_DURATION_UNCERTAINTY =
  "The duration is preserved, but the legacy record does not show how it was chosen.";
const LEGACY_TASK_FAMILY_UNCERTAINTY =
  "The task family is derived from legacy task text rather than a stored routing decision.";
const REPLACED_LEGACY_UNCERTAINTIES = new Set([
  LEGACY_DURATION_UNCERTAINTY,
  LEGACY_TASK_FAMILY_UNCERTAINTY,
]);
const NORMAL_DURATION_SOURCES = new Set<StudyRouteTiming["durationSource"]>([
  "router_default",
  "profile_recommendation",
  "observed_outcome_adjustment",
  "availability_cap",
  "learner_override",
]);
const INTERNAL_ROUTE_SHELL_METHOD = Object.freeze({
  method: CORE_METHOD_CATALOG.self_explanation.name,
  methodReason: "Temporary neutral route shell for the code-owned normal-plan method router.",
});

/**
 * Replaces only the legacy facts for which one deterministic normal-plan
 * envelope is authoritative. Method, phases, support, targets, schedule, and
 * identity remain unchanged until their own code-owned boundaries run. Learn
 * targets and one completion check per target are rebound from the exact mode
 * decisions because the legacy shell cannot represent those facts precisely.
 */
export function integrateNormalPlanEnvelopeRoute({
  plan: planInput,
  session: sessionInput,
  route: routeInput,
  composition,
}: {
  plan: LearningPlan;
  session: LearningPlanSession;
  route?: StudyRoute | null;
  composition: NormalPlanEnvelopeComposition;
}): NormalPlanEnvelopeRouteBinding {
  const { plan, session, envelope } = validatePlanSessionAndComposition({
    planInput,
    sessionInput,
    composition,
  });
  const route = validateFreshRouteShell({ plan, session, envelope, routeInput });
  const targetStates = bindEnvelopeTargetStates(route, envelope);
  const modeTrace = envelope.modeRuleTrace.map(parseTrace);
  const durationTrace = envelope.durationRuleTrace.map(parseTrace);
  const composerTrace = StudyRouteRuleTraceEntrySchema.parse({
    ruleId: NORMAL_PLAN_ENVELOPE_COMPOSER_VERSION,
    result: `${composition.status}:${envelope.kind}:${envelope.envelopeId}`,
    reason: "The deterministic normal-plan composer fixed this session's sequence, targets, mode, schedule, and duration before learner-facing copy was generated.",
    evidenceRefs: envelope.prerequisiteEvidenceRefs,
  });
  const prerequisiteTrace = envelope.prerequisiteEvidenceRefs.length > 0
    ? [StudyRouteRuleTraceEntrySchema.parse({
        ruleId: NORMAL_PLAN_PREREQUISITE_BINDING_VERSION,
        result: `preserved_${envelope.prerequisiteEvidenceRefs.length}_prerequisite_evidence_refs`,
        reason: "Accepted target-specific evidence satisfied these prerequisites without adding or changing a session target.",
        evidenceRefs: envelope.prerequisiteEvidenceRefs,
      })]
    : [];
  const appendedTrace = [
    composerTrace,
    ...modeTrace,
    ...durationTrace,
    ...prerequisiteTrace,
  ];
  const ruleTrace = [...route.provenance.ruleTrace, ...appendedTrace];
  const evidenceRefs = unique([
    ...route.provenance.evidenceRefs,
    ...envelope.prerequisiteEvidenceRefs,
    ...appendedTrace.flatMap((entry) => entry.evidenceRefs),
  ]);
  if (ruleTrace.length > 200 || evidenceRefs.length > 100) {
    throw integrationError(
      "provenance_overflow",
      "The normal-plan envelope provenance exceeds the canonical StudyRoute limits.",
    );
  }

  const integrated = StudyRouteSchema.parse({
    ...route,
    target: {
      ...route.target,
      taskFamily: envelope.taskFamily,
      targetStates,
    },
    approach: {
      ...route.approach,
      mode: routeMode(envelope),
    },
    timing: envelope.timing,
    execution: {
      ...route.execution,
      completionEvidence: route.execution.completionEvidence.map((evidence, index) => ({
        ...evidence,
        targetIds: [envelope.topicIds[index]!],
        kind: envelopeEvidenceKind(envelope, route.approach.executionEnvironment),
      })),
    },
    explanation: {
      ...route.explanation,
      uncertainties: route.explanation.uncertainties.filter((uncertainty) => (
        !REPLACED_LEGACY_UNCERTAINTIES.has(uncertainty)
      )),
    },
    provenance: {
      routerVersion: compositeRouterVersion(
        route.provenance.routerVersion,
        envelope.durationRouterVersion,
      ),
      profileVersion: composeStudyRouteProfileVersion(
        route.provenance.profileVersion,
        composition.profileVersion,
      ),
      evidenceRefs,
      ruleTrace,
    },
  });
  assertPreservedRouteFields(route, integrated, envelope);

  return deepFreeze({
    route: integrated,
  });
}

function validatePlanSessionAndComposition({
  planInput,
  sessionInput,
  composition,
}: {
  planInput: LearningPlan;
  sessionInput: LearningPlanSession;
  composition: NormalPlanEnvelopeComposition;
}) {
  if (planInput.creationIntent !== "plan") {
    throw integrationError(
      "not_normal_plan",
      "Normal-plan envelope integration does not accept Study Now or legacy intent-less plans.",
    );
  }
  const parsedPlan = GeneratedLearningPlanSchema.safeParse(planInput);
  if (!parsedPlan.success || parsedPlan.data.status !== "draft") {
    throw integrationError(
      "invalid_plan",
      "Normal-plan envelope integration requires one valid generated draft plan.",
    );
  }
  const plan = parsedPlan.data;
  if (
    !composition
    || composition.version !== NORMAL_PLAN_ENVELOPE_COMPOSER_VERSION
    || !["complete", "partial"].includes(composition.status)
    || !Array.isArray(composition.envelopes)
    || composition.envelopes.length !== plan.sessions.length
    || composition.envelopes.length < 1
    || !Array.isArray(composition.deferrals)
  ) {
    throw integrationError(
      "invalid_composition",
      "The sidecar must be the exact supported composition for every generated plan session.",
    );
  }
  const parsedProfileVersion = StudyRouteProvenanceSchema.shape.profileVersion.safeParse(
    composition.profileVersion,
  );
  if (!parsedProfileVersion.success || parsedProfileVersion.data === "legacy_unknown") {
    throw integrationError(
      "invalid_composition",
      "The normal-plan composition must identify its authorized profile snapshot.",
    );
  }
  if (plan.sessions.some((candidate, index) => candidate.sequence !== index + 1)) {
    throw integrationError(
      "session_mismatch",
      "Generated normal-plan sessions must retain one contiguous sequence.",
    );
  }

  const sessionIndex = sessionInput.sequence - 1;
  const session = plan.sessions[sessionIndex];
  const rawStoredSession = planInput.sessions[sessionIndex];
  const envelope = composition.envelopes[sessionIndex];
  if (
    !session
    || !rawStoredSession
    || !envelope
    || envelope.sequence !== sessionInput.sequence
    || session.id !== sessionInput.id
    || !sameSessionScalars(session, sessionInput)
  ) {
    throw integrationError(
      "session_mismatch",
      "The supplied session is not the exact scalar session at this plan sequence.",
    );
  }
  if (
    sessionInput.reviewType !== undefined
    || sessionInput.reviewConcept !== undefined
    || rawStoredSession.reviewType !== undefined
    || rawStoredSession.reviewConcept !== undefined
  ) {
    throw integrationError(
      "review_not_supported",
      "Normal-plan envelope integration cannot rewrite a scheduled review contract.",
    );
  }
  validateSessionAgainstEnvelope(session, envelope);
  return { plan, session, envelope };
}

function validateSessionAgainstEnvelope(
  session: LearningPlanSession,
  envelope: NormalPlanSessionEnvelope,
) {
  const completionEvidenceCount = session.completionEvidence?.length ?? 0;
  if (
    session.sequence !== envelope.sequence
    || envelope.envelopeId !== expectedEnvelopeId(envelope.sequence)
    || envelope.durationRouterVersion !== NORMAL_DURATION_RECOMMENDER_VERSION
    || session.scheduledFor !== envelope.scheduledFor
    || session.estimatedMinutes !== envelope.timing.activeMinutes
    || session.learningMode !== envelope.learningMode
    || session.method !== NORMAL_PLAN_INTERNAL_METHOD_SCAFFOLD.method
    || session.methodReason !== NORMAL_PLAN_INTERNAL_METHOD_SCAFFOLD.methodReason
    || session.status !== (envelope.sequence === 1 ? "ready" : "upcoming")
    || !sameValues(session.topicIds ?? [], envelope.topicIds)
    || (session.contentTargets ?? []).length !== envelope.topicIds.length
    || envelope.topicIds.length > envelope.contentBudget.maximumCompletionChecks
    || completionEvidenceCount !== envelope.topicIds.length
    || envelope.targetModeDecisions.length !== envelope.topicIds.length
    || envelope.targetModeDecisions.some((decision, index) => (
      decision.topicId !== envelope.topicIds[index]
    ))
    || session.amountLabel !== amountLabel(
      envelope.topicIds.length,
      completionEvidenceCount,
      envelope.timing.activeMinutes,
    )
    || envelope.contentBudget.minutes !== envelope.timing.activeMinutes
    || envelope.hardMaximumMinutes !== envelope.timing.hardMaximumMinutes
    || !NORMAL_DURATION_SOURCES.has(envelope.timing.durationSource)
  ) {
    throw integrationError(
      "session_mismatch",
      "The session sequence, targets, mode, schedule, or minutes no longer match its fixed envelope.",
    );
  }
}

function validateFreshRouteShell({
  plan,
  session,
  envelope,
  routeInput,
}: {
  plan: LearningPlan;
  session: LearningPlanSession;
  envelope: NormalPlanSessionEnvelope;
  routeInput: StudyRoute | null | undefined;
}) {
  const storedRouteResult = StudyRouteSchema.safeParse(session.studyRoute);
  const route = storedRouteResult.success
    ? exactStoredRoute(storedRouteResult.data, routeInput)
    : internalRouteShell({ plan, session, routeInput });
  const projection = studyRouteToLegacySessionProjection(route);
  if (
    route.identity.lifecycleStatus !== "provisional"
    || route.identity.planId !== plan.id
    || route.identity.sessionId !== session.id
    || route.provenance.routerVersion !== LEGACY_STUDY_ROUTE_ADAPTER_VERSION
    || route.provenance.profileVersion !== "legacy_unknown"
    || route.timing.durationSource !== "legacy_reconstruction"
    || route.approach.executionEnvironment !== plan.studyMode
    || route.target.desiredOutcome !== session.objective
    || route.approach.mode !== routeMode(envelope)
    || projection.method !== INTERNAL_ROUTE_SHELL_METHOD.method
    || projection.methodReason !== INTERNAL_ROUTE_SHELL_METHOD.methodReason
    || projection.estimatedMinutes !== session.estimatedMinutes
    || projection.learningMode !== session.learningMode
    || !sameValues(projection.topicIds ?? [], envelope.topicIds)
    || !sameValues(projection.completionEvidence ?? [], session.completionEvidence ?? [])
    || !sameValues(
      route.target.targetStates.map((target) => target.targetId),
      envelope.topicIds,
    )
    || route.execution.completionEvidence.length !== envelope.topicIds.length
    || route.execution.completionEvidence.some((evidence) => (
      !sameValues(evidence.targetIds, envelope.topicIds)
    ))
  ) {
    throw integrationError(
      "route_mismatch",
      "The route identity, targets, mode, environment, method scaffold, or scalar promise does not match the fixed session.",
    );
  }
  return route;
}

function exactStoredRoute(
  storedRoute: StudyRoute,
  routeInput: StudyRoute | null | undefined,
) {
  if (routeInput === undefined || routeInput === null) return storedRoute;
  const routeResult = StudyRouteSchema.safeParse(routeInput);
  if (!routeResult.success || !sameJson(routeResult.data, storedRoute)) {
    throw integrationError(
      "route_mismatch",
      "The supplied route is not the exact provisional shell stored on this session.",
    );
  }
  return routeResult.data;
}

function internalRouteShell({
  plan,
  session,
  routeInput,
}: {
  plan: LearningPlan;
  session: LearningPlanSession;
  routeInput: StudyRoute | null | undefined;
}) {
  if (routeInput !== undefined && routeInput !== null) {
    throw integrationError(
      "route_mismatch",
      "An unstored route cannot become the authority for a pending normal-plan session.",
    );
  }
  if (
    session.method !== NORMAL_PLAN_INTERNAL_METHOD_SCAFFOLD.method
    || session.methodReason !== NORMAL_PLAN_INTERNAL_METHOD_SCAFFOLD.methodReason
  ) {
    throw integrationError(
      "route_mismatch",
      "Only the exact private pending-method scaffold may receive an internal route shell.",
    );
  }
  const route = legacyPlanSessionToStudyRoute({
    plan,
    session: {
      ...session,
      ...INTERNAL_ROUTE_SHELL_METHOD,
    },
    adaptedAt: plan.createdAt,
    identity: {
      lifecycleStatus: "provisional",
      createdAt: plan.createdAt,
    },
  });
  if (!route) {
    throw integrationError(
      "route_mismatch",
      "YOVA could not construct the private neutral shell for this pending normal-plan session.",
    );
  }
  return route;
}

function assertPreservedRouteFields(
  before: StudyRoute,
  after: StudyRoute,
  envelope: NormalPlanSessionEnvelope,
) {
  const preserved = (route: StudyRoute) => ({
    identity: route.identity,
    desiredOutcome: route.target.desiredOutcome,
    sourceRequirements: route.target.sourceRequirements,
    executionEnvironment: route.approach.executionEnvironment,
    primaryMethodId: route.approach.primaryMethodId,
    visibleMethodName: route.approach.visibleMethodName,
    visibleSupportingTechniqueId: route.approach.visibleSupportingTechniqueId,
    confidenceLevel: route.approach.confidenceLevel,
    execution: {
      ...route.execution,
      completionEvidence: route.execution.completionEvidence.map((evidence) => ({
        evidenceId: evidence.evidenceId,
        description: evidence.description,
        requiresIndependentAttempt: evidence.requiresIndependentAttempt,
      })),
    },
    agency: route.agency,
    shortReason: route.explanation.shortReason,
    taskRequirements: route.explanation.taskRequirements,
    learnerDeclarations: route.explanation.learnerDeclarations,
    observations: route.explanation.observations,
  });
  if (!sameJson(preserved(before), preserved(after))) {
    throw integrationError(
      "route_mismatch",
      "Envelope integration attempted to change a method-, target-, support-, or identity-owned field.",
    );
  }
  if (
    !sameJson(after.target.targetStates, bindEnvelopeTargetStates(before, envelope))
    || after.execution.completionEvidence.some((evidence, index) => (
      !sameValues(evidence.targetIds, [envelope.topicIds[index]!])
    ))
  ) {
    throw integrationError(
      "route_mismatch",
      "Envelope integration did not preserve the exact target-mode and one-check-per-target binding.",
    );
  }
}

function bindEnvelopeTargetStates(
  route: StudyRoute,
  envelope: NormalPlanSessionEnvelope,
) {
  if (
    route.target.targetStates.length !== envelope.targetModeDecisions.length
    || route.target.targetStates.some((target, index) => (
      target.targetId !== envelope.targetModeDecisions[index]?.topicId
    ))
  ) {
    throw integrationError(
      "route_mismatch",
      "The route target order does not match the envelope's exact mode decisions.",
    );
  }
  return route.target.targetStates.map((target, index) => {
    const decision = envelope.targetModeDecisions[index]!;
    if (decision.learningMode === "learn") {
      return {
        ...target,
        stage: "novice" as const,
        uncertainty: "high" as const,
        evidenceRefs: [...decision.evidenceRefs],
      };
    }
    if (decision.basisCode === "placement_demonstrated") {
      return {
        ...target,
        stage: "developing" as const,
        uncertainty: "medium" as const,
        evidenceRefs: [...decision.evidenceRefs],
      };
    }
    return target;
  });
}

function envelopeEvidenceKind(
  envelope: NormalPlanSessionEnvelope,
  executionEnvironment: StudyRoute["approach"]["executionEnvironment"],
): StudyRoute["execution"]["completionEvidence"][number]["kind"] {
  if (executionEnvironment === "outside_yova") return "artifact";
  if (envelope.taskFamily === "writing_argumentation") return "artifact";
  if (
    envelope.taskFamily === "problem_solving"
    || envelope.taskFamily === "programming"
  ) return "application";
  if (envelope.taskFamily === "mixed_assessment") return "verification";
  return envelope.learningMode === "learn" ? "explanation" : "retrieval";
}

function parseTrace(entry: DeepReadonly<StudyRouteRuleTraceEntry>) {
  return StudyRouteRuleTraceEntrySchema.parse(entry);
}

function routeMode(envelope: NormalPlanSessionEnvelope) {
  return envelope.learningMode === "learn" ? "learn" as const : "practice" as const;
}

function compositeRouterVersion(current: string, duration: string) {
  return StudyRouteProvenanceSchema.shape.routerVersion.parse(unique([
    ...current.split("+"),
    NORMAL_PLAN_ENVELOPE_ROUTE_INTEGRATION_VERSION,
    NORMAL_PLAN_ENVELOPE_COMPOSER_VERSION,
    duration,
  ]).join("+"));
}

function expectedEnvelopeId(sequence: number) {
  return `normal-plan-envelope-${String(sequence).padStart(3, "0")}`;
}

function amountLabel(targetCount: number, evidenceCount: number, minutes: number) {
  return [
    `${targetCount} focused ${targetCount === 1 ? "target" : "targets"}`,
    `${evidenceCount} evidence ${evidenceCount === 1 ? "check" : "checks"}`,
    `about ${minutes} min`,
  ].join(" + ");
}

function sameSessionScalars(
  stored: LearningPlanSession,
  supplied: LearningPlanSession,
) {
  const snapshot = (session: LearningPlanSession) => ({
    id: session.id,
    sequence: session.sequence,
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
    status: session.status,
  });
  return sameJson(snapshot(stored), snapshot(supplied));
}

function sameValues(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameJson(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function unique(values: readonly string[]) {
  return [...new Set(values)];
}

function integrationError(
  code: NormalPlanEnvelopeRouteErrorCode,
  message: string,
) {
  return new NormalPlanEnvelopeRouteIntegrationError(code, message);
}

type Primitive = string | number | boolean | bigint | symbol | null | undefined;
type DeepReadonly<T> = T extends Primitive | ((...args: never[]) => unknown)
  ? T
  : T extends readonly (infer Item)[]
    ? readonly DeepReadonly<Item>[]
    : { readonly [Key in keyof T]: DeepReadonly<T[Key]> };

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
