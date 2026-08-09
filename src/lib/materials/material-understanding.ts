import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";
import { generationEnvironment } from "@/lib/analytics/generation-observation";
import { recordGenerationObservation } from "@/lib/analytics/generation-observation-server";
import {
  MaterialUnderstandingSchema,
  type KnowledgeMapTopic,
  type MaterialSectionRole,
  type MaterialUnderstanding,
} from "@/lib/knowledge-map/schema";
import { chunkMaterialText, type MaterialTextChunk } from "@/lib/materials/chunk";
import { getOpenAIClient } from "@/lib/openai/client";
import { getOpenAIKnowledgeMapConfig } from "@/lib/openai/config";

const CHUNKS_PER_BATCH = 4;
const MAPPING_CONCURRENCY = 3;

const MaterialBatchMapSchema = z.object({
  roleReason: z.string().trim().min(10).max(400),
  chunks: z.array(z.object({
    chunkIndex: z.number().int().nonnegative(),
    sectionRole: z.enum(["content_source", "scope_outline"]),
    topics: z.array(z.object({
      title: z.string().trim().min(2).max(140),
      description: z.string().trim().min(8).max(400),
      subtopics: z.array(z.string().trim().min(2).max(140)).max(12),
      prerequisiteTitles: z.array(z.string().trim().min(2).max(140)).max(12),
    })).min(1).max(12),
  })).min(1).max(CHUNKS_PER_BATCH),
});

const MATERIAL_MAPPING_INSTRUCTIONS = `You map learning materials for YOVA.

Read every supplied chunk. For every chunk, classify its role:
- content_source: it contains actual explanations, examples, arguments, facts, or procedures that can teach the subject.
- scope_outline: it mainly names what must be learned, such as a study guide, syllabus, exam blueprint, headings, or topic list, without enough instruction to teach it.

Extract a concise ordered topic outline. Preserve meaningful subtopics and identify prerequisite topics by title. Topic titles describe knowledge, not document formatting. Do not treat a study-guide bullet as sufficient instructional substance. Do not invent topics absent from this material during this pass. Use plain language.`;

export type MaterialMappingStats = {
  elapsedMs: number;
  attempts: number;
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  model: string | null;
};

