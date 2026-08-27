import { makeUuid, type LearningPlan } from "@/lib/domain";
import {
  GeneratedPlanDraftSchema,
  type GeneratedPlanDraft,
  type PlanGenerationRequest,
} from "@/lib/plan-generation/schema";
import { contentBudgetForMinutes } from "@/lib/plan-generation/content-budget";
import {
  NORMAL_PLAN_ENVELOPE_COMPOSER_VERSION,
  type NormalPlanEnvelopeComposition,
} from "@/lib/plan-generation/normal-plan-envelopes";
import { teachingFirstSessionCopy } from "@/lib/learning/learning-intent";
import { resolveLearningTitle, resolveLearningTopic } from "@/lib/intake/interpret";
import { STREAMED_SESSION_ARCHITECTURE } from "@/lib/session-generation/architecture";
import {
  replaceTopicReference,
  resolveKnowledgeMapSubjectBoundary,
} from "@/lib/knowledge-map/subject-boundary";
import { legacyPlanSessionToStudyRoute } from "@/lib/study-route/adapters";
import {
  studyRouteToLegacySessionProjection,
} from "@/lib/study-route/adapters";
import {
  integrateStudyNowDurationDecision,
  parseStudyNowDurationDecision,
  type StudyNowDurationDecision,
} from "@/lib/study-route/duration-plan-integration";
import { CORE_METHOD_CATALOG } from "@/lib/learning/method-catalog";
import {
  integrateStudyRouteMethodDecision,
  type StudyRouteMethodDecision,
} from "@/lib/study-route/method-plan-integration";

export type MaterializePlanDraftOptions = {
  readonly studyNowDurationDecision?: StudyNowDurationDecision;
  readonly studyNowMethodDecision?: StudyRouteMethodDecision;
  readonly normalPlanEnvelopeComposition?: NormalPlanEnvelopeComposition;
};

