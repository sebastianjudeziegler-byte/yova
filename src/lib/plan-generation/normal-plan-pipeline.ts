import type { LearningPlan, LearningPlanSession } from "@/lib/domain";
import { LEARNING_TASK_TYPES } from "@/lib/learning/method-catalog";
import { classifyLearningTask } from "@/lib/learning/method-router";
import {
  canonicalizePlanAvailabilitySlots,
  enumeratePlanAvailabilitySlots,
} from "@/lib/plan-generation/availability-slots";
import { contentBudgetForMinutes } from "@/lib/plan-generation/content-budget";
import {
  INITIAL_PLAN_MODE_ROUTING_VERSION,
  resolveInitialPlanSessionModes,
} from "@/lib/plan-generation/initial-session-mode";
import { materializePlanDraft } from "@/lib/plan-generation/materialize-plan";
import {
  NORMAL_PLAN_DEFERRAL_REASON_CODES,
  NORMAL_PLAN_ENVELOPE_COMPOSER_VERSION,
  type NormalPlanEnvelopeComposition,
  type NormalPlanSessionEnvelope,
} from "@/lib/plan-generation/normal-plan-envelopes";
import {
  assertNormalPlanMethodScaffoldReplaced,
  bindNormalPlanProviderFill,
} from "@/lib/plan-generation/normal-plan-provider-fill";
import {
  GeneratedLearningPlanSchema,
  MAX_GENERATED_PLAN_SESSIONS,
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
import {
  NORMAL_PLAN_ENVELOPE_ROUTE_INTEGRATION_VERSION,
  integrateNormalPlanEnvelopeRoute,
} from "@/lib/study-route/normal-plan-envelope-integration";
import { NORMAL_DURATION_RECOMMENDER_VERSION } from "@/lib/study-route/duration-recommendation";
import { StudyRouteSchema } from "@/lib/study-route/schema";

export const NORMAL_PLAN_PIPELINE_VERSION = "normal_plan_pipeline_v1" as const;

export type NormalPlanPipelineInput = Readonly<{
  request: PlanGenerationRequest;
  composition: NormalPlanEnvelopeComposition;
  fill: unknown;
  now: Date;
  methodContext: InitialPlanMethodRoutingContext;
}>;

type AcceptedNormalPlanRequest = PlanGenerationRequest & {
  knowledgeMap: NonNullable<PlanGenerationRequest["knowledgeMap"]>;
};

const CAPACITY_DEFERRAL_CODES = new Set([
  "session_cap",
  "deadline_capacity",
  "availability_capacity",
]);
const DEFERRAL_REASON_CODES = new Set<string>(NORMAL_PLAN_DEFERRAL_REASON_CODES);
const TASK_FAMILIES = new Set<string>(LEARNING_TASK_TYPES);
const ENVELOPE_KINDS = new Set([
  "initial_coverage",
  "required_practice",
  "additional_practice",
]);

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
  });

  assertNormalPlanMethodScaffoldReplaced(scaffoldAssertionProjection(routed));
  const validated = validateFinalPlan({
    plan: routed,
    request,
    composition: input.composition,
    methodProfileVersion: input.methodContext.profileVersion,
  });
  return deepFreeze(validated);
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
}: {
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

  const scope = request.knowledgeMap.scopeJudgment;
  const maximumSessions = Math.min(scope.maximumSessions, MAX_GENERATED_PLAN_SESSIONS);
  if (
    composition.envelopes.length < scope.minimumSessions
    || composition.envelopes.length > maximumSessions
  ) {
    throw pipelineError("The envelope count no longer matches the accepted scope limits.");
  }
  const expectedStatus = composition.deferrals.some((deferral) => (
    CAPACITY_DEFERRAL_CODES.has(deferral.reasonCode)
  )) ? "partial" : "complete";
  if (composition.status !== expectedStatus) {
    throw pipelineError("The composition status no longer matches its explicit deferrals.");
  }

  const topicsById = new Map(request.knowledgeMap.topics.map((topic) => [topic.id, topic]));
  const expectedModes = resolveInitialPlanSessionModes({
    learningIntentRecommendation: {
      intent: request.learningIntent,
      basis: "The accepted request fixes the starting Learn or Practice recommendation.",
    },
    knowledgeMap: request.knowledgeMap,
    sessions: composition.envelopes.map((envelope) => ({
      key: envelope.envelopeId,
      topicIds: envelope.topicIds,
    })),
  });
  const initialTargetIds = new Set<string>();
  const scheduledTargetIds = new Set<string>();
  let leftInitialCoverage = false;

  composition.envelopes.forEach((envelope: NormalPlanSessionEnvelope, index: number) => {
    const expectedMode = expectedModes[index];
    const firstTopic = topicsById.get(envelope.topicIds[0] ?? "");
    if (
      envelope.envelopeId !== expectedEnvelopeId(index + 1)
      || envelope.sequence !== index + 1
      || !ENVELOPE_KINDS.has(envelope.kind)
      || envelope.topicIds.length < 1
      || envelope.topicIds.length > 6
      || new Set(envelope.topicIds).size !== envelope.topicIds.length
      || envelope.topicIds.some((topicId: string) => !topicsById.has(topicId))
      || !firstTopic
      || !expectedMode
    ) {
      throw pipelineError("An envelope identity, kind, target set, or sequence is invalid.");
    }
    if (envelope.kind !== "initial_coverage") leftInitialCoverage = true;
    if (leftInitialCoverage && envelope.kind === "initial_coverage") {
      throw pipelineError("Initial target coverage cannot resume after practice has begun.");
    }
    if (envelope.kind === "initial_coverage") {
      for (const topicId of envelope.topicIds) {
        if (initialTargetIds.has(topicId)) {
          throw pipelineError("Each scheduled target must have exactly one initial-coverage envelope.");
        }
        initialTargetIds.add(topicId);
      }
    } else {
      if (envelope.learningMode !== "study") {
        throw pipelineError("Required and additional practice envelopes must remain Practice sessions.");
      }
      if (envelope.topicIds.some((topicId: string) => !initialTargetIds.has(topicId))) {
        throw pipelineError("A practice envelope cannot precede the target's initial coverage.");
      }
    }
    envelope.topicIds.forEach((topicId: string) => scheduledTargetIds.add(topicId));

    if (
      envelope.learningMode !== expectedMode.learningMode
      || envelope.modeBasisCode !== expectedMode.basisCode
      || !sameJson(envelope.targetModeDecisions, expectedMode.targetDecisions)
    ) {
      throw pipelineError("The envelope's Learn or Practice decision no longer matches accepted evidence.");
    }
    const expectedModeTrace = expectedMode.ruleTrace[0]!;
    const storedModeTrace = envelope.modeRuleTrace.find((entry) => (
      entry.ruleId === INITIAL_PLAN_MODE_ROUTING_VERSION
    ));
    if (
      !storedModeTrace
      || storedModeTrace.result !== expectedModeTrace.result
      || !sameValues(storedModeTrace.evidenceRefs, expectedModeTrace.evidenceRefs)
    ) {
      throw pipelineError("The envelope lost the rule trace for its code-owned mode decision.");
    }

    const expectedClassification = classifyLearningTask(authoritativeTaskText(request, firstTopic));
    const groupedTaskFamilies = envelope.topicIds.map((topicId: string) => (
      classifyLearningTask(authoritativeTaskText(request, topicsById.get(topicId)!)).taskType
    ));
    if (
      !TASK_FAMILIES.has(envelope.taskFamily)
      || groupedTaskFamilies.some((taskFamily: string) => taskFamily !== expectedClassification.taskType)
      || envelope.taskFamily !== expectedClassification.taskType
      || !sameJson(envelope.taskClassification, expectedClassification)
    ) {
      throw pipelineError("The envelope task family no longer matches the request and accepted map.");
    }

    const expectedBudget = contentBudgetForMinutes(envelope.timing.activeMinutes);
    if (
      envelope.durationRouterVersion !== NORMAL_DURATION_RECOMMENDER_VERSION
      || envelope.hardMaximumMinutes !== envelope.timing.hardMaximumMinutes
      || envelope.timing.activeMinutes > envelope.hardMaximumMinutes
      || !sameJson(envelope.contentBudget, expectedBudget)
    ) {
      throw pipelineError("The envelope duration and content budget are inconsistent.");
    }

    const expectedPrerequisiteRefs = unique<string>(envelope.topicIds.flatMap((topicId: string) => (
      topicsById.get(topicId)!.prerequisiteTopicIds.flatMap((prerequisiteId: string) => (
        prerequisiteEvidenceRefs(topicsById.get(prerequisiteId))
      ))
    )));
    if (!sameValues(envelope.prerequisiteEvidenceRefs, expectedPrerequisiteRefs)) {
      throw pipelineError("The envelope prerequisite evidence no longer matches the accepted map.");
    }
  });

  validateDeferrals({
    request,
    composition,
    topicsById,
    scheduledTargetIds,
    initialTargetIds,
  });
  validateCoveragePolicy({ request, composition, initialTargetIds });
  validateAvailabilityAllocation({ request, composition, now });
}

