import type { MaterialExcerpt } from "@/lib/materials/context";
import type { ConceptSignal } from "@/lib/learning/concept-evidence";
import type { KnowledgeMapTopic } from "@/lib/knowledge-map/schema";
import type { LearningTaskType } from "@/lib/learning/method-catalog";
import type { LessonDeliveryInstructions } from "@/lib/personalization/session-delivery-policy";
import {
  LessonBriefSchema,
  type LessonBrief,
  type StreamedGeneratedSessionDraft,
} from "@/lib/session-generation/schema";

type LessonBriefContext = {
  sessionTopicIds: string[];
  materials: MaterialExcerpt[];
  knowledgeTopics: KnowledgeMapTopic[];
  conceptSignals: ConceptSignal[];
  taskType: LearningTaskType;
  deliveryInstructions: LessonDeliveryInstructions;
};

/**
 * Replaces model-supplied evidence and source metadata with server-known data.
 * The model chooses the lesson slice. It cannot invent learner history or cite
 * a chunk that was not retrieved for the current knowledge-map topics.
 */
export function enrichStreamedLessonBriefs(
  draft: StreamedGeneratedSessionDraft,
  context: LessonBriefContext,
): StreamedGeneratedSessionDraft {
  const coverageIdeaByKey = new Map(
    draft.coverage.essentialIdeas.map((idea) => [normalize(idea), idea]),
  );
  const proposedIdeaKeys = new Set(draft.activities.flatMap((activity) => (
    activity.type === "instruction" && activity.lessonBrief
      ? activity.lessonBrief.essentialIdeas
        .map(normalize)
        .filter((idea) => coverageIdeaByKey.has(idea))
      : []
  )));
  const unassignedCoverageIdeas = draft.coverage.essentialIdeas.filter((idea) => (
    !proposedIdeaKeys.has(normalize(idea))
  ));
  const firstTeachingIndex = draft.activities.findIndex((activity) => (
    activity.type === "instruction" && Boolean(activity.lessonBrief)
  ));

  return {
    ...draft,
    activities: draft.activities.map((activity, index) => {
      if (activity.type !== "instruction" || !activity.lessonBrief) return activity;
      return {
        ...activity,
        lessonBrief: buildAuthoritativeLessonBrief({
          proposed: index === firstTeachingIndex && unassignedCoverageIdeas.length > 0
            ? {
              ...activity.lessonBrief,
              essentialIdeas: unique([
                ...activity.lessonBrief.essentialIdeas,
                ...unassignedCoverageIdeas,
              ]).slice(0, 4),
            }
            : activity.lessonBrief,
          coverageIdeas: draft.coverage.essentialIdeas,
          context,
        }),
      };
    }),
  };
}