export function materializePlanDraft(
  untrustedDraft: GeneratedPlanDraft,
  request: PlanGenerationRequest,
  now = new Date(),
  options: MaterializePlanDraftOptions = {},
): LearningPlan {
  const draft = GeneratedPlanDraftSchema.parse(untrustedDraft);
  const normalPlanEnvelopeComposition = options.normalPlanEnvelopeComposition
    ? validateNormalPlanEnvelopeCompositionForDraft(
        options.normalPlanEnvelopeComposition,
        draft,
        request,
      )
    : undefined;
  const studyNowDurationDecision = options.studyNowDurationDecision
    ? parseStudyNowDurationDecisionForRequest(options.studyNowDurationDecision, request)
    : undefined;
  const studyNowMethodDecision = options.studyNowMethodDecision
    ? parseStudyNowMethodDecisionForRequest(options.studyNowMethodDecision, request)
    : undefined;
  const planId = makeUuid();
  const topic = resolveLearningTopic(draft.topic, request.goal);
  const title = resolveLearningTitle(draft.title, request.goal || topic);
  const deferredById = new Map(draft.deferredTopics.map((entry) => [entry.topicId, entry.reason]));
  const resolvedKnowledgeMap = request.knowledgeMap
    ? resolveKnowledgeMapSubjectBoundary(request.knowledgeMap, request.goal)
    : undefined;
  const topicRepairs = [
    ...(draft.topic === topic ? [] : [{ original: draft.topic, resolved: topic }]),
    ...(request.knowledgeMap && resolvedKnowledgeMap
      ? request.knowledgeMap.topics.flatMap((mappedTopic, index) => {
          const resolvedTopic = resolvedKnowledgeMap.topics[index]?.title;
          return resolvedTopic && resolvedTopic !== mappedTopic.title
            ? [{ original: mappedTopic.title, resolved: resolvedTopic }]
            : [];
        })
      : []),
  ].sort((left, right) => right.original.length - left.original.length);
  const repairSubjectCopy = (value: string) => topicRepairs.reduce(
    (current, repair) => replaceTopicReference(current, repair.original, repair.resolved),
    value,
  );
  const knowledgeMap = resolvedKnowledgeMap ? {
    ...resolvedKnowledgeMap,
    topics: resolvedKnowledgeMap.topics.map((mappedTopic) => ({
      ...mappedTopic,
      deferred: deferredById.has(mappedTopic.id) ? { reason: deferredById.get(mappedTopic.id)! } : null,
    })),
  } : undefined;
  const demonstratedTopics = resolvedKnowledgeMap?.topics.filter((mappedTopic) => mappedTopic.initialEvidence?.outcome === "demonstrated") ?? [];
  const gapTopics = resolvedKnowledgeMap?.topics.filter((mappedTopic) => mappedTopic.initialEvidence?.outcome === "gap") ?? [];
  const placementSummary = [
    demonstratedTopics.length > 0
      ? `You showed you already know ${demonstratedTopics.map((mappedTopic) => mappedTopic.title).join(", ")}, so ${demonstratedTopics.length === 1 ? "it is" : "they are"} scheduled as a quick check, not a lesson.`
      : "",
    gapTopics.length > 0
      ? `${gapTopics.map((mappedTopic) => mappedTopic.title).join(", ")} ${gapTopics.length === 1 ? "is" : "are"} taught first because the placement check confirmed a gap.`
      : "",
  ].filter(Boolean).join(" ");

  const plan: LearningPlan = {
    id: planId,
    learningItemId: makeUuid(),
    title,
    topic,
    kind: draft.kind,
    deadline: request.intent === "study_now" ? null : request.deadline ?? draft.deadline,
    status: "draft",
    sourceMode: request.materialMode === "upload" ? "user_materials" : "yova_generated",
    studyMode: request.studyMode === "outside" ? "outside_yova" : "inside_yova",
    learningIntent: request.learningIntent,
    creationIntent: request.intent,
    sessionArchitectureVersion: STREAMED_SESSION_ARCHITECTURE,
    rationale: `${placementSummary}${placementSummary ? " " : ""}${draft.rationale}`.slice(0, 1_600),
    createdAt: now.toISOString(),
    knowledgeMap,
    materials: request.materials.map((material) => ({
      ...material,
      textContent: null,
    })),
    sessions: (request.intent === "study_now" ? draft.sessions.slice(0, 1) : draft.sessions).map((session, index) => {
      const estimatedMinutes = studyNowDurationDecision
        ? studyNowDurationDecision.timing.activeMinutes
        : request.intent === "study_now"
        ? Math.min(session.estimatedMinutes, request.availability[0]?.minutes ?? session.estimatedMinutes)
        : session.estimatedMinutes;

      const placementCompleted = request.knowledgeMap?.placementCheck.status === "completed";
      const learningMode = normalPlanEnvelopeComposition
        ? session.learningMode
        : index === 0 && !placementCompleted
          ? request.learningIntent
          : session.learningMode;
      const repairedTeachingStart = !normalPlanEnvelopeComposition
        && learningMode === "learn"
        && session.learningMode !== "learn"
        ? teachingFirstSessionCopy(topic)
        : null;

      return {
        id: makeUuid(),
        sequence: index + 1,
        ...session,
        title: repairSubjectCopy(session.title),
        objective: repairSubjectCopy(session.objective),
        ...(repairedTeachingStart ?? {}),
        ...(studyNowMethodDecision
          ? {
              method: CORE_METHOD_CATALOG[
                studyNowMethodDecision.selection.selectedMethodId
              ].name,
              methodReason: studyNowMethodDecision.selection.learnerFacingReason,
            }
          : {}),
        scheduledFor: request.intent === "study_now" ? now.toISOString() : session.scheduledFor,
        estimatedMinutes,
        amountLabel: request.intent === "study_now" ? `Focused session · about ${estimatedMinutes} min` : session.amountLabel,
        learningMode,
        topicIds: session.topicIds,
        contentTargets: session.contentTargets.map(repairSubjectCopy),
        completionEvidence: session.completionEvidence.map(repairSubjectCopy),
        status: index === 0 ? "ready" as const : "upcoming" as const,
      };
    }),
  };

  return {
    ...plan,
    sessions: plan.sessions.map((session) => {
      // A normal-plan envelope already owns mode, schedule, targets, and
      // duration. Until canonical method routing binds the whole route, do not
      // reconstruct those decisions as legacy facts from provider scaffolding.
      if (normalPlanEnvelopeComposition) return session;
      const studyRoute = legacyPlanSessionToStudyRoute({
        plan,
        session,
        adaptedAt: now.toISOString(),
        identity: {
          routeLineageId: makeUuid(),
          routeRevisionId: makeUuid(),
          lifecycleStatus: "provisional",
          createdAt: now.toISOString(),
        },
      });
      if (!studyRoute) {
        if (studyNowDurationDecision) {
          throw new Error("The resolved Study Now duration could not be bound to a canonical route.");
        }
        return session;
      }
      const durationIntegratedRoute = studyNowDurationDecision
        ? integrateStudyNowDurationDecision({
            creationIntent: plan.creationIntent,
            hardMaximumMinutes: request.availability[0]!.minutes,
            session,
            route: studyRoute,
            decision: studyNowDurationDecision,
          })
        : studyRoute;
      const integratedRoute = studyNowMethodDecision
        ? integrateStudyRouteMethodDecision({
            route: durationIntegratedRoute,
            decision: studyNowMethodDecision,
          })
        : durationIntegratedRoute;
      const projection = studyRouteToLegacySessionProjection(integratedRoute);
      return {
        ...session,
        ...(studyNowMethodDecision ? projection : {}),
        studyRoute: integratedRoute,
      };
    }),
  };
}

