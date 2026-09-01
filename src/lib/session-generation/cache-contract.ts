import type {
  LearningPlan,
  LearningPlanSession,
  SessionAdjustmentSnapshot,
  SessionResource,
} from "@/lib/domain";
import type { KnowledgeMapTopic } from "@/lib/knowledge-map/schema";
import {
  resolveEffectiveSessionLearningMode,
} from "@/lib/learning/learning-intent";
import { isDeferredSessionContinuation } from "@/lib/learning/session-continuation";
import {
  learningModeForScheduledRetrieval,
  legacyScheduledRetrievalTopic,
} from "@/lib/learning/scheduled-retrieval";
import { mapTargetsToKnowledgeTopics } from "@/lib/learning/target-topic-mapping";
import { cachedSessionActivityContractIssue } from "@/lib/session-generation/cache-activity-contract";
import {
  sessionArchitectureForGeneration,
  STREAMED_SESSION_ARCHITECTURE,
  type SessionArchitectureVersion,
} from "@/lib/session-generation/architecture";
import type { GeneratedSessionDraft } from "@/lib/session-generation/schema";
import { stableFingerprint } from "@/lib/stable-fingerprint";

export type SessionCacheContractInput = {
  reviewType: LearningPlanSession["reviewType"] | null;
  reviewConcept: string | null;
  title: string;
  methodReason: string;
  topicIds: string[];
  contentTargets: string[];
  completionEvidence: string[];
  knowledgeTopics: KnowledgeMapTopic[];
};

/**
 * Canonical, privacy-safe cache contract. The server persists only hashes of
 * this value; the same pure builder also lets the browser decide whether a
 * hydrated resource is current enough to open without a server round trip.
 */
export function sessionCacheContractKey({
  reviewType,
  reviewConcept,
  title,
  methodReason,
  topicIds,
  contentTargets,
  completionEvidence,
  knowledgeTopics,
}: SessionCacheContractInput) {
  const topicProvenance = topicIds.flatMap((topicId) => {
    const topic = knowledgeTopics.find((candidate) => candidate.id === topicId);
    if (!topic) return [];
    return [{
      topicId,
      topicTitle: topic.title,
      topicDescription: topic.description,
      subtopics: topic.subtopics,
      origin: topic.origin,
      provenance: topic.sourceReferences.length > 0
        ? "mapped_material" as const
        : "model_knowledge" as const,
      allowedChunkIds: [...new Set(topic.sourceReferences.map((reference) => reference.chunkId))],
    }];
  });
  const targetMapping = contentTargets.length > 0
    ? mapTargetsToKnowledgeTopics(contentTargets, knowledgeTopics)
    : { assignments: [], issue: null };
  const targetTopicAssignments = targetMapping.issue
    ? { issue: targetMapping.issue }
    : {
      assignments: targetMapping.assignments.map(({ target, targetIndex, topic }) => ({
        targetIndex,
        target,
        topicId: topic.id,
      })),
    };
  if (reviewType) {
    return JSON.stringify({
      contract: "scheduled_review_v1",
      reviewType,
      reviewConcept: reviewConcept?.trim() || null,
      topicIds,
      contentTargets,
      completionEvidence,
      topicProvenance,
      targetTopicAssignments,
    });
  }
  const hasMappedMaterial = topicProvenance.some((topic) => topic.provenance === "mapped_material");
  const hasModelKnowledge = topicProvenance.some((topic) => topic.provenance === "model_knowledge");
  if (isDeferredSessionContinuation({ title, methodReason })) {
    return JSON.stringify({
      contract: "deferred_continuation_v1",
      topicIds,
      contentTargets,
      completionEvidence,
      topicProvenance,
      targetTopicAssignments,
    });
  }
  if (!hasMappedMaterial || !hasModelKnowledge) return null;
  return JSON.stringify({
    contract: "mixed_provenance_v1",
    topicProvenance,
    contentTargets,
    completionEvidence,
    targetTopicAssignments,
  });
}

export function expectedSessionCacheVersion({
  sessionArchitectureVersion,
  learningMode,
  studyMode,
  reviewType,
}: {
  sessionArchitectureVersion: SessionArchitectureVersion;
  learningMode: "learn" | "study";
  studyMode: string;
  reviewType: LearningPlanSession["reviewType"] | null;
}): 15 | 17 {
  return sessionArchitectureVersion === STREAMED_SESSION_ARCHITECTURE
    && learningMode === "learn"
    && studyMode === "inside_yova"
    && !reviewType
    ? 17
    : 15;
}

