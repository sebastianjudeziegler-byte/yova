import { z } from "zod";

export const MaterialRoleSchema = z.enum(["content_source", "scope_outline", "mixed"]);
export const MaterialSectionRoleSchema = z.enum(["content_source", "scope_outline"]);
export const KnowledgeTopicStatusSchema = z.enum(["not_started", "taught", "evidenced", "secure"]);
export const PlanScopeBandSchema = z.enum(["focused_skill", "unit_or_exam", "broad_course"]);

export const MaterialChunkReferenceSchema = z.object({
  materialId: z.string().uuid(),
  chunkId: z.string().uuid(),
  chunkIndex: z.number().int().nonnegative(),
  startCharacter: z.number().int().nonnegative(),
  endCharacter: z.number().int().positive(),
  locationLabel: z.string().trim().min(1).max(120),
  sectionRole: MaterialSectionRoleSchema,
});

export const KnowledgeMapTopicSchema = z.object({
  id: z.string().uuid(),
  title: z.string().trim().min(2).max(140),
  description: z.string().trim().min(8).max(400),
  subtopics: z.array(z.string().trim().min(2).max(140)).max(12).default([]),
  prerequisiteTopicIds: z.array(z.string().uuid()).max(12).default([]),
  status: KnowledgeTopicStatusSchema.default("not_started"),
  sourceReferences: z.array(MaterialChunkReferenceSchema).max(40).default([]),
  origin: z.enum(["material", "ai_generated"]),
  deferred: z.object({ reason: z.string().trim().min(8).max(300) }).nullable().default(null),
});

export const ScopeJudgmentSchema = z.object({
  band: PlanScopeBandSchema,
  label: z.string().trim().min(3).max(80),
  minimumSessions: z.number().int().min(1).max(14),
  recommendedSessions: z.number().int().min(1).max(14),
  maximumSessions: z.number().int().min(1).max(14),
  minimumTeachingSessions: z.number().int().min(0).max(14),
  explanation: z.string().trim().min(20).max(500),
}).refine((value) => value.minimumSessions <= value.recommendedSessions
  && value.recommendedSessions <= value.maximumSessions, {
  message: "Session bounds must be ordered from minimum to maximum.",
});

export const PlanKnowledgeMapSchema = z.object({
  version: z.literal(1),
  scopeJudgment: ScopeJudgmentSchema,
  topics: z.array(KnowledgeMapTopicSchema).min(1).max(40),
});

export const MaterialUnderstandingSchema = z.object({
  version: z.literal(1),
  role: MaterialRoleSchema,
  roleReason: z.string().trim().min(10).max(400),
  mixedSections: z.array(z.object({
    chunkIds: z.array(z.string().uuid()).min(1).max(40),
    role: MaterialSectionRoleSchema,
    description: z.string().trim().min(3).max(180),
  })).max(20).default([]),
  topics: z.array(KnowledgeMapTopicSchema).min(1).max(40),
  chunkCount: z.number().int().positive(),
  mappedAt: z.string().datetime({ offset: true }),
});

export type MaterialRole = z.infer<typeof MaterialRoleSchema>;
export type MaterialSectionRole = z.infer<typeof MaterialSectionRoleSchema>;
export type MaterialChunkReference = z.infer<typeof MaterialChunkReferenceSchema>;
export type KnowledgeMapTopic = z.infer<typeof KnowledgeMapTopicSchema>;
export type ScopeJudgment = z.infer<typeof ScopeJudgmentSchema>;
export type PlanKnowledgeMap = z.infer<typeof PlanKnowledgeMapSchema>;
export type MaterialUnderstanding = z.infer<typeof MaterialUnderstandingSchema>;
