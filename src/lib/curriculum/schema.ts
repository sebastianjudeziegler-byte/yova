import { z } from "zod";

export const CurriculumFrameworkSchema = z.enum(["ap", "ib", "sat", "act"]);
export const CurriculumProviderSchema = z.enum([
  "college_board",
  "international_baccalaureate",
  "act",
]);

// Keep ids bounded and enumerable so curriculum recognition can be recorded in
// privacy-safe telemetry without accepting a learner-provided string.
export const CurriculumIdSchema = z.enum([
  "college_board_ap_biology_2025_unit_1",
  "college_board_ap_biology_2025_unit_2",
  "ib_dp_biology_2025_theme_a",
  "ib_dp_biology_2025_theme_b",
  "ib_dp_biology_2025_theme_c",
  "ib_dp_biology_2025_theme_d",
  "college_board_sat_2025_reading_writing",
  "college_board_sat_2025_math",
  "act_enhanced_2025_english",
  "act_enhanced_2025_math",
  "act_enhanced_2025_reading",
  "act_enhanced_2025_science",
]);

export const CurriculumMatchSourceSchema = z.enum(["goal", "material", "both"]);
export const CurriculumMatchConfidenceSchema = z.enum(["exact", "alias"]);

export const CurriculumObjectiveSchema = z.object({
  code: z.string().trim().min(2).max(24),
  // Official assessment skill labels can be intentionally short (for
  // example, SAT Math publishes "Circles"). Preserve the source wording
  // instead of padding it to satisfy an arbitrary product minimum.
  text: z.string().trim().min(2).max(500),
  // IB's public subject brief publishes course-level assessment objectives,
  // not topic-specific learning objectives. Keeping the scope explicit avoids
  // presenting a course objective as if IB attached it to one topic node.
  scope: z.enum(["topic", "course"]).default("topic"),
});

export const CurriculumTopicDefinitionSchema = z.object({
  code: z.string().trim().min(2).max(24),
  title: z.string().trim().min(2).max(160),
  objectives: z.array(CurriculumObjectiveSchema).min(1).max(12),
  prerequisiteTopicCodes: z.array(z.string().trim().min(2).max(24)).max(12),
});

export const CurriculumDefinitionSchema = z.object({
  id: CurriculumIdSchema,
  framework: CurriculumFrameworkSchema,
  provider: CurriculumProviderSchema,
  program: z.string().trim().min(2).max(120),
  courseCode: z.string().trim().min(2).max(80),
  courseTitle: z.string().trim().min(2).max(160),
  version: z.string().trim().min(2).max(80),
  effectiveFrom: z.string().date(),
  sourceUrl: z.string().url().max(500),
  unitCode: z.string().trim().min(1).max(24),
  unitTitle: z.string().trim().min(2).max(160),
  examWeight: z.string().trim().min(2).max(40).nullable(),
  topics: z.array(CurriculumTopicDefinitionSchema).min(1).max(80),
});

export const CurriculumReferenceSchema = z.object({
  curriculumId: CurriculumIdSchema,
  topicCode: z.string().trim().min(2).max(24),
  objectiveCodes: z.array(z.string().trim().min(2).max(24)).min(1).max(12),
});

export const PlanCurriculumSchema = z.object({
  id: CurriculumIdSchema,
  framework: CurriculumFrameworkSchema,
  provider: CurriculumProviderSchema,
  program: z.string().trim().min(2).max(120),
  courseCode: z.string().trim().min(2).max(80),
  courseTitle: z.string().trim().min(2).max(160),
  version: z.string().trim().min(2).max(80),
  effectiveFrom: z.string().date(),
  sourceUrl: z.string().url().max(500),
  unitCode: z.string().trim().min(1).max(24),
  unitTitle: z.string().trim().min(2).max(160),
  examWeight: z.string().trim().min(2).max(40).nullable(),
  matchSource: CurriculumMatchSourceSchema,
  matchConfidence: CurriculumMatchConfidenceSchema,
});

export type CurriculumDefinition = z.infer<typeof CurriculumDefinitionSchema>;
export type CurriculumId = z.infer<typeof CurriculumIdSchema>;
export type CurriculumReference = z.infer<typeof CurriculumReferenceSchema>;
export type PlanCurriculum = z.infer<typeof PlanCurriculumSchema>;
