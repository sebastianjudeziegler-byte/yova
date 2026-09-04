import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";
import {
  GenerationObservationSchema,
  generationEnvironment,
} from "@/lib/analytics/generation-observation";
import {
  MaterialUnderstandingSchema,
  type KnowledgeMapTopic,
  type MaterialSectionRole,
  type MaterialUnderstanding,
} from "@/lib/knowledge-map/schema";
import { chunkMaterialText, type MaterialTextChunk } from "@/lib/materials/chunk";
import { persistMaterialMappingResult } from "@/lib/materials/material-mapping-persistence";
import { getOpenAIClient } from "@/lib/openai/client";
import { getOpenAIKnowledgeMapConfig } from "@/lib/openai/config";
import {
  refundAIRequestClaimBeforeProvider,
  refundAIRequestReservationBeforeProvider,
  reserveAIRequest,
  settleAIRequestClaim,
} from "@/lib/server/ai-usage";

const CHUNKS_PER_BATCH = 4;
const MAPPING_CONCURRENCY = 3;
const PROVIDER_BATCH_TIMEOUT_MS = 30_000;
const MINIMUM_BATCH_TIME_MS = 5_000;
export const MATERIAL_MAPPING_ROUTE_BUDGET_MS = 90_000;

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

type MaterialMappingInput = {
  materialId: string;
  filename: string;
  text: string;
  deadlineAt?: number;
};

type MaterialPersistenceInput = MaterialMappingInput & {
  supabase: SupabaseClient;
  table?: "material_uploads" | "materials";
};

export async function mapMaterialText(input: MaterialMappingInput) {
  return mapMaterialTextInternal(input);
}

