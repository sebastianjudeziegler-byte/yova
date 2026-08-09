import "server-only";
import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";
import type { GenerationValidator } from "@/lib/analytics/generation-observation";
import {
  MaterialUnderstandingSchema,
  PlanKnowledgeMapSchema,
  ScopeJudgmentSchema,
  type KnowledgeMapTopic,
  type PlanKnowledgeMap,
} from "@/lib/knowledge-map/schema";
import { getOpenAIClient } from "@/lib/openai/client";
import { getOpenAIKnowledgeMapConfig } from "@/lib/openai/config";
import type { PlanGenerationRequest } from "@/lib/plan-generation/schema";

const KnowledgeMapOutputSchema = z.object({
  scopeJudgment: ScopeJudgmentSchema,
  topics: z.array(z.object({
    title: z.string().trim().min(2).max(140),
    description: z.string().trim().min(8).max(400),
    subtopics: z.array(z.string().trim().min(2).max(140)).max(12),
    prerequisiteTopicIndexes: z.array(z.number().int().nonnegative()).max(12),
    sourceMaterialTopicIds: z.array(z.string().uuid()).max(20),
  })).min(1).max(40),
});

const KNOWLEDGE_MAP_INSTRUCTIONS = `Build YOVA's authoritative knowledge map before creating a schedule.

Judge the scope from the learner's actual goal, starting context, diagnostic responses, deadline, and material maps. Do not use a subject-name heuristic. A narrow skill, a connected unit or exam, and a broad pathway require different session ranges.

Return topics in prerequisite order. Scope the map to the learner's stated outcome, not the entire academic discipline. Each topic must be a defensible unit of knowledge or performance that can be taught and evidenced, not a generic chapter label. A broad goal needs foundations and prerequisite structure; a narrow goal must not be inflated.

When materials exist, sourceMaterialTopicIds must reference the supplied material-topic ids whenever a topic comes from them. A scope outline defines what belongs in the map but does not provide instructional substance. You may add ai-generated prerequisite topics only when needed to make the requested learning path coherent. Never invent completed knowledge or omit requested material topics silently.

Session ranges must fit within 1-14. For study_now, all session values must be 1. Use plain language and no em dashes.`;

export type KnowledgeMapGenerationStats = {
  elapsedMs: number;
  attempts: number;
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  firstAttemptPassed: boolean;
  failedValidator: GenerationValidator | null;
  model: string | null;
};

export async function generatePlanKnowledgeMap(request: PlanGenerationRequest): Promise<{
  map: PlanKnowledgeMap;
  stats: KnowledgeMapGenerationStats;
}> {
  const startedAt = Date.now();
  const config = getOpenAIKnowledgeMapConfig();
  const materialTopics = request.materials.flatMap((material) => {
    const understanding = MaterialUnderstandingSchema.safeParse(material.understanding);
    return understanding.success
      ? understanding.data.topics.map((topic) => ({
        materialTopicId: topic.id,
        materialId: material.id,
        materialName: material.name,
        materialRole: understanding.data.role,
        title: topic.title,
        description: topic.description,
        subtopics: topic.subtopics,
        prerequisiteTopicIds: topic.prerequisiteTopicIds,
      }))
      : [];
  });
  if (!config) throw new KnowledgeMapGenerationError("knowledge_map_provider_request");

  try {
    const response = await getOpenAIClient().responses.parse({
      model: config.model,
      instructions: KNOWLEDGE_MAP_INSTRUCTIONS,
      input: JSON.stringify({
        intent: request.intent,
        goal: request.goal,
        startingContext: request.startingContext ?? null,
        learningIntent: request.learningIntent,
        deadline: request.deadline,
        diagnosticResponses: request.diagnosticResponses,
        availability: request.availability,
        materials: materialTopics,
      }),
      reasoning: { effort: "low" },
      text: { format: zodTextFormat(KnowledgeMapOutputSchema, "yova_knowledge_map"), verbosity: "low" },
      max_output_tokens: 5_000,
      store: false,
    }, { maxRetries: 0, timeout: 35_000 });
    const usage = response.usage;
    if (response.status !== "completed") throw new KnowledgeMapGenerationError("knowledge_map_response_status");
    const parsed = KnowledgeMapOutputSchema.safeParse(response.output_parsed);
    if (!parsed.success) throw new KnowledgeMapGenerationError("knowledge_map_structure");
    const suppliedMaterialTopicIds = new Set(materialTopics.map((topic) => topic.materialTopicId));
    const returnedMaterialTopicIds = new Set(parsed.data.topics.flatMap((topic) => topic.sourceMaterialTopicIds));
    if (
      [...returnedMaterialTopicIds].some((id) => !suppliedMaterialTopicIds.has(id))
      || [...suppliedMaterialTopicIds].some((id) => !returnedMaterialTopicIds.has(id))
    ) {
      throw new KnowledgeMapGenerationError("knowledge_map_material_coverage");
    }
    if (parsed.data.topics.some((topic, index) => (
      topic.prerequisiteTopicIndexes.some((candidate) => candidate >= index)
    ))) {
      throw new KnowledgeMapGenerationError("knowledge_map_structure");
    }
    const sourceById = new Map(request.materials.flatMap((material) => {
      const understanding = MaterialUnderstandingSchema.safeParse(material.understanding);
      return understanding.success ? understanding.data.topics.map((topic) => [topic.id, topic] as const) : [];
    }));
    const ids = parsed.data.topics.map(() => crypto.randomUUID());
    const topics: KnowledgeMapTopic[] = parsed.data.topics.map((topic, index) => {
      const sourceTopics = topic.sourceMaterialTopicIds.map((id) => sourceById.get(id)).filter(Boolean);
      return {
        id: ids[index],
        title: topic.title,
        description: topic.description,
        subtopics: topic.subtopics,
        prerequisiteTopicIds: topic.prerequisiteTopicIndexes
          .filter((candidate) => candidate >= 0 && candidate < index)
          .map((candidate) => ids[candidate]),
        status: "not_started",
        initialEvidence: null,
        sourceReferences: sourceTopics.flatMap((source) => source?.sourceReferences ?? []),
        origin: sourceTopics.length ? "material" : "ai_generated",
        deferred: null,
      };
    });
    const map = PlanKnowledgeMapSchema.parse({ version: 1, scopeJudgment: parsed.data.scopeJudgment, topics });
    return {
      map,
      stats: {
        elapsedMs: Date.now() - startedAt,
        attempts: 1,
        inputTokens: usage?.input_tokens ?? 0,
        cachedInputTokens: usage?.input_tokens_details.cached_tokens ?? 0,
        cacheWriteTokens: usage?.input_tokens_details.cache_write_tokens ?? 0,
        outputTokens: usage?.output_tokens ?? 0,
        firstAttemptPassed: true,
        failedValidator: null,
        model: config.model,
      },
    };
  } catch (error) {
    if (error instanceof KnowledgeMapGenerationError) throw error;
    throw new KnowledgeMapGenerationError("knowledge_map_provider_request");
  }
}

export class KnowledgeMapGenerationError extends Error {
  constructor(public readonly failedValidator: GenerationValidator) {
    super("YOVA could not build the knowledge map.");
  }
}