export async function mapMaterialText(input: {
  materialId: string;
  filename: string;
  text: string;
}): Promise<{ understanding: MaterialUnderstanding; chunks: Array<MaterialTextChunk & { sectionRole: MaterialSectionRole }>; stats: MaterialMappingStats }> {
  const startedAt = Date.now();
  const chunks = chunkMaterialText(input.materialId, input.text);
  if (!chunks.length) throw new Error("Material has no readable chunks.");
  const config = getOpenAIKnowledgeMapConfig();
  if (!config) throw new Error("Knowledge mapping is not configured.");
  const usage = { attempts: 0, inputTokens: 0, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 0 };
  const batches = Array.from(
    { length: Math.ceil(chunks.length / CHUNKS_PER_BATCH) },
    (_, index) => chunks.slice(index * CHUNKS_PER_BATCH, (index + 1) * CHUNKS_PER_BATCH),
  );
  const mappedBatches: z.infer<typeof MaterialBatchMapSchema>[] = [];

  for (let start = 0; start < batches.length; start += MAPPING_CONCURRENCY) {
    const wave = await Promise.all(batches.slice(start, start + MAPPING_CONCURRENCY).map(async (batch) => {
      usage.attempts += 1;
      const response = await getOpenAIClient().responses.parse({
        model: config.model,
        instructions: MATERIAL_MAPPING_INSTRUCTIONS,
        input: JSON.stringify({
          filename: input.filename,
          chunks: batch.map((chunk) => ({
            chunkIndex: chunk.index,
            location: chunk.locationLabel,
            text: chunk.text,
          })),
        }),
        reasoning: { effort: "low" },
        text: { format: zodTextFormat(MaterialBatchMapSchema, "yova_material_map"), verbosity: "low" },
        max_output_tokens: 4_000,
        store: false,
      }, { maxRetries: 0, timeout: 30_000 });
      if (response.status !== "completed") throw new MaterialMappingError("material_mapping_response_status");
      const parsed = MaterialBatchMapSchema.safeParse(response.output_parsed);
      if (!parsed.success) throw new MaterialMappingError("material_mapping_structure");
      const expectedIndexes = batch.map((chunk) => chunk.index).sort((left, right) => left - right);
      const returnedIndexes = parsed.data.chunks.map((chunk) => chunk.chunkIndex).sort((left, right) => left - right);
      if (JSON.stringify(returnedIndexes) !== JSON.stringify(expectedIndexes)) {
        throw new MaterialMappingError("material_mapping_chunk_coverage");
      }
      if (response.usage) {
        usage.inputTokens += response.usage.input_tokens;
        usage.cachedInputTokens += response.usage.input_tokens_details.cached_tokens;
        usage.cacheWriteTokens += response.usage.input_tokens_details.cache_write_tokens;
        usage.outputTokens += response.usage.output_tokens;
      }
      return parsed.data;
    }));
    mappedBatches.push(...wave);
  }

  const chunkRole = new Map<number, MaterialSectionRole>();
  for (const batch of mappedBatches) for (const item of batch.chunks) chunkRole.set(item.chunkIndex, item.sectionRole);
  const mappedChunks = chunks.map((chunk) => ({ ...chunk, sectionRole: chunkRole.get(chunk.index) ?? "content_source" as const }));
  const topics = mergeMappedTopics(input.materialId, mappedChunks, mappedBatches);
  const contentCount = mappedChunks.filter((chunk) => chunk.sectionRole === "content_source").length;
  const outlineCount = mappedChunks.length - contentCount;
  const role = contentCount === mappedChunks.length
    ? "content_source" as const
    : outlineCount === mappedChunks.length
      ? "scope_outline" as const
      : "mixed" as const;
  const understanding = MaterialUnderstandingSchema.parse({
    version: 1,
    role,
    roleReason: role === "mixed"
      ? `${contentCount} chunks contain instructional substance and ${outlineCount} chunks primarily define scope.`
      : mappedBatches.map((batch) => batch.roleReason).join(" ").slice(0, 400),
    mixedSections: role === "mixed" ? groupedMixedSections(mappedChunks) : [],
    topics,
    chunkCount: mappedChunks.length,
    mappedAt: new Date().toISOString(),
  });
  return {
    understanding,
    chunks: mappedChunks,
    stats: { ...usage, elapsedMs: Date.now() - startedAt, model: config.model },
  };
}

export async function mapAndPersistMaterial(input: {
  supabase: SupabaseClient;
  userId: string;
  materialId: string;
  filename: string;
  text: string;
  table?: "material_uploads" | "materials";
}) {
  const table = input.table ?? "material_uploads";
  const startedAt = Date.now();
  try {
    const mapped = await mapMaterialText(input);
    const { data: current } = await input.supabase.from(table).select("metadata").eq("id", input.materialId).maybeSingle();
    const prior = current?.metadata && typeof current.metadata === "object" && !Array.isArray(current.metadata)
      ? current.metadata as Record<string, unknown>
      : {};
    const { error: chunkError } = await input.supabase.from("material_chunks").upsert(
      mapped.chunks.map((chunk) => ({
        id: chunk.id,
        user_id: input.userId,
        material_id: input.materialId,
        chunk_index: chunk.index,
        char_start: chunk.startCharacter,
        char_end: chunk.endCharacter,
        location_label: chunk.locationLabel,
        section_role: chunk.sectionRole,
        chunk_text: chunk.text,
      })),
      { onConflict: "material_id,chunk_index" },
    );
    if (chunkError) throw chunkError;
    const { error: metadataError } = await input.supabase.from(table).update({
      metadata: { ...prior, mappingStatus: "ready", materialUnderstanding: mapped.understanding },
    }).eq("id", input.materialId);
    if (metadataError) throw metadataError;
    await recordGenerationObservation(input.supabase, input.userId, {
      generationType: "material_mapping",
      environment: generationEnvironment(),
      finalOutcome: "success",
      firstAttemptPassed: true,
      failedValidator: null,
      repairAttempted: false,
      repairSucceeded: null,
      elapsedMs: mapped.stats.elapsedMs,
      attempts: mapped.stats.attempts,
      inputTokens: mapped.stats.inputTokens,
      cachedInputTokens: mapped.stats.cachedInputTokens,
      cacheWriteTokens: mapped.stats.cacheWriteTokens,
      outputTokens: mapped.stats.outputTokens,
      model: mapped.stats.model,
      diagnostics: { materialRole: mapped.understanding.role, chunkCount: mapped.chunks.length, topicCount: mapped.understanding.topics.length },
    });
    return mapped.understanding;
  } catch (error) {
    const { data: current } = await input.supabase.from(table).select("metadata").eq("id", input.materialId).maybeSingle();
    const prior = current?.metadata && typeof current.metadata === "object" && !Array.isArray(current.metadata)
      ? current.metadata as Record<string, unknown>
      : {};
    await input.supabase.from(table).update({ metadata: { ...prior, mappingStatus: "failed" } }).eq("id", input.materialId);
    await recordGenerationObservation(input.supabase, input.userId, {
      generationType: "material_mapping",
      environment: generationEnvironment(),
      finalOutcome: "failure",
      firstAttemptPassed: false,
      failedValidator: error instanceof MaterialMappingError
        ? error.failedValidator
        : error instanceof z.ZodError
          ? "material_mapping_structure"
          : "material_mapping_provider_request",
      repairAttempted: false,
      repairSucceeded: null,
      elapsedMs: Date.now() - startedAt,
      attempts: 1,
      inputTokens: 0,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 0,
      model: getOpenAIKnowledgeMapConfig()?.model ?? null,
    });
    throw error;
  }
}

