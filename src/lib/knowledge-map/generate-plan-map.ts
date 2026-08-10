import "server-only";
import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";
import type { GenerationValidator } from "@/lib/analytics/generation-observation";
import { recognizeCurriculum, type CurriculumRecognition } from "@/lib/curriculum/registry";
import type { CurriculumId } from "@/lib/curriculum/schema";
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
    subtopics: z.array(z.string().trim().min(2).max(500)).max(12),
    prerequisiteTopicIndexes: z.array(z.number().int().nonnegative()).max(12),
    sourceMaterialTopicIds: z.array(z.string().uuid()).max(20),
  })).min(1).max(40),
});

const CurriculumMapOutputSchema = z.object({
  scopeJudgment: ScopeJudgmentSchema,
  materialAlignments: z.array(z.object({
    sourceMaterialTopicId: z.string().uuid(),
    curriculumTopicCodes: z.array(z.string().trim().min(2).max(24)).min(1).max(10),
  })).max(200),
});

const KNOWLEDGE_MAP_INSTRUCTIONS = `Build YOVA's authoritative knowledge map before creating a schedule.

Judge the scope from the learner's actual goal, starting context, diagnostic responses, deadline, and material maps. Do not use a subject-name heuristic. A narrow skill, a connected unit or exam, and a broad pathway require different session ranges.

Return topics in prerequisite order. Scope the map to the learner's stated outcome, not the entire academic discipline. Each topic must be a defensible unit of knowledge or performance that can be taught and evidenced, not a generic chapter label. A broad goal needs foundations and prerequisite structure; a narrow goal must not be inflated.

When materials exist, sourceMaterialTopicIds must reference the supplied material-topic ids whenever a topic comes from them. A scope outline defines what belongs in the map but does not provide instructional substance. You may add ai-generated prerequisite topics only when needed to make the requested learning path coherent. Never invent completed knowledge or omit requested material topics silently.

The learner may provide a mapCorrection after reviewing a draft map. Treat it as an explicit request about scope or emphasis. Add genuinely missing topics, remove topics outside the stated goal, or change emphasis when requested. A claim that the learner already knows a topic may reduce its planned teaching and lead to a short verification, but it must never create evidence or advance a topic status by itself.

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
  curriculumRecognized: boolean;
  curriculumId: CurriculumId | null;
  curriculumMatchSource: "goal" | "material" | "both" | null;
  curriculumMatchConfidence: "exact" | "alias" | null;
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
  const recognizedCurriculum = recognizeCurriculum({
    goal: request.goal,
    materials: request.materials.map((material) => {
      const understanding = MaterialUnderstandingSchema.safeParse(material.understanding);
      return {
        name: material.name,
        topicTitles: understanding.success ? understanding.data.topics.map((topic) => topic.title) : [],
      };
    }),
  });
  if (!config) throw new KnowledgeMapGenerationError("knowledge_map_provider_request");

  try {
    if (recognizedCurriculum) {
      return await generateRecognizedCurriculumMap({
        request,
        materialTopics,
        recognition: recognizedCurriculum,
        model: config.model,
        startedAt,
      });
    }
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
        mapCorrection: request.mapCorrection ?? null,
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
        curriculumRecognized: false,
        curriculumId: null,
        curriculumMatchSource: null,
        curriculumMatchConfidence: null,
      },
    };
  } catch (error) {
    if (error instanceof KnowledgeMapGenerationError) throw error;
    throw new KnowledgeMapGenerationError("knowledge_map_provider_request");
  }
}

async function generateRecognizedCurriculumMap({
  request,
  materialTopics,
  recognition,
  model,
  startedAt,
}: {
  request: PlanGenerationRequest;
  materialTopics: Array<{
    materialTopicId: string;
    materialId: string;
    materialName: string;
    materialRole: "content_source" | "scope_outline" | "mixed";
    title: string;
    description: string;
    subtopics: string[];
    prerequisiteTopicIds: string[];
  }>;
  recognition: CurriculumRecognition;
  model: string;
  startedAt: number;
}): Promise<{ map: PlanKnowledgeMap; stats: KnowledgeMapGenerationStats }> {
  const definition = recognition.definition;
  const response = await getOpenAIClient().responses.parse({
    model,
    instructions: `${KNOWLEDGE_MAP_INSTRUCTIONS}

This request matches a versioned official curriculum supplied in the input. The official topic spine is authoritative. Do not rename, reorder, merge, delete, or invent official curriculum topics or objectives. Your only curriculum jobs are to judge the requested scope and align each supplied material-topic id to one or more allowed official topic codes.