async function mapMaterialTextInternal(input: MaterialMappingInput & {
  beforeProviderRequest?: () => Promise<void>;
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
  const deadlineAt = input.deadlineAt ?? startedAt + MATERIAL_MAPPING_ROUTE_BUDGET_MS;
  let providerAuthorized = false;

  for (let start = 0; start < batches.length; start += MAPPING_CONCURRENCY) {
    const waveBatches = batches.slice(start, start + MAPPING_CONCURRENCY);
    if (deadlineAt - Date.now() < MINIMUM_BATCH_TIME_MS) throw new MaterialMappingDeadlineError();
    if (!providerAuthorized) {
      await input.beforeProviderRequest?.();
      providerAuthorized = true;
    }
    const wave = await Promise.all(waveBatches.map(async (batch) => {
      const remainingMs = deadlineAt - Date.now();
      if (remainingMs < MINIMUM_BATCH_TIME_MS) throw new MaterialMappingDeadlineError();
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
      }, {
        maxRetries: 0,
        timeout: Math.min(PROVIDER_BATCH_TIMEOUT_MS, remainingMs),
        signal: AbortSignal.timeout(Math.min(PROVIDER_BATCH_TIMEOUT_MS, remainingMs)),
      });
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

/**
 * The default material mapper owns its durable allowance. The material UUID is
 * the stable operation key, so every route and server instance shares one
 * single-flight decision before any mapping provider request can begin.
 */
export async function mapAndPersistMaterial(input: MaterialPersistenceInput) {
  const recoveryKey = crypto.randomUUID();
  let reservation: Awaited<ReturnType<typeof reserveAIRequest>>;
  try {
    reservation = await reserveAIRequest(
      input.supabase,
      "material_processing",
      input.materialId,
      recoveryKey,
    );
  } catch {
    await recoverUnknownMaterialMappingReservation(input, recoveryKey);
    throw new MaterialMappingAllowanceError("allowance_unverified");
  }

  if (!reservation.allowed) {
    throw new MaterialMappingAllowanceError(
      reservation.denialReason,
      reservation.retryAfterSeconds,
    );
  }

  let allowanceConsumed = false;
  try {
    return await mapAndPersistMaterialInternal(input, async () => {
      let consumed = false;
      try {
        consumed = await settleAIRequestClaim(input.supabase, reservation.claimId);
      } catch {
        // The exact release below safely distinguishes a live reservation from
        // a consumption whose receipt was lost.
      }
      if (!consumed) {
        throw new MaterialMappingAllowanceError("allowance_settlement_unconfirmed");
      }
      allowanceConsumed = true;
    });
  } catch (error) {
    if (!allowanceConsumed) {
      await refundKnownMaterialMappingReservationBeforeProvider(input, reservation.claimId);
    }
    throw error;
  }
}

/**
 * Only for a caller that already consumed material_processing allowance for
 * this exact material before an earlier provider-capable phase (currently PDF
 * recovery in /api/materials). All other callers use mapAndPersistMaterial.
 */
export async function mapAndPersistMaterialWithConsumedAIUsage(input: MaterialPersistenceInput) {
  return mapAndPersistMaterialInternal(input);
}

async function mapAndPersistMaterialInternal(
  input: MaterialPersistenceInput,
  beforeProviderRequest?: () => Promise<void>,
) {
  const table = input.table ?? "material_uploads";
  const startedAt = Date.now();
  try {
    const mapped = await mapMaterialTextInternal({ ...input, beforeProviderRequest });
    const persisted = await persistMaterialMappingResult({
      supabase: input.supabase,
      table,
      materialId: input.materialId,
      metadataPatch: { mappingStatus: "ready", materialUnderstanding: mapped.understanding },
      chunks: mapped.chunks.map((chunk) => ({
        id: chunk.id,
        chunkIndex: chunk.index,
        charStart: chunk.startCharacter,
        charEnd: chunk.endCharacter,
        locationLabel: chunk.locationLabel,
        sectionRole: chunk.sectionRole,
        chunkText: chunk.text,
      })),
      observation: materialMappingObservation({
        finalOutcome: "success",
        firstAttemptPassed: true,
        failedValidator: null,
        elapsedMs: mapped.stats.elapsedMs,
        attempts: mapped.stats.attempts,
        inputTokens: mapped.stats.inputTokens,
        cachedInputTokens: mapped.stats.cachedInputTokens,
        cacheWriteTokens: mapped.stats.cacheWriteTokens,
        outputTokens: mapped.stats.outputTokens,
        model: mapped.stats.model,
        diagnostics: {
          materialRole: mapped.understanding.role,
          chunkCount: mapped.chunks.length,
          topicCount: mapped.understanding.topics.length,
        },
      }),
    });
    if (!persisted) throw new MaterialMappingSourceMissingError();
    return mapped.understanding;
  } catch (error) {
    if (error instanceof MaterialMappingSourceMissingError) throw error;
    await persistMaterialMappingResult({
      supabase: input.supabase,
      table,
      materialId: input.materialId,
      metadataPatch: { mappingStatus: "failed" },
      chunks: [],
      observation: materialMappingObservation({
        finalOutcome: "failure",
        firstAttemptPassed: false,
        failedValidator: error instanceof MaterialMappingError
          ? error.failedValidator
          : error instanceof z.ZodError
            ? "material_mapping_structure"
            : "material_mapping_provider_request",
        elapsedMs: Date.now() - startedAt,
        attempts: 1,
        inputTokens: 0,
        cachedInputTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 0,
        model: getOpenAIKnowledgeMapConfig()?.model ?? null,
      }),
    }).catch(() => false);
    throw error;
  }
}

export class MaterialMappingAllowanceError extends Error {
  constructor(
    public readonly denialReason: string,
    public readonly retryAfterSeconds: number | null = null,
  ) {
    super("YOVA could not authorize this material-mapping attempt.");
    this.name = "MaterialMappingAllowanceError";
  }
}

async function recoverUnknownMaterialMappingReservation(
  input: MaterialPersistenceInput,
  recoveryKey: string,
) {
  try {
    await refundAIRequestReservationBeforeProvider(
      input.supabase,
      "material_processing",
      input.materialId,
      recoveryKey,
    );
  } catch {
    // Ambiguous expiry is consumed by the database rather than refunded.
  }
}

async function refundKnownMaterialMappingReservationBeforeProvider(
  input: MaterialPersistenceInput,
  claimId: string,
) {
  try {
    await refundAIRequestClaimBeforeProvider(input.supabase, claimId);
  } catch {
    // An unconfirmed release becomes a consumed attempt when its lease expires.
  }
}

function materialMappingObservation(input: {
  finalOutcome: "success" | "failure";
  firstAttemptPassed: boolean;
  failedValidator: import("@/lib/analytics/generation-observation").GenerationValidator | null;
  elapsedMs: number;
  attempts: number;
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  model: string | null;
  diagnostics?: {
    materialRole: MaterialUnderstanding["role"];
    chunkCount: number;
    topicCount: number;
  };
}) {
  return GenerationObservationSchema.parse({
    generationType: "material_mapping",
    environment: generationEnvironment(),
    finalOutcome: input.finalOutcome,
    firstAttemptPassed: input.firstAttemptPassed,
    failedValidator: input.failedValidator,
    repairAttempted: false,
    repairSucceeded: null,
    elapsedMs: Math.max(0, Math.min(300_000, Math.round(input.elapsedMs))),
    attempts: Math.max(0, Math.min(16, Math.round(input.attempts))),
    inputTokens: Math.max(0, Math.round(input.inputTokens)),
    cachedInputTokens: Math.max(0, Math.round(input.cachedInputTokens)),
    cacheWriteTokens: Math.max(0, Math.round(input.cacheWriteTokens)),
    outputTokens: Math.max(0, Math.round(input.outputTokens)),
    model: input.model?.slice(0, 80) ?? null,
    ...(input.diagnostics ? {
      diagnostics: {
        materialRole: input.diagnostics.materialRole,
        chunkCount: Math.min(100, input.diagnostics.chunkCount),
        topicCount: Math.min(100, input.diagnostics.topicCount),
      },
    } : {}),
  });
}

class MaterialMappingSourceMissingError extends Error {
  constructor() {
    super("The material was removed before mapping finished.");
  }
}

class MaterialMappingError extends Error {
  constructor(public readonly failedValidator: import("@/lib/analytics/generation-observation").GenerationValidator) {
    super("YOVA could not map every material chunk.");
  }
}

export class MaterialMappingDeadlineError extends Error {
  constructor() {
    super("Material mapping stopped before the request deadline so its partial state can be removed safely.");
    this.name = "MaterialMappingDeadlineError";
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
            initialEvidence: null,
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