class MaterialMappingError extends Error {
  constructor(public readonly failedValidator: import("@/lib/analytics/generation-observation").GenerationValidator) {
    super("YOVA could not map every material chunk.");
  }
}

function mergeMappedTopics(
  materialId: string,
  chunks: Array<MaterialTextChunk & { sectionRole: MaterialSectionRole }>,
  batches: z.infer<typeof MaterialBatchMapSchema>[],
): KnowledgeMapTopic[] {
  const byKey = new Map<string, { topic: KnowledgeMapTopic; prerequisiteTitles: Set<string> }>();
  for (const batch of batches) for (const chunkMap of batch.chunks) {
    const chunk = chunks.find((candidate) => candidate.index === chunkMap.chunkIndex);
    if (!chunk) continue;
    for (const mapped of chunkMap.topics) {
      const key = normalizeTopic(mapped.title);
      let entry = byKey.get(key);
      if (!entry) {
        entry = {
          topic: {
            id: crypto.randomUUID(),
            title: mapped.title,
            description: mapped.description,
            subtopics: [],
            prerequisiteTopicIds: [],
            status: "not_started",
            sourceReferences: [],
            origin: "material",
            deferred: null,
          },
          prerequisiteTitles: new Set(),
        };
        byKey.set(key, entry);
      }
      entry.topic.subtopics = [...new Set([...entry.topic.subtopics, ...mapped.subtopics])].slice(0, 12);
      if (!entry.topic.sourceReferences.some((reference) => reference.chunkId === chunk.id)) {
        entry.topic.sourceReferences.push({
          materialId,
          chunkId: chunk.id,
          chunkIndex: chunk.index,
          startCharacter: chunk.startCharacter,
          endCharacter: chunk.endCharacter,
          locationLabel: chunk.locationLabel,
          sectionRole: chunk.sectionRole,
        });
      }
      mapped.prerequisiteTitles.forEach((title) => entry?.prerequisiteTitles.add(normalizeTopic(title)));
    }
  }
  const entries = [...byKey.values()];
  const idByKey = new Map([...byKey].map(([key, value]) => [key, value.topic.id]));
  for (const entry of entries) {
    entry.topic.prerequisiteTopicIds = [...entry.prerequisiteTitles]
      .map((key) => idByKey.get(key))
      .filter((id): id is string => Boolean(id) && id !== entry.topic.id);
  }
  return entries.map((entry) => entry.topic);
}

function groupedMixedSections(chunks: Array<MaterialTextChunk & { sectionRole: MaterialSectionRole }>) {
  const groups: Array<{ chunkIds: string[]; role: MaterialSectionRole; description: string }> = [];
  for (const chunk of chunks) {
    const current = groups.at(-1);
    if (current?.role === chunk.sectionRole) current.chunkIds.push(chunk.id);
    else groups.push({
      chunkIds: [chunk.id],
      role: chunk.sectionRole,
      description: chunk.sectionRole === "content_source" ? "Instructional content" : "Scope-defining outline",
    });
  }
  return groups;
}

function normalizeTopic(value: string) {
  return value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}
