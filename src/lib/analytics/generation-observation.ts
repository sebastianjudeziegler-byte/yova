import { z } from "zod";
import {
  CurriculumIdSchema,
  CurriculumMatchConfidenceSchema,
  CurriculumMatchSourceSchema,
} from "@/lib/curriculum/schema";
import { PROVIDER_ERROR_CATEGORIES } from "@/lib/openai/provider-error";

export const PLAN_FAILURE_REASONS = [
  "refused",
  "incomplete",
  "invalid_output",
  "provider_error",
] as const;

export const PLAN_QUALITY_ISSUE_CODES = [
  "session_count",
  "teaching_progression",
  "objective_uniqueness",
  "schedule_fit",
  "session_content_budget",
  "completion_evidence",
  "method_routing",
  "knowledge_map_coverage",
  "placement_contract",
  "unsupported_claim",
  "interface_format",
] as const;

export type PlanQualityIssueCode = typeof PLAN_QUALITY_ISSUE_CODES[number];

export const SESSION_VALIDATION_ISSUE_CODES = [
  "session_full_structure",
  "session_recovery_structure",
  "session_recovery_validation",
  "session_required_typed_recall",
  "session_practice_metadata",
  "scheduled_retrieval_format",
  "streamed_target_assignment_count",
  "streamed_target_assignment_copy",
  "streamed_target_assignment_duplicate",
  "streamed_target_id_inactive",
  "streamed_target_order",
  "streamed_target_subject",
  "streamed_deferred_content",
  "streamed_target_missing",
  "streamed_teaching_capacity",
  "streamed_check_mapping",
  "streamed_scope_other",
] as const;

export type SessionValidationIssueCode = typeof SESSION_VALIDATION_ISSUE_CODES[number];

export const GenerationValidatorSchema = z.enum([
  "plan_response_status",
  "plan_structure",
  "plan_quality_gate",
  "plan_provider_request",
  "session_response_status",
  "session_structure",
  "session_semantic_validation",
  "session_time_budget",
  "session_coverage_fidelity",
  "streamed_lesson_scope",
  "learning_science_routing",
  "session_adjustment_fidelity",
  "session_required_typed_recall",
  "scheduled_retrieval_format",
  // Retained for historical observations written before the two activity
  // contracts had distinct diagnostics.
  "session_activity_mix",
  "session_question_context",
  "session_content_specificity",
  "session_delivery_policy",
  "session_completion_contract",
  "session_substantive_teaching",
  "session_visible_adaptation",
  "session_outside_app_guidance",
  "session_source_grounding",
  "session_method_fidelity",
  "session_method_runtime",
  "session_method_outcome_adaptation",
  "session_concept_review_schedule",
  "session_practice_variation",
  "session_scaffold_progression",
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
  "knowledge_map_curriculum_alignment",
  "knowledge_map_provider_request",
  "diagnostic_response_status",
  "diagnostic_structure",
  "diagnostic_topic_coverage",
  "diagnostic_provider_request",
  "lesson_response_status",
  "lesson_stream",
  "lesson_provider_request",
]);

export const GenerationObservationSchema = z.object({
  generationType: z.enum(["plan", "session", "material_mapping", "knowledge_map", "diagnostic", "lesson"]),
  observationKind: z.enum(["generation", "usage"]).optional(),
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
    questionCount: z.number().int().min(0).max(12).optional(),
    curriculumRecognized: z.boolean().optional(),
    curriculumId: CurriculumIdSchema.optional(),
    curriculumMatchSource: CurriculumMatchSourceSchema.optional(),
    curriculumMatchConfidence: CurriculumMatchConfidenceSchema.optional(),
    latencyToFirstTokenMs: z.number().int().min(0).max(300_000).nullable().optional(),
    wordCount: z.number().int().min(0).max(20_000).optional(),
    streamCompleted: z.boolean().optional(),
    lessonFailureKind: z.enum([
      "provider_failed",
      "provider_incomplete",
      "provider_error_event",
      "provider_request_error",
      "stream_ended_without_completion",
      "stream_ended_without_content",
      "content_below_substance_threshold",
      "content_exceeded_time_budget",
      "request_aborted",
      "runtime_timeout",
      "allowance_exhausted",
    ]).optional(),
    lessonAction: z.enum(["skip_to_practice"]).optional(),
    lessonRequestId: z.string().uuid().optional(),
    sessionRequestId: z.string().uuid().optional(),
    planSessionId: z.string().uuid().optional(),
    recoveryMode: z.enum(["safe_study", "safe_learn"]).optional(),
    planFailureReason: z.enum(PLAN_FAILURE_REASONS).optional(),
    providerCategory: z.enum(PROVIDER_ERROR_CATEGORIES).optional(),
    providerStatus: z.number().int().min(100).max(599).optional(),
    providerCode: z.string().regex(/^[a-z0-9][a-z0-9_.-]{0,63}$/).optional(),
    planValidationIssueCode: z.enum(PLAN_QUALITY_ISSUE_CODES).optional(),
    sessionValidationIssueCode: z.enum(SESSION_VALIDATION_ISSUE_CODES).optional(),
  }).strict().optional(),
}).strict();

export type GenerationValidator = z.infer<typeof GenerationValidatorSchema>;
export type GenerationObservation = z.infer<typeof GenerationObservationSchema>;

export function generationEnvironment(): GenerationObservation["environment"] {
  if (process.env.VERCEL_ENV === "production") return "production";
  if (process.env.VERCEL_ENV === "preview") return "preview";
  return "development";
}