export function sessionCacheScopeFingerprint({
  plannedMinutes,
  adjustment,
  contractKey,
  routeRevisionId,
}: {
  plannedMinutes: number;
  adjustment: SessionAdjustmentSnapshot | null | undefined;
  contractKey: string | null | undefined;
  routeRevisionId?: string | null;
}) {
  const effectiveMinutes = adjustment?.availableMinutes ?? plannedMinutes;
  const canonicalAdjustment = adjustment
    ? {
      familiarity: adjustment.familiarity,
      availableMinutes: effectiveMinutes,
      knownTargets: [...adjustment.knownTargets].map((target) => target.trim()).sort(),
      note: adjustment.note.trim(),
    }
    : {
      familiarity: "as_planned",
      availableMinutes: effectiveMinutes,
      knownTargets: [],
      note: "",
    };
  return stableFingerprint({
    contract: "session_cache_scope_v1",
    adjustment: canonicalAdjustment,
    contractKey: contractKey ?? null,
    routeRevisionId: routeRevisionId ?? null,
  }, "sc1");
}

/**
 * A hydrated generated lesson may bypass `/api/sessions/generate`, so it must
 * independently satisfy the same activity and high-risk scope contracts as
 * the route cache fast path. Returning an issue forces the normal POST path.
 */
export function hydratedSessionResourceCacheIssue({
  plan,
  session,
  adjustment,
}: {
  plan: LearningPlan;
  session: LearningPlanSession;
  adjustment: SessionAdjustmentSnapshot | null | undefined;
}): string | null {
  const resource = session.resource;
  if (!resource) return null;
  const routeIssue = hydratedSessionResourceRouteIssue(session, resource);
  if (routeIssue) return routeIssue;
  if (resource.origin !== "generated") return null;
  const committedStudyRoute = session.studyRoute?.identity.lifecycleStatus === "committed"
    ? session.studyRoute
    : null;
  const plannedLearningMode = committedStudyRoute
    ? committedStudyRoute.approach.mode === "learn" ? "learn" : "study"
    : session.learningMode;
  const effectiveLearningMode = learningModeForScheduledRetrieval(
    session,
    resolveEffectiveSessionLearningMode({
      planLearningIntent: plan.learningIntent,
      plannedMode: plannedLearningMode,
      completedSessionCount: plan.sessions.filter((candidate) => candidate.status === "complete").length,
      familiarity: adjustment?.familiarity ?? null,
    }),
  );
  const executionEnvironment = committedStudyRoute?.approach.executionEnvironment ?? plan.studyMode;
  const sessionArchitectureVersion = sessionArchitectureForGeneration({
    storedVersion: plan.sessionArchitectureVersion,
    learningMode: effectiveLearningMode,
    studyMode: executionEnvironment,
    reviewType: session.reviewType ?? null,
    selectedMethodId: committedStudyRoute?.approach.primaryMethodId,
  });
  const expectedSchemaVersion = expectedSessionCacheVersion({
    sessionArchitectureVersion,
    learningMode: effectiveLearningMode,
    studyMode: executionEnvironment,
    reviewType: session.reviewType ?? null,
  });
  if (
    resource.schemaVersion !== expectedSchemaVersion
    || resource.methodBriefing?.learningMode !== effectiveLearningMode
  ) {
    return "The saved lesson predates the current guided-session architecture.";
  }
  const activityDraft = resourceActivityContractDraft(resource);
  if (!activityDraft) {
    return "The saved generated lesson predates the current activity contract.";
  }
  const activityIssue = cachedSessionActivityContractIssue(activityDraft, {
    reviewType: session.reviewType ?? null,
    reviewConcept: session.reviewConcept ?? null,
    estimatedMinutes: session.estimatedMinutes,
    executionEnvironment,
  });
  if (activityIssue) return activityIssue;

  const topicResolution = selectedTopicsForCacheContract(plan, session);
  if (topicResolution.issue) return topicResolution.issue;
  const contractKey = sessionCacheContractKey({
    reviewType: session.reviewType ?? null,
    reviewConcept: session.reviewConcept ?? null,
    title: session.title,
    methodReason: session.methodReason,
    topicIds: topicResolution.topics.map((topic) => topic.id),
    contentTargets: session.contentTargets ?? [],
    completionEvidence: session.completionEvidence ?? [],
    knowledgeTopics: topicResolution.topics,
  });
  const expectedScopeFingerprint = sessionCacheScopeFingerprint({
    plannedMinutes: session.estimatedMinutes,
    adjustment,
    contractKey,
    routeRevisionId: session.studyRoute?.identity.routeRevisionId,
  });
  const cacheContext = resource.cacheContext;

  // Scheduled reviews, mixed-source lessons, and deferred continuations have
  // source/scope rules that old caches never proved. They always need both the
  // server SHA marker and today's exact browser-comparable scope token.
  if (contractKey) {
    return cacheContext?.contractFingerprint
      && cacheContext.scopeFingerprint === expectedScopeFingerprint
      ? null
      : "The saved lesson predates the current source or continuation contract.";
  }

  // A cache that already carries request metadata must match the default (or
  // checkpoint) adjustment exactly. Truly old ordinary caches without any
  // context remain usable only after passing the activity contract above.
  if (cacheContext) {
    return cacheContext.scopeFingerprint === expectedScopeFingerprint
      ? null
      : "The saved lesson was prepared for a different session setup.";
  }
  return null;
}

