import { z } from "zod";
import { CurriculumReferenceSchema, PlanCurriculumSchema } from "@/lib/curriculum/schema";

export const MaterialRoleSchema = z.enum(["content_source", "scope_outline", "mixed"]);
export const MaterialSectionRoleSchema = z.enum(["content_source", "scope_outline"]);
export const KnowledgeTopicStatusSchema = z.enum(["not_started", "taught", "evidenced", "secure"]);
export const PlanScopeBandSchema = z.enum(["focused_skill", "unit_or_exam", "broad_course"]);

const DANGLING_SCOPE_LABEL_WORDS = [
  "a",
  "aboard",
  "about",
  "above",
  "across",
  "after",
  "against",
  "along",
  "although",
  "amid",
  "among",
  "an",
  "and",
  "around",
  "as",
  "at",
  "because",
  "before",
  "behind",
  "below",
  "beneath",
  "beside",
  "besides",
  "between",
  "beyond",
  "but",
  "by",
  "concerning",
  "considering",
  "despite",
  "down",
  "during",
  "except",
  "excluding",
  "following",
  "for",
  "from",
  "given",
  "if",
  "in",
  "including",
  "inside",
  "into",
  "like",
  "near",
  "nor",
  "notwithstanding",
  "of",
  "off",
  "on",
  "once",
  "onto",
  "opposite",
  "or",
  "out",
  "outside",
  "over",
  "past",
  "per",
  "provided",
  "regarding",
  "round",
  "save",
  "since",
  "so",
  "that",
  "the",
  "though",
  "through",
  "throughout",
  "till",
  "to",
  "toward",
  "towards",
  "under",
  "underneath",
  "unless",
  "unlike",
  "until",
  "up",
  "upon",
  "versus",
  "via",
  "when",
  "whenever",
  "where",
  "whereas",
  "wherever",
  "whether",
  "while",
  "with",
  "within",
  "without",
  "worth",
  "yet",
] as const;

const caseInsensitivePattern = (word: string) => Array.from(word, (letter) => (
  `[${letter.toLocaleLowerCase()}${letter.toLocaleUpperCase()}]`
)).join("");

// JSON Schema has no separate regex-flags field, so spell out case-insensitive
// letters to keep the provider-facing `pattern` and Zod's runtime check equal.
const COMPLETE_SCOPE_LABEL_PATTERN = new RegExp(
  `^(?![\\s\\S]*\\b(?:${DANGLING_SCOPE_LABEL_WORDS.map(caseInsensitivePattern).join("|")})[\\s.!?,:;'\"’”)}\\]]*$)[\\s\\S]+$`,
);

export const InitialTopicEvidenceSchema = z.object({
  source: z.literal("placement_check"),
  outcome: z.enum(["demonstrated", "gap"]),
  observedAt: z.string().datetime({ offset: true }),
}).nullable().default(null);

export const PlacementCheckStateSchema = z.object({
  status: z.enum(["available", "skipped", "completed"]).default("available"),
  completedAt: z.string().datetime({ offset: true }).nullable().default(null),
  demonstratedTopicIds: z.array(z.string().uuid()).max(40).default([]),
  gapTopicIds: z.array(z.string().uuid()).max(40).default([]),
}).default({
  status: "available",
  completedAt: null,
  demonstratedTopicIds: [],
  gapTopicIds: [],
});

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
  subtopics: z.array(z.string().trim().min(2).max(500)).max(12).default([]),
  prerequisiteTopicIds: z.array(z.string().uuid()).max(12).default([]),
  status: KnowledgeTopicStatusSchema.default("not_started"),
  initialEvidence: InitialTopicEvidenceSchema,
  sourceReferences: z.array(MaterialChunkReferenceSchema).max(40).default([]),
  origin: z.enum(["material", "ai_generated"]),
  deferred: z.object({ reason: z.string().trim().min(8).max(300) }).nullable().default(null),
  // Optional keeps plans/material maps written before curriculum support readable.
  curriculumReference: CurriculumReferenceSchema.nullable().optional(),
});

const ScopeJudgmentFields = {
  band: PlanScopeBandSchema,
  label: z.string().trim().min(3).max(80),
  minimumSessions: z.number().int().min(1).max(14),
  recommendedSessions: z.number().int().min(1).max(14),
  maximumSessions: z.number().int().min(1).max(14),
  minimumTeachingSessions: z.number().int().min(0).max(14),
  explanation: z.string().trim().min(20).max(500),
};

const orderedSessionBounds = (value: {
  minimumSessions: number;
  recommendedSessions: number;
  maximumSessions: number;
}) => value.minimumSessions <= value.recommendedSessions
  && value.recommendedSessions <= value.maximumSessions;

export const ScopeJudgmentSchema = z.object(ScopeJudgmentFields).refine(orderedSessionBounds, {
  message: "Session bounds must be ordered from minimum to maximum.",
});

// Existing persisted maps remain readable through ScopeJudgmentSchema. New
// provider output must satisfy this stricter boundary before it can be stored.
export const GeneratedScopeLabelSchema = ScopeJudgmentFields.label.regex(
  COMPLETE_SCOPE_LABEL_PATTERN,
  "Scope label must be a complete phrase, not end with a conjunction, preposition, or article.",
);

export const GeneratedScopeJudgmentSchema = z.object({
  ...ScopeJudgmentFields,
  label: GeneratedScopeLabelSchema,
}).refine(orderedSessionBounds, {
  message: "Session bounds must be ordered from minimum to maximum.",
});

export const PlanKnowledgeMapSchema = z.object({
  version: z.literal(1),
  scopeJudgment: ScopeJudgmentSchema,
  topics: z.array(KnowledgeMapTopicSchema).min(1).max(40),
  placementCheck: PlacementCheckStateSchema,
  // Recognition is deliberately absent for unsupported or ambiguous curricula.
  curriculum: PlanCurriculumSchema.nullable().optional(),
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
