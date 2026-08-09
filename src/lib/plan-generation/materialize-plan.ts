import { makeUuid, type LearningPlan } from "@/lib/domain";
import {
  GeneratedPlanDraftSchema,
  type GeneratedPlanDraft,
  type PlanGenerationRequest,
} from "@/lib/plan-generation/schema";
import { teachingFirstSessionCopy } from "@/lib/learning/learning-intent";
import { resolveLearningTitle } from "@/lib/intake/interpret";

export function materializePlanDraft(
  untrustedDraft: GeneratedPlanDraft,
  request: PlanGenerationRequest,
): LearningPlan {
  const draft = GeneratedPlanDraftSchema.parse(untrustedDraft);
  const planId = makeUuid();
  const topic = /^(the goal and concepts described by the learner|learning topic|general topic)$/i.test(draft.topic.trim())
    ? request.goal.trim().slice(0, 300)
    : draft.topic;
  const title = resolveLearningTitle(draft.title, request.goal || topic);
  const deferredById = new Map(draft.deferredTopics.map((entry) => [entry.topicId, entry.reason]));
  const knowledgeMap = request.knowledgeMap ? {
    ...request.knowledgeMap,
    topics: request.knowledgeMap.topics.map((mappedTopic) => ({
      ...mappedTopic,
      deferred: deferredById.has(mappedTopic.id) ? { reason: deferredById.get(mappedTopic.id)! } : null,
    })),
  } : undefined;
  const demonstratedTopics = request.knowledgeMap?.topics.filter((mappedTopic) => mappedTopic.initialEvidence?.outcome === "demonstrated") ?? [];
  const gapTopics = request.knowledgeMap?.topics.filter((mappedTopic) => mappedTopic.initialEvidence?.outcome === "gap") ?? [];
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
    rationale: `${placementSummary}${placementSummary ? " " : ""}${draft.rationale}`.slice(0, 1_600),
    createdAt: new Date().toISOString(),
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
        ...(repairedTeachingStart ?? {}),
        scheduledFor: request.intent === "study_now" ? new Date().toISOString() : session.scheduledFor,
        estimatedMinutes,
        amountLabel: request.intent === "study_now" ? `Focused session · about ${estimatedMinutes} min` : session.amountLabel,
        learningMode,
        topicIds: session.topicIds,
        contentTargets: session.contentTargets,
        completionEvidence: session.completionEvidence,
        status: index === 0 ? "ready" as const : "upcoming" as const,
      };
    }),
  };
}
