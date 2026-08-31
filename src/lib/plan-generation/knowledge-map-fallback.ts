import type { GenerationValidator } from "@/lib/analytics/generation-observation";
import type { KnowledgeMapGenerationStats } from "@/lib/knowledge-map/generate-plan-map";
import {
  MaterialUnderstandingSchema,
  PlanKnowledgeMapSchema,
  type PlanKnowledgeMap,
} from "@/lib/knowledge-map/schema";
import { generatePreviewPlan } from "@/lib/plan-generation/preview-generator";
import type { PlanGenerationRequest } from "@/lib/plan-generation/schema";
import { inferPlanScopeContract } from "@/lib/plan-generation/scope-contract";

export type DeterministicKnowledgeMapResult = {
  map: PlanKnowledgeMap;
  stats: KnowledgeMapGenerationStats;
};

/**
 * Builds a conservative map without inventing source-backed facts. Existing
 * material understanding remains authoritative, including every source
 * reference. A source-free request receives only a plainly labelled temporary
 * scope map that the learner must review before activation.
 */
export function buildDeterministicKnowledgeMapFallback(
  request: PlanGenerationRequest,
  failedValidator: GenerationValidator,
): DeterministicKnowledgeMapResult {
  const materialTopics = request.materials.flatMap((material) => {
    const understanding = MaterialUnderstandingSchema.safeParse(material.understanding);
    return understanding.success
      ? understanding.data.topics.map((topic) => ({
          materialId: material.id,
          topic,
        }))
      : [];
  });

  if (materialTopics.length === 0) {
    const preview = buildDevelopmentPreviewKnowledgeMap(request);
    return {
      ...preview,
      stats: {
        ...preview.stats,
        firstAttemptPassed: false,
        failedValidator,
      },
    };
  }

  // Never silently drop accepted source topics merely to fit the map cap.
  if (materialTopics.length > 40) {
    throw new Error("The mapped material topics exceed the safe fallback map capacity.");
  }

  const remappedIdByMaterialTopic = new Map(
    materialTopics.map(({ materialId, topic }) => [
      `${materialId}:${topic.id}`,
      crypto.randomUUID(),
    ] as const),
  );
  const map = PlanKnowledgeMapSchema.parse({
    version: 1,
    scopeJudgment: inferPlanScopeContract(request),
    topics: materialTopics.map(({ materialId, topic }) => ({
      ...topic,
      id: remappedIdByMaterialTopic.get(`${materialId}:${topic.id}`),
      prerequisiteTopicIds: topic.prerequisiteTopicIds.flatMap((prerequisiteTopicId) => {
        const remappedId = remappedIdByMaterialTopic.get(`${materialId}:${prerequisiteTopicId}`);
        return remappedId ? [remappedId] : [];
      }),
      // Material understanding is not learner evidence. A new plan must still
      // begin from an unevidenced state even if stale metadata says otherwise.
      status: "not_started",
      initialEvidence: null,
    })),
  });

  return {
    map,
    stats: emptyFallbackStats(failedValidator),
  };
}

export function buildDevelopmentPreviewKnowledgeMap(
  request: PlanGenerationRequest,
): DeterministicKnowledgeMapResult {
  // The preview planner is used here only as a deterministic semantic seed.
  // Its legacy scheduler must not decide whether the later fixed-envelope
  // composer has enough capacity: canonical durations can pack more than one
  // coherent session into a learner window and can explicitly defer tail
  // targets. Give this semantic-only pass a deadline-free synthetic horizon,
  // then compose the real schedule from the original request below.
  const semanticSeedRequest = request.intent === "plan"
    ? {
        ...request,
        deadline: null,
        availability: [{
          day: "Every day",
          window: "Anytime",
          minutes: 60,
        }],
      }
    : request;
  const preview = generatePreviewPlan(semanticSeedRequest);
  const titles = Array.from(new Set(
    preview.sessions.flatMap((session) => session.contentTargets ?? [])
      .map((title) => title.trim().slice(0, 140))
      .filter((title) => title.length >= 2),
  )).slice(0, 40);
  const topicTitles = titles.length ? titles : [preview.topic.trim().slice(0, 140)];
  const ids = topicTitles.map(() => crypto.randomUUID());
  const map = PlanKnowledgeMapSchema.parse({
    version: 1,
    scopeJudgment: inferPlanScopeContract(request),
    topics: topicTitles.map((title, index) => ({
      id: ids[index],
      title,
      description: `The knowledge and performance needed for ${title}.`.slice(0, 400),
      subtopics: [],
      prerequisiteTopicIds: index > 0 ? [ids[index - 1]] : [],
      status: "not_started",
      initialEvidence: null,
      sourceReferences: [],
      origin: "ai_generated",
      deferred: null,
    })),
  });
  return {
    map,
    stats: {
      ...emptyFallbackStats(null),
      firstAttemptPassed: true,
    },
  };
}

function emptyFallbackStats(
  failedValidator: GenerationValidator | null,
): KnowledgeMapGenerationStats {
  return {
    elapsedMs: 0,
    attempts: 1,
    inputTokens: 0,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
    firstAttemptPassed: false,
    failedValidator,
    model: null,
    curriculumRecognized: false,
    curriculumId: null,
    curriculumMatchSource: null,
    curriculumMatchConfidence: null,
  };
}