function validateDeferrals({
  request,
  composition,
  topicsById,
  scheduledTargetIds,
  initialTargetIds,
}: {
  request: AcceptedNormalPlanRequest;
  composition: NormalPlanEnvelopeComposition;
  topicsById: ReadonlyMap<string, AcceptedNormalPlanRequest["knowledgeMap"]["topics"][number]>;
  scheduledTargetIds: ReadonlySet<string>;
  initialTargetIds: ReadonlySet<string>;
}) {
  const deferredIds = new Set<string>();
  for (const deferral of composition.deferrals) {
    const topic = topicsById.get(deferral.topicId);
    const blockedPrerequisiteIds = topic
      ? topic.prerequisiteTopicIds.filter((prerequisiteId) => (
          !scheduledTargetIds.has(prerequisiteId)
          && prerequisiteEvidenceRefs(topicsById.get(prerequisiteId)).length === 0
        ))
      : [];
    const isPrerequisiteDeferral = deferral.reasonCode === "prerequisite_deferred";
    const expectedPrerequisiteIds = isPrerequisiteDeferral
      ? blockedPrerequisiteIds
      : [];
    const reasonMatchesBlockedPrerequisites = isPrerequisiteDeferral
      ? blockedPrerequisiteIds.length > 0
      : deferral.reasonCode === "accepted_map_deferral"
        || blockedPrerequisiteIds.length === 0;
    if (
      !topic
      || deferredIds.has(deferral.topicId)
      || scheduledTargetIds.has(deferral.topicId)
      || !DEFERRAL_REASON_CODES.has(deferral.reasonCode)
      || !sameValues(deferral.prerequisiteTopicIds, expectedPrerequisiteIds)
      || !reasonMatchesBlockedPrerequisites
      || (topic.deferred !== null) !== (deferral.reasonCode === "accepted_map_deferral")
    ) {
      throw pipelineError("A composition deferral no longer matches one unscheduled accepted target.");
    }
    deferredIds.add(deferral.topicId);
  }
  if (request.knowledgeMap.topics.some((topic) => (
    initialTargetIds.has(topic.id) === deferredIds.has(topic.id)
  ))) {
    throw pipelineError("Every accepted target must be covered once or explicitly deferred, but never both.");
  }
}