function validateNormalPlanEnvelopeCompositionForDraft(
  composition: NormalPlanEnvelopeComposition,
  draft: GeneratedPlanDraft,
  request: PlanGenerationRequest,
) {
  if (request.intent !== "plan") {
    throw new Error("A normal-plan envelope composition cannot be materialized into Study Now.");
  }
  if (
    composition.version !== NORMAL_PLAN_ENVELOPE_COMPOSER_VERSION
    || !Array.isArray(composition.envelopes)
    || composition.envelopes.length === 0
    || composition.envelopes.length !== draft.sessions.length
  ) {
    throw new Error("The normal-plan envelope composition must contain one supported envelope for every draft session.");
  }

  composition.envelopes.forEach((envelope, index) => {
    const session = draft.sessions[index];
    if (!session || envelope.sequence !== index + 1) {
      throw new Error("The normal-plan envelope sequence does not match the generated draft.");
    }
    const expectedBudget = contentBudgetForMinutes(session.estimatedMinutes);
    const expectedEvidenceCount = Math.max(1, Math.min(
      envelope.topicIds.length,
      expectedBudget.maximumCompletionChecks,
    ));
    if (
      session.scheduledFor !== envelope.scheduledFor
      || session.estimatedMinutes !== envelope.timing.activeMinutes
      || session.learningMode !== envelope.learningMode
      || !sameOrderedValues(session.topicIds, envelope.topicIds)
      || session.contentTargets.length !== envelope.topicIds.length
      || session.contentTargets.length > expectedBudget.maximumContentTargets
      || session.completionEvidence.length !== expectedEvidenceCount
      || session.amountLabel !== normalPlanAmountLabel(
        envelope.topicIds.length,
        expectedEvidenceCount,
        session.estimatedMinutes,
      )
      || !sameContentBudget(envelope.contentBudget, expectedBudget)
    ) {
      throw new Error("The generated draft no longer matches its fixed normal-plan envelope composition.");
    }
  });

  return composition;
}

function normalPlanAmountLabel(
  targetCount: number,
  evidenceCount: number,
  minutes: number,
) {
  return [
    `${targetCount} focused ${targetCount === 1 ? "target" : "targets"}`,
    `${evidenceCount} evidence ${evidenceCount === 1 ? "check" : "checks"}`,
    `about ${minutes} min`,
  ].join(" + ");
}

function sameOrderedValues(left: readonly string[], right: readonly string[]) {
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function sameContentBudget(
  left: ReturnType<typeof contentBudgetForMinutes>,
  right: ReturnType<typeof contentBudgetForMinutes>,
) {
  return left.minutes === right.minutes
    && left.preferredContentTargets === right.preferredContentTargets
    && left.maximumContentTargets === right.maximumContentTargets
    && left.maximumCompletionChecks === right.maximumCompletionChecks
    && left.maximumLearnerFacingWords === right.maximumLearnerFacingWords
    && left.guidance === right.guidance;
}

function parseStudyNowDurationDecisionForRequest(
  decision: NonNullable<MaterializePlanDraftOptions["studyNowDurationDecision"]>,
  request: PlanGenerationRequest,
) {
  if (request.intent !== "study_now") {
    throw new Error("A Study Now duration decision cannot be materialized into a normal plan.");
  }
  const hardMaximumMinutes = request.availability[0]?.minutes;
  if (hardMaximumMinutes === undefined) {
    throw new Error("A Study Now duration decision requires an availability maximum.");
  }
  return parseStudyNowDurationDecision(decision, hardMaximumMinutes);
}

function parseStudyNowMethodDecisionForRequest(
  decision: NonNullable<MaterializePlanDraftOptions["studyNowMethodDecision"]>,
  request: PlanGenerationRequest,
) {
  if (request.intent !== "study_now") {
    throw new Error("A Study Now method decision cannot be materialized into a normal plan.");
  }
  return decision;
}
