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

export type LessonBriefContext = {
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
  const assignedIdeaKeys = new Set<string>();
  const ideasByActivity = new Map<number, string[]>();

  // Preserve valid model assignments first, but never let a short teaching
  // block inherit the full session outline. Runtime delivery is generated one
  // activity at a time, so the activity's minutes are its real content budget.
  draft.activities.forEach((activity, index) => {
    if (activity.type !== "instruction" || !activity.lessonBrief) return;
    const capacity = lessonIdeaCapacityForMinutes(activity.estimatedMinutes);
    const proposedIdeas = unique(activity.lessonBrief.essentialIdeas.flatMap((idea) => {
      const key = normalize(idea);
      const coverageIdea = coverageIdeaByKey.get(key);
      return coverageIdea && !assignedIdeaKeys.has(key) ? [coverageIdea] : [];
    })).slice(0, capacity);
    proposedIdeas.forEach((idea) => assignedIdeaKeys.add(normalize(idea)));
    ideasByActivity.set(index, proposedIdeas);
  });

  // Distribute uncovered active ideas across teaching blocks with remaining
  // time. Never cram all of them into the first explanation.
  for (const coverageIdea of draft.coverage.essentialIdeas) {
    const key = normalize(coverageIdea);
    if (assignedIdeaKeys.has(key)) continue;
    const availableIndex = draft.activities.findIndex((activity, index) => (
      activity.type === "instruction"
      && Boolean(activity.lessonBrief)
      && (ideasByActivity.get(index)?.length ?? 0) < lessonIdeaCapacityForMinutes(activity.estimatedMinutes)
    ));
    if (availableIndex < 0) continue;
    ideasByActivity.set(availableIndex, [
      ...(ideasByActivity.get(availableIndex) ?? []),
      coverageIdea,
    ]);
    assignedIdeaKeys.add(key);
  }

  // Pacing is finalized before lesson briefs are enriched. That finalization
  // may shorten the opening teaching block (for example from eight minutes to
  // five) after the model assigned two ideas to it. Reconcile coverage to the
  // teaching time that actually remains: keep only ideas with a real teaching
  // allocation active and explicitly defer the overflow. This is intentionally
  // not a validator relaxation. A raw draft that claims an untaught active idea
  // still fails validateStreamedLessonScope; the authoritative finalizer simply
  // makes its bounded scope honest before runtime delivery begins.
  const unassignedIdeas = draft.coverage.essentialIdeas.filter((idea) => (
    !assignedIdeaKeys.has(normalize(idea))
  ));
  const allDeferredContent = unique([
    ...unassignedIdeas,
    ...draft.coverage.deferredContent,
  ]);
  // The stored schema has four explicit deferred slots. If every displaced
  // idea cannot be named honestly, retain it as active so the strict validator
  // requests a repaired skeleton instead of silently dropping prior scope.
  const canDeferEveryUnassignedIdea = allDeferredContent.length <= 4;
  const activeIdeas = draft.coverage.essentialIdeas.filter((idea) => (
    assignedIdeaKeys.has(normalize(idea)) || !canDeferEveryUnassignedIdea
  ));
  const activeIdeaKeys = new Set(activeIdeas.map(normalize));
  const evidenceMap = draft.coverage.evidenceMap.filter((mapping) => (
    activeIdeaKeys.has(normalize(mapping.essentialIdea))
  ));
  const deferredContent = canDeferEveryUnassignedIdea
    ? allDeferredContent
    : draft.coverage.deferredContent;

  return {
    ...draft,
    coverage: {
      ...draft.coverage,
      essentialIdeas: activeIdeas,
      evidenceMap,
      deferredContent,
    },
    activities: draft.activities.map((activity, index) => {
      if (activity.type !== "instruction" || !activity.lessonBrief) return activity;
      const allocatedIdeas = ideasByActivity.get(index) ?? [];
      return {
        ...activity,
        lessonBrief: buildAuthoritativeLessonBrief({
          proposed: {
            ...activity.lessonBrief,
            essentialIdeas: allocatedIdeas.length > 0
              ? allocatedIdeas
              : [activeIdeas[0]!],
          },
          coverageIdeas: activeIdeas,
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
  const essentialIdeas = unique(proposedIdeas.length ? proposedIdeas : [coverageIdeas[0]!])
    .slice(0, 4);
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

/**
 * A lesson brief is the content contract for one streamed teaching block.
 * These limits deliberately leave time for examples, checks, and learner
 * thinking instead of converting every available minute into exposition.
 */
export function lessonIdeaCapacityForMinutes(minutes: number) {
  if (minutes <= 5) return 1;
  if (minutes <= 10) return 2;
  return 3;
}

/**
 * Enforces the boundary between the whole plan and today's one lesson. Topic
 * ids are authoritative, and active teaching ideas must stay semantically
 * aligned with the targets assigned to this session. Future-session targets
 * may only be deferred.
 */
export function validateStreamedLessonScope(
  draft: StreamedGeneratedSessionDraft,
  context: {
    sessionTopicIds: string[];
    sessionObjective: string;
    sessionContentTargets: string[];
    sessionEstimatedMinutes: number;
    learnerDirection?: string | null;
  },
) {
  const expectedTopicIds = unique(context.sessionTopicIds).sort();
  const returnedTopicIds = unique(draft.topicIds).sort();
  if (expectedTopicIds.join(":") !== returnedTopicIds.join(":")) {
    return `This lesson must use exactly its assigned topic ids. Expected ${expectedTopicIds.join(", ")}; received ${returnedTopicIds.join(", ")}.`;
  }

  const allowedTopicIds = new Set(expectedTopicIds);
  const outOfScopeActivity = draft.activities.find((activity) => (
    activity.topicId !== null && !allowedTopicIds.has(activity.topicId)
  ));
  if (outOfScopeActivity) {
    return `The activity “${outOfScopeActivity.title}” uses a topic outside this session's assigned knowledge-map topics.`;
  }

  const activeIdeaKeys = new Set(draft.coverage.essentialIdeas.map(normalize));
  const incompleteIdea = draft.coverage.essentialIdeas.find((idea) => !isCompleteLessonClaim(idea));
  if (incompleteIdea) {
    return `The active idea “${incompleteIdea}” is only a topic label. Rewrite it as a concise explanatory claim that states what the learner should understand.`;
  }

  const allowedScopeTargets = [
    ...context.sessionContentTargets,
    ...(context.learnerDirection?.trim() ? [context.learnerDirection] : []),
  ];
  if (allowedScopeTargets.length > 0) {
    const unplannedIdea = draft.coverage.essentialIdeas.find((idea) => (
      !allowedScopeTargets.some((target) => lessonIdeaMatchesTarget(idea, target))
    ));
    if (unplannedIdea) {
      return `The active idea “${unplannedIdea}” is outside this session's assigned target: ${context.sessionObjective}. Keep the explanatory claim bounded to the supplied session content targets and move other material to deferredContent.`;
    }
  }

  const taughtIdeaKeys = new Set<string>();
  for (const activity of draft.activities) {
    if (activity.type !== "instruction" || !activity.lessonBrief) continue;
    const outOfScopeBriefTopic = activity.lessonBrief.topicIds.find((topicId) => !allowedTopicIds.has(topicId));
    if (outOfScopeBriefTopic) {
      return `The teaching block “${activity.title}” references a topic outside this session's assigned knowledge-map topics.`;
    }
    const capacity = lessonIdeaCapacityForMinutes(activity.estimatedMinutes);
    if (activity.lessonBrief.essentialIdeas.length > capacity) {
      return `The ${activity.estimatedMinutes}-minute teaching block “${activity.title}” may teach at most ${capacity} ${capacity === 1 ? "essential idea" : "essential ideas"}. Split the instruction or defer the remaining content.`;
    }
    for (const idea of activity.lessonBrief.essentialIdeas) {
      const key = normalize(idea);
      if (!activeIdeaKeys.has(key)) {
        return `The teaching block “${activity.title}” includes “${idea},” which is not one of this session's active ideas.`;
      }
      if (taughtIdeaKeys.has(key)) {
        return `The active idea “${idea}” appears in more than one teaching block. Give each streamed lesson a distinct content assignment instead of repeating material to fill time.`;
      }
      taughtIdeaKeys.add(key);
    }
  }

  const untaughtIdea = draft.coverage.essentialIdeas.find((idea) => !taughtIdeaKeys.has(normalize(idea)));
  if (untaughtIdea) {
    return `The active idea “${untaughtIdea}” has no teaching time in this session. Add a bounded teaching block or move it to deferredContent.`;
  }

  const totalRequiredMinutes = draft.activities
    .filter((activity) => activity.requiredForCompletion)
    .reduce((sum, activity) => sum + activity.estimatedMinutes, 0);
  if (totalRequiredMinutes > context.sessionEstimatedMinutes) {
    return `The required lesson sequence needs ${totalRequiredMinutes} minutes but this session allows ${context.sessionEstimatedMinutes}.`;
  }

  return null;
}

export function isCompleteLessonClaim(value: string) {
  const words = value.match(/[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu) ?? [];
  if (words.length < 5) return false;
  // Longer subject statements are accepted without a brittle subject-specific
  // verb dictionary. The shorter path catches concise claims such as
  // "Inflation erodes purchasing power as prices rise." This intentionally
  // favors reliable generation over attempting English part-of-speech parsing.
  if (words.length >= 7) return true;
  return /\b(?:is|are|was|were|can|could|causes?|caused|connects?|connected|depends?|depended|differentiates?|enables?|enabled|equals?|erodes?|exchanges?|explains?|explained|grows?|grew|helps?|helped|increases?|increased|leads?|led|makes?|made|means?|meant|produces?|produced|provides?|provided|pulls?|pulled|requires?|required|results?|resulted|shapes?|shaped|supports?|supported|transforms?|transformed|triggers?|triggered|turns?|turned|uses?|used|widens?|widened|because|through|when|while)\b/i.test(value);
}

function lessonIdeaMatchesTarget(idea: string, target: string) {
  const ideaKey = normalize(idea);
  const targetKey = normalize(target);
  if (ideaKey === targetKey) return true;

  const ideaTokens = meaningfulScopeTokens(idea);
  const targetTokens = meaningfulScopeTokens(target);
  if (ideaKey.includes(targetKey)) return true;
  const overlap = targetTokens.filter((targetToken) => (
    ideaTokens.some((ideaToken) => scopeTokensMatch(ideaToken, targetToken))
  )).length;
  // Short plan targets are often labels, while a valid lesson idea is a full
  // explanatory sentence. Permit that bounded expansion when the sentence
  // preserves most of the label's subject terms. Keep the length ceiling so a
  // claim cannot name the assigned target and then survey later-session topics.
  const boundedShortTargetRestatement = targetTokens.length <= 5
    && overlap >= Math.ceil(targetTokens.length * 0.75)
    && ideaTokens.length <= targetTokens.length + 10;
  if (
    ideaTokens.length > maximumScopedClaimTokens(targetTokens.length)
    && !boundedShortTargetRestatement
  ) return false;
  const requiredOverlap = Math.min(2, Math.min(ideaTokens.length, targetTokens.length));
  const hasDistinctiveSharedToken = targetTokens.some((targetToken) => (
    targetToken.length >= 7
    && ideaTokens.some((ideaToken) => scopeTokensMatch(ideaToken, targetToken))
  ));
  return requiredOverlap > 0 && (overlap >= requiredOverlap || hasDistinctiveSharedToken);
}

function scopeTokensMatch(left: string, right: string) {
  if (left === right) return true;
  // Handles closely related forms such as Europe/European without a broad
  // synonym table that could weaken the out-of-scope guard.
  return Math.min(left.length, right.length) >= 5
    && (left.startsWith(right) || right.startsWith(left));
}

function maximumScopedClaimTokens(targetTokenCount: number) {
  return Math.max(targetTokenCount + 5, Math.ceil(targetTokenCount * 1.75));
}

function meaningfulScopeTokens(value: string) {
  const ignored = new Set([
    "about", "and", "build", "concept", "explain", "idea", "learn", "lesson",
    "model", "overview", "relationship", "study", "the", "their", "this", "understand", "with",
  ]);
  return unique(normalize(value).split(" ")
    .map((token) => token.length > 4 && token.endsWith("s") ? token.slice(0, -1) : token)
    .filter((token) => token.length > 2 && !ignored.has(token)));
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