function validateCoveragePolicy({
  request,
  composition,
  initialTargetIds,
}: {
  request: AcceptedNormalPlanRequest;
  composition: NormalPlanEnvelopeComposition;
  initialTargetIds: ReadonlySet<string>;
}) {
  const initialEnvelopes = composition.envelopes.filter((envelope) => (
    envelope.kind === "initial_coverage"
  ));
  const learnTargetCount = initialEnvelopes.reduce((count, envelope) => (
    count + envelope.targetModeDecisions.filter((target) => target.learningMode === "learn").length
  ), 0);
  const minimumTeaching = Math.min(
    request.knowledgeMap.scopeJudgment.minimumTeachingSessions,
    learnTargetCount,
  );
  if (initialEnvelopes.filter((envelope) => envelope.learningMode === "learn").length < minimumTeaching) {
    throw pipelineError("The composition no longer satisfies the accepted teaching minimum.");
  }
  if (initialTargetIds.size === 0) {
    throw pipelineError("A runnable normal plan requires at least one initially covered target.");
  }
  if (request.knowledgeMap.scopeJudgment.maximumSessions > 1) {
    for (const envelope of initialEnvelopes.filter((candidate) => (
      candidate.learningMode === "learn"
    ))) {
      for (const topicId of envelope.topicIds) {
        if (!composition.envelopes.some((candidate) => (
          candidate.sequence > envelope.sequence
          && candidate.learningMode === "study"
          && candidate.topicIds.includes(topicId)
        ))) {
          throw pipelineError("Every taught target requires a later Practice envelope.");
        }
      }
    }
  }
}

