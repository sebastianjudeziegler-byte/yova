import type { GenerationValidator } from "@/lib/analytics/generation-observation";
import type { KnowledgeMapGenerationStats } from "@/lib/knowledge-map/generate-plan-map";
import {
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

/** Production mapping failures must never become preview-derived curricula. */
export function buildDeterministicKnowledgeMapFallback(
  _request: PlanGenerationRequest,
  _failedValidator: GenerationValidator,
): DeterministicKnowledgeMapResult {
  void _request;
  void _failedValidator;
  throw new Error("YOVA could not map this learning goal yet. Try again in a moment.");
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
