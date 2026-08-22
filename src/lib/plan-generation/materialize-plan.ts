import { makeUuid, type LearningPlan } from "@/lib/domain";
import {
  GeneratedPlanDraftSchema,
  type GeneratedPlanDraft,
  type PlanGenerationRequest,
} from "@/lib/plan-generation/schema";
import { teachingFirstSessionCopy } from "@/lib/learning/learning-intent";
import { resolveLearningTitle, resolveLearningTopic } from "@/lib/intake/interpret";
import { STREAMED_SESSION_ARCHITECTURE } from "@/lib/session-generation/architecture";
import {
  replaceTopicReference,
  resolveKnowledgeMapSubjectBoundary,
} from "@/lib/knowledge-map/subject-boundary";

export function materializePlanDraft(
  untrustedDraft: GeneratedPlanDraft,
  request: PlanGenerationRequest,
  now = new Date(),
): LearningPlan {
  const draft = GeneratedPlanDraftSchema.parse(untrustedDraft);
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

  return {
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
      const estimatedMinutes = request.intent === "study_now"
        ? Math.min(session.estimatedMinutes, request.availability[0]?.minutes ?? session.estimatedMinutes)
        : session.estimatedMinutes;

      const placementCompleted = request.knowledgeMap?.placementCheck.status === "completed";
      const learningMode = index === 0 && !placementCompleted ? request.learningIntent : session.learningMode;
      const repairedTeachingStart = learningMode === "learn" && session.learningMode !== "learn"
        ? teachingFirstSessionCopy(topic)
        : null;

      return {
        id: makeUuid(),
        sequence: index + 1,
        ...session,
        title: repairSubjectCopy(session.title),
        objective: repairSubjectCopy(session.objective),
        ...(repairedTeachingStart ?? {}),
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
}