function validateAvailabilityAllocation({
  request,
  composition,
  now,
}: {
  request: AcceptedNormalPlanRequest;
  composition: NormalPlanEnvelopeComposition;
  now: Date;
}) {
  const searchDays = Math.max(...composition.envelopes.map((envelope) => (
    envelope.availabilityDayIndex + 1
  )));
  if (!Number.isInteger(searchDays) || searchDays < 1 || searchDays > 366) {
    throw pipelineError("The envelope availability horizon is invalid.");
  }
  const slots = canonicalizePlanAvailabilitySlots(
    enumeratePlanAvailabilitySlots(request, now, searchDays),
    now,
  );
  let slotIndex = 0;
  let usedMinutes = 0;

  for (const envelope of composition.envelopes) {
    while (
      slotIndex < slots.length
      && slots[slotIndex]!.startsAt !== envelope.availabilityStartsAt
    ) {
      const skipped = slots[slotIndex]!;
      if (
        Date.parse(skipped.startsAt) > Date.parse(envelope.availabilityStartsAt)
        || skipped.minutes - usedMinutes >= 10
      ) {
        throw pipelineError("The composition skipped usable availability or moved backwards in time.");
      }
      slotIndex += 1;
      usedMinutes = 0;
    }
    const slot = slots[slotIndex];
    if (!slot) {
      throw pipelineError("An envelope is not scheduled inside the learner's canonical availability.");
    }
    const expectedScheduledFor = new Date(
      Date.parse(slot.startsAt) + usedMinutes * 60_000,
    ).toISOString();
    const expectedHardMaximum = slot.minutes - usedMinutes;
    if (
      envelope.availabilityDayIndex !== slot.dayIndex
      || envelope.availabilityWindowIndex !== slot.windowIndex
      || envelope.scheduledFor !== expectedScheduledFor
      || envelope.hardMaximumMinutes !== expectedHardMaximum
      || envelope.timing.activeMinutes > expectedHardMaximum
      || Date.parse(envelope.scheduledFor) + envelope.timing.activeMinutes * 60_000
        > Date.parse(slot.endsAt)
    ) {
      throw pipelineError("An envelope schedule or hard maximum no longer matches canonical availability.");
    }
    usedMinutes += envelope.timing.activeMinutes;
  }
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
    const routerVersions = route.provenance.routerVersion.split("+");
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
      || !routerVersions.includes(NORMAL_PLAN_ENVELOPE_ROUTE_INTEGRATION_VERSION)
      || !routerVersions.includes(NORMAL_PLAN_ENVELOPE_COMPOSER_VERSION)
      || !routerVersions.includes(envelope.durationRouterVersion)
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

function authoritativeTaskText(
  request: Pick<PlanGenerationRequest, "goal" | "startingContext">,
  topic: AcceptedNormalPlanRequest["knowledgeMap"]["topics"][number],
) {
  return [
    request.goal,
    request.startingContext ?? "",
    topic.title,
    topic.description,
    ...topic.subtopics,
  ].join(" ");
}

function prerequisiteEvidenceRefs(
  topic: AcceptedNormalPlanRequest["knowledgeMap"]["topics"][number] | undefined,
) {
  if (!topic) return [];
  // Current placement evidence wins over a stale recorded status. A topic
  // marked evidenced before a later gap still blocks an unscheduled dependent.
  if (topic.initialEvidence?.outcome === "gap") return [];
  if (topic.initialEvidence?.outcome === "demonstrated") {
    return [`placement:${topic.id}:${topic.initialEvidence.observedAt}`];
  }
  if (topic.status === "evidenced" || topic.status === "secure") {
    return [`knowledge-map-topic:${topic.id}:status:${topic.status}`];
  }
  return [];
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

function unique<T>(values: readonly T[]) {
  return [...new Set(values)];
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
