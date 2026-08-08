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
]);

export const GenerationObservationSchema = z.object({
  generationType: z.enum(["plan", "session"]),
  environment: z.enum(["production", "preview", "development"]),
  finalOutcome: z.enum(["success", "fallback", "failure", "cache"]),
  firstAttemptPassed: z.boolean().nullable(),
  failedValidator: GenerationValidatorSchema.nullable(),
  repairAttempted: z.boolean(),
  repairSucceeded: z.boolean().nullable(),
  elapsedMs: z.number().int().min(0).max(300_000),
  attempts: z.number().int().min(0).max(4),
  inputTokens: z.number().int().min(0),
  cachedInputTokens: z.number().int().min(0),
  cacheWriteTokens: z.number().int().min(0),
  outputTokens: z.number().int().min(0),
  model: z.string().trim().min(1).max(80).nullable(),
}).strict();

export type GenerationValidator = z.infer<typeof GenerationValidatorSchema>;
export type GenerationObservation = z.infer<typeof GenerationObservationSchema>;

export function generationEnvironment(): GenerationObservation["environment"] {
  if (process.env.VERCEL_ENV === "production") return "production";
  if (process.env.VERCEL_ENV === "preview") return "preview";
  return "development";
}