Return exactly one materialAlignments row for every supplied material topic. Use only official topic codes from officialCurriculum. A material topic may align to more than one official topic when its actual scope crosses those boundaries. Do not align from filename alone when the mapped title and description are more specific. For study_now, all session values in scopeJudgment must be 1. Use plain language and no em dashes.`,
    input: JSON.stringify({
      intent: request.intent,
      goal: request.goal,
      startingContext: request.startingContext ?? null,
      learningIntent: request.learningIntent,
      deadline: request.deadline,
      diagnosticResponses: request.diagnosticResponses,
      availability: request.availability,
      mapCorrection: request.mapCorrection ?? null,
      officialCurriculum: {
        id: definition.id,
        courseTitle: definition.courseTitle,
        version: definition.version,
        unitCode: definition.unitCode,
        unitTitle: definition.unitTitle,
        topics: definition.topics.map((topic) => ({
          code: topic.code,
          title: topic.title,
          objectives: topic.objectives,
        })),
      },
      materialTopics,
    }),
    reasoning: { effort: "low" },
    text: { format: zodTextFormat(CurriculumMapOutputSchema, "yova_curriculum_map_alignment"), verbosity: "low" },
    max_output_tokens: 3_000,
    store: false,
  }, { maxRetries: 0, timeout: 35_000 });
  const usage = response.usage;
  if (response.status !== "completed") throw new KnowledgeMapGenerationError("knowledge_map_response_status");
  const parsed = CurriculumMapOutputSchema.safeParse(response.output_parsed);
  if (!parsed.success) throw new KnowledgeMapGenerationError("knowledge_map_structure");

  const expectedMaterialIds = new Set(materialTopics.map((topic) => topic.materialTopicId));
  const returnedMaterialIds = parsed.data.materialAlignments.map((alignment) => alignment.sourceMaterialTopicId);
  const returnedMaterialIdSet = new Set(returnedMaterialIds);
  const allowedTopicCodes = new Set(definition.topics.map((topic) => topic.code));
  if (
    returnedMaterialIds.length !== returnedMaterialIdSet.size
    || returnedMaterialIds.some((id) => !expectedMaterialIds.has(id))
    || [...expectedMaterialIds].some((id) => !returnedMaterialIdSet.has(id))
    || parsed.data.materialAlignments.some((alignment) => (
      new Set(alignment.curriculumTopicCodes).size !== alignment.curriculumTopicCodes.length
      || alignment.curriculumTopicCodes.some((code) => !allowedTopicCodes.has(code))
    ))
  ) {
    throw new KnowledgeMapGenerationError("knowledge_map_curriculum_alignment");
  }

  const sourceById = new Map(request.materials.flatMap((material) => {
    const understanding = MaterialUnderstandingSchema.safeParse(material.understanding);
    return understanding.success ? understanding.data.topics.map((topic) => [topic.id, topic] as const) : [];
  }));
  const sourceIdsByTopicCode = new Map<string, string[]>();
  for (const alignment of parsed.data.materialAlignments) {
    for (const topicCode of alignment.curriculumTopicCodes) {
      sourceIdsByTopicCode.set(topicCode, [
        ...(sourceIdsByTopicCode.get(topicCode) ?? []),
        alignment.sourceMaterialTopicId,
      ]);
    }
  }

  const idsByCode = new Map(definition.topics.map((topic) => [topic.code, crypto.randomUUID()] as const));
  const topics: KnowledgeMapTopic[] = definition.topics.map((topic) => {
    const topicObjectives = topic.objectives.filter((objective) => objective.scope === "topic");
    const sourceTopics = (sourceIdsByTopicCode.get(topic.code) ?? [])
      .map((id) => sourceById.get(id))
      .filter((source): source is NonNullable<typeof source> => Boolean(source));
    return {
      id: idsByCode.get(topic.code)!,
      title: `${topic.code} ${topic.title}`,
      description: topicObjectives.length > 0
        ? topicObjectives.map((objective) => objective.text).join(" ").slice(0, 400)
        : `Official curriculum node within ${definition.unitTitle}.`,
      subtopics: topic.objectives.map((objective) => (
        objective.scope === "course"
          ? `Course objective ${objective.code}: ${objective.text}`
          : `${objective.code}: ${objective.text}`
      )),
      prerequisiteTopicIds: topic.prerequisiteTopicCodes
        .map((code) => idsByCode.get(code))
        .filter((id): id is string => Boolean(id)),
      status: "not_started",
      initialEvidence: null,
      sourceReferences: sourceTopics.flatMap((source) => source.sourceReferences),
      origin: sourceTopics.length > 0 ? "material" : "ai_generated",
      deferred: null,
      curriculumReference: {
        curriculumId: definition.id,
        topicCode: topic.code,
        objectiveCodes: topic.objectives.map((objective) => objective.code),
      },
    };
  });
  const map = PlanKnowledgeMapSchema.parse({
    version: 1,
    scopeJudgment: parsed.data.scopeJudgment,
    topics,
    curriculum: recognition.planCurriculum,
  });
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
      model,
      curriculumRecognized: true,
      curriculumId: definition.id,
      curriculumMatchSource: recognition.planCurriculum.matchSource,
      curriculumMatchConfidence: recognition.planCurriculum.matchConfidence,
    },
  };
}

export class KnowledgeMapGenerationError extends Error {
  constructor(public readonly failedValidator: GenerationValidator) {
    super("YOVA could not build the knowledge map.");
  }
}
