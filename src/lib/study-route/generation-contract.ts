import type { KnowledgeMapTopic } from "@/lib/knowledge-map/schema";
import { mapTargetsToKnowledgeTopics } from "@/lib/learning/target-topic-mapping";
import type { GeneratedSessionDraft } from "@/lib/session-generation/schema";
import type { StudyRoute } from "@/lib/study-route/schema";
import { activeStudyRouteTargetIds } from "@/lib/study-route/targets";

export type GeneratedSessionStudyRouteTargetContext = {
  plannedTopicIds: string[];
  plannedContentTargets: string[];
  knowledgeTopics: KnowledgeMapTopic[];
  isDeferredContinuation?: boolean;
};

/**
 * Checks the route-owned semantics that a generated resource can prove
 * deterministically. Prose may vary; method, mode, targets, and phase order
 * may not vary under one immutable revision.
 */
export function generatedSessionStudyRouteIssue(
  session: GeneratedSessionDraft,
  route: StudyRoute | null | undefined,
  targetContext?: GeneratedSessionStudyRouteTargetContext,
): string | null {
  if (!route) return null;
  const expectedLearningMode = route.approach.mode === "learn" ? "learn" : "study";
  if (session.methodBriefing.learningMode !== expectedLearningMode) {
    return "The generated learning mode does not match the committed StudyRoute.";
  }
  if (session.methodBriefing.methodId !== route.approach.primaryMethodId) {
    return "The generated method does not match the committed StudyRoute.";
  }
  if (session.methodBriefing.name !== route.approach.visibleMethodName) {
    return "The generated method name does not match the committed StudyRoute.";
  }

  const expectedTargetIds = activeStudyRouteTargetIds(route);
  const exactRouteTargets = sameOrderedValues(session.topicIds, expectedTargetIds);
  const validScopedTargets = validDeferredTargetSubset({
    session,
    expectedTargetIds,
    targetContext,
  });
  if (
    targetContext?.isDeferredContinuation
      ? !validScopedTargets
      : !exactRouteTargets && !validScopedTargets
  ) {
    return "The generated targets do not match the committed StudyRoute.";
  }

  const expectedPhases = route.execution.orderedPhases.map((phase) => phase.methodPhase);
  const actualPhases = session.activities.map((activity) => activity.methodPhase);
  let matched = 0;
  for (const phase of actualPhases) {
    if (phase === expectedPhases[matched]) matched += 1;
  }
  if (matched !== expectedPhases.length) {
    return "The generated phase order does not match the committed StudyRoute.";
  }

  return null;
}

function sameOrderedValues(left: string[], right: string[]) {
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function isOrderedSubset(values: string[], expected: string[]) {
  let expectedIndex = 0;
  for (const value of values) {
    while (expectedIndex < expected.length && expected[expectedIndex] !== value) {
      expectedIndex += 1;
    }
    if (expectedIndex >= expected.length) return false;
    expectedIndex += 1;
  }
  return true;
}

/**
 * A pacing recipe may teach only part of a committed multi-target route. Keep
 * `topicIds` as the targets actually taught so completion cannot advance a
 * deferred knowledge-map topic. The route contract accepts that subset only
 * when the original target-to-topic mapping proves that every omitted topic's
 * exact planned labels survived in `deferredContent` for continuation.
 */
function validDeferredTargetSubset({
  session,
  expectedTargetIds,
  targetContext,
}: {
  session: GeneratedSessionDraft;
  expectedTargetIds: string[];
  targetContext: GeneratedSessionStudyRouteTargetContext | undefined;
}) {
  if (
    !targetContext
    || session.topicIds.length === 0
    || !isOrderedSubset(session.topicIds, expectedTargetIds)
    || !sameOrderedValues(targetContext.plannedTopicIds, expectedTargetIds)
    || targetContext.plannedContentTargets.length === 0
  ) return false;

  const plannedTopics = expectedTargetIds.flatMap((targetId) => {
    const topic = targetContext.knowledgeTopics.find((candidate) => candidate.id === targetId);
    return topic ? [topic] : [];
  });
  if (plannedTopics.length !== expectedTargetIds.length) return false;
  const mapping = mapTargetsToKnowledgeTopics(
    targetContext.plannedContentTargets,
    plannedTopics,
  );
  if (mapping.issue) return false;

  const mappedTopicIds = new Set(mapping.assignments.map((assignment) => assignment.topic.id));
  const activeTargetIds = targetContext.isDeferredContinuation
    ? expectedTargetIds.filter((targetId) => mappedTopicIds.has(targetId))
    : expectedTargetIds;
  if (
    activeTargetIds.length === 0
    || !isOrderedSubset(session.topicIds, activeTargetIds)
  ) return false;

  const taughtIds = new Set(session.topicIds);
  const deferredLabels = new Set(session.coverage.deferredContent.map(normalizeTarget));
  return activeTargetIds
    .filter((targetId) => !taughtIds.has(targetId))
    .every((targetId) => {
      const labels = mapping.assignments
        .filter((assignment) => assignment.topic.id === targetId)
        .map((assignment) => assignment.target);
      return labels.length > 0
        && labels.every((label) => deferredLabels.has(normalizeTarget(label)));
    });
}

function normalizeTarget(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}