function buildAuthoritativeLessonBrief({
  proposed,
  coverageIdeas,
  context,
}: {
  proposed: LessonBrief;
  coverageIdeas: string[];
  context: LessonBriefContext;
}): LessonBrief {
  const allowedTopicIds = new Set(context.sessionTopicIds);
  const topicIds = unique(proposed.topicIds.filter((topicId) => allowedTopicIds.has(topicId)));
  const resolvedTopicIds = topicIds.length ? topicIds : context.sessionTopicIds;
  const topicSet = new Set(resolvedTopicIds);
  const allowedIdeas = new Map(coverageIdeas.map((idea) => [normalize(idea), idea]));
  const proposedIdeas = proposed.essentialIdeas.flatMap((idea) => {
    const exact = allowedIdeas.get(normalize(idea));
    return exact ? [exact] : [];
  });
  const essentialIdeas = unique(proposedIdeas.length ? proposedIdeas : coverageIdeas).slice(0, 4);
  const sourceChunks = context.materials.flatMap((material) => {
    if (!material.chunkId || !material.locationLabel || !material.role) return [];
    return [{
      chunkId: material.chunkId,
      materialId: material.materialId ?? null,
      sourceName: material.name,
      locationLabel: material.locationLabel,
      role: material.role,
      text: material.text.slice(0, 6_000),
    }];
  }).slice(0, 6);
  const relevantTopics = context.knowledgeTopics.filter((topic) => topicSet.has(topic.id));
  const relevantSignals = context.conceptSignals.filter((signal) => (
    signal.topicId ? topicSet.has(signal.topicId) : relevantTopics.some((topic) => sameConcept(topic.title, signal.concept))
  ));
  const confirmedGaps = uniqueBy(
    [
      ...relevantTopics.flatMap((topic) => topic.initialEvidence?.outcome === "gap"
        ? [{ topicId: topic.id, concept: topic.title, evidence: "The placement check showed this topic still needs instruction." }]
        : []),
      ...relevantSignals.flatMap((signal) => signal.status === "needs_review"
        ? [{
          topicId: signal.topicId ?? closestTopicId(signal.concept, relevantTopics),
          concept: signal.concept,
          evidence: "A completed knowledge check showed that this concept still needs review.",
        }]
        : []),
    ].filter((item): item is { topicId: string; concept: string; evidence: string } => Boolean(item.topicId)),
    (item) => `${item.topicId}:${normalize(item.concept)}`,
  ).slice(0, 4);
  const secureKnowledge = uniqueBy([
    ...relevantTopics.flatMap((topic) => topic.status === "secure"
      ? [{
        topicId: topic.id,
        concept: topic.title,
        acknowledgement: "Completed evidence currently marks this topic secure. Acknowledge it without reteaching it unless the current task depends on it.",
      }]
      : []),
    ...relevantSignals.flatMap((signal) => signal.status === "showing_strength"
      ? [{
        topicId: signal.topicId ?? closestTopicId(signal.concept, relevantTopics),
        concept: signal.concept,
        acknowledgement: "Repeated completed checks show strength here. Acknowledge it and keep the lesson focused on remaining gaps.",
      }]
      : []),
  ].filter((item): item is { topicId: string; concept: string; acknowledgement: string } => Boolean(item.topicId)), (item) => `${item.topicId}:${normalize(item.concept)}`).slice(0, 4);
  const priorMisconceptions = uniqueBy(relevantSignals.flatMap((signal) => (
    signal.status === "needs_review" && signal.misconceptionSummary
      ? [{
        topicId: signal.topicId ?? closestTopicId(signal.concept, relevantTopics),
        concept: signal.concept,
        misconception: signal.misconceptionSummary,
      }]
      : []
  )).filter((item): item is { topicId: string; concept: string; misconception: string } => Boolean(item.topicId)), (item) => `${item.topicId}:${normalize(item.concept)}`).slice(0, 3);

  return LessonBriefSchema.parse({
    version: 1,
    topicIds: resolvedTopicIds,
    essentialIdeas,
    sourceChunks,
    knowledgeSource: knowledgeSource(sourceChunks),
    evidenceContext: {
      confirmedGaps,
      secureKnowledge,
      priorMisconceptions,
    },
    contentRequirements: {
      teachEveryEssentialIdea: true,
      includeConcreteExample: context.deliveryInstructions.contentRequirements.includeConcreteWorkedExample
        || context.taskType === "conceptual_learning",
      includeCommonMixup: true,
      preservePrerequisiteOrder: true,
    },
  });
}

function knowledgeSource(sourceChunks: LessonBrief["sourceChunks"]): LessonBrief["knowledgeSource"] {
  if (sourceChunks.length === 0) return "model_knowledge";
  const roles = new Set(sourceChunks.map((chunk) => chunk.role));
  if (roles.size > 1) return "mixed_material_and_model";
  return roles.has("scope_outline") ? "scope_defined_model_instruction" : "material_content";
}

function closestTopicId(concept: string, topics: KnowledgeMapTopic[]) {
  return topics.find((topic) => sameConcept(topic.title, concept))?.id ?? topics[0]?.id ?? "";
}

function sameConcept(left: string, right: string) {
  const a = normalize(left);
  const b = normalize(right);
  return a === b || a.includes(b) || b.includes(a);
}

function normalize(value: string) {
  return value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function unique(values: string[]) {
  return [...new Set(values)];
}

function uniqueBy<T>(values: T[], key: (value: T) => string) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const candidate = key(value);
    if (seen.has(candidate)) return false;
    seen.add(candidate);
    return true;
  });
}
