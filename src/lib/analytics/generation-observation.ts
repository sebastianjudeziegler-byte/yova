import { z } from "zod";

export const GenerationValidatorSchema = z.enum([
  "plan_response_status",
  "plan_structure",
  "plan_quality_gate",
  "plan_provider_request",
  "session_response_status",
  "session_structure",
  "session_semantic_validation",
  "session_provider_request",
  "reliable_lesson_response_status",
  "reliable_lesson_structure",
  "scheduled_retrieval_validation",
  "material_mapping_response_status",
  "material_mapping_structure",
  "material_mapping_chunk_coverage",
  "material_mapping_provider_request",
  "knowledge_map_response_status",
  "knowledge_map_structure",
  "knowledge_map_material_coverage",
  "knowledge_map_provider_request",
]);

export const GenerationObservationSchema = z.object({
  generationType: z.enum(["plan", "session", "material_mapping", "knowledge_map"]),
  environment: z.enum(["production", "preview", "development"]),
  finalOutcome: z.enum(["success", "fallback", "failure", "cache"]),
  firstAttemptPassed: z.boolean().nullable(),
  failedValidator: GenerationValidatorSchema.nullable(),
  repairAttempted: z.boolean(),
  repairSucceeded: z.boolean().nullable(),
  elapsedMs: z.number().int().min(0).max(300_000),
  attempts: z.number().int().min(0).max(16),
  inputTokens: z.number().int().min(0),
  cachedInputTokens: z.number().int().min(0),
  cacheWriteTokens: z.number().int().min(0),
  outputTokens: z.number().int().min(0),
  model: z.string().trim().min(1).max(80).nullable(),
  diagnostics: z.object({
    materialRole: z.enum(["content_source", "scope_outline", "mixed"]).optional(),
    chunkCount: z.number().int().min(0).max(100).optional(),
    topicCount: z.number().int().min(0).max(100).optional(),
    scopeBand: z.enum(["focused_skill", "unit_or_exam", "broad_course"]).optional(),
  }).strict().optional(),
}).strict();

export type GenerationValidator = z.infer<typeof GenerationValidatorSchema>;
export type GenerationObservation = z.infer<typeof GenerationObservationSchema>;

export function generationEnvironment(): GenerationObservation["environment"] {
  if (process.env.VERCEL_ENV === "production") return "production";
  if (process.env.VERCEL_ENV === "preview") return "preview";
  return "development";
}