/**
 * Browser hydration is a cache-read boundary in its own right. A generated or
 * built-in resource may open without reaching the server, so it must prove
 * that the exact committed route authorized it before any origin-specific
 * compatibility checks run. Route-free legacy sessions remain compatible
 * only with route-free legacy resources.
 */
function hydratedSessionResourceRouteIssue(
  session: LearningPlanSession,
  resource: SessionResource,
): string | null {
  if (
    session.studyRoute
    && session.studyRoute.identity.lifecycleStatus !== "committed"
  ) {
    return "The saved lesson is not bound to a committed study route.";
  }
  const expectedRouteRevisionId = session.studyRoute?.identity.lifecycleStatus === "committed"
    ? session.studyRoute.identity.routeRevisionId
    : undefined;
  const resourceRouteRevisionId = resource.routeRevisionId;
  const contextRouteRevisionId = resource.cacheContext?.routeRevisionId;

  if (expectedRouteRevisionId === undefined) {
    return resourceRouteRevisionId === undefined && contextRouteRevisionId === undefined
      ? null
      : "The saved lesson belongs to a different study route.";
  }
  if (resourceRouteRevisionId !== expectedRouteRevisionId) {
    return "The saved lesson predates or belongs to a different study route.";
  }
  if (resource.cacheContext && contextRouteRevisionId !== expectedRouteRevisionId) {
    return "The saved lesson cache belongs to a different study route.";
  }
  if (
    resource.methodBriefing
    && (
      resource.methodBriefing.methodId !== session.studyRoute?.approach.primaryMethodId
      || resource.methodBriefing.name !== session.studyRoute.approach.visibleMethodName
    )
  ) {
    return "The saved lesson method does not match the committed study route.";
  }
  return null;
}

function resourceActivityContractDraft(resource: SessionResource) {
  if (
    !resource.methodBriefing
    || resource.activities.some((activity) => (
      activity.methodPhase === undefined
      || activity.estimatedMinutes === undefined
      || activity.requiredForCompletion === undefined
    ))
  ) return null;
  return {
    methodBriefing: resource.methodBriefing,
    activities: resource.activities,
  } as GeneratedSessionDraft;
}

function selectedTopicsForCacheContract(
  plan: LearningPlan,
  session: LearningPlanSession,
): { topics: KnowledgeMapTopic[]; issue: string | null } {
  const knowledgeTopics = plan.knowledgeMap?.topics ?? [];
  const topicIds = session.topicIds ?? [];
  const explicitTopics = topicIds.flatMap((topicId) => {
    const topic = knowledgeTopics.find((candidate) => candidate.id === topicId);
    return topic ? [topic] : [];
  });
  if (
    topicIds.length > 0
    && (
      new Set(topicIds).size !== topicIds.length
      || explicitTopics.length !== topicIds.length
      || explicitTopics.some((topic, index) => topic.id !== topicIds[index])
    )
  ) {
    return { topics: [], issue: "The saved lesson no longer has exact topic links in the knowledge map." };
  }
  if (explicitTopics.length > 0) return { topics: explicitTopics, issue: null };

  const legacyTopic = legacyScheduledRetrievalTopic({
    session,
    knowledgeTopics,
  });
  if (legacyTopic) return { topics: [legacyTopic], issue: null };
  return { topics: [], issue: "The saved lesson is not linked to an authoritative topic." };
}
