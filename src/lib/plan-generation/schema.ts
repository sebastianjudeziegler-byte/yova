import { z } from "zod";

export const MaterialInputSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(180),
  mimeType: z.string().trim().min(1).max(100),
  sizeBytes: z.number().int().min(1).max(10 * 1024 * 1024),
  textContent: z.string().max(50_000).nullable(),
  processingStatus: z.literal("ready"),
});

export const StoredMaterialSchema = MaterialInputSchema.extend({
  textContent: z.null(),
});

export const DiagnosticResponseSchema = z.object({
  question: z.string().trim().min(3).max(240),
  answer: z.string().trim().min(1).max(160),
  evaluation: z.enum(["correct", "incorrect", "self_report"]),
});

export const PlanGenerationRequestSchema = z.object({
  intent: z.enum(["plan", "study_now"]).default("plan"),
  learningIntent: z.enum(["learn", "study"]),
  goal: z.string().trim().min(10).max(600),
  materialMode: z.enum(["upload", "none"]),
  materials: z.array(MaterialInputSchema).max(5),
  studyMode: z.enum(["inside", "outside"]),
  deadline: z.string().datetime({ offset: true }).nullable().default(null),
  timeZone: z.string().trim().min(1).max(80).refine((value) => {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
      return true;
    } catch {
      return false;
    }
  }, "Use a valid time zone."),
  diagnosticResponses: z.array(DiagnosticResponseSchema).min(1).max(12),
  availability: z.array(z.object({
    day: z.string().trim().min(1).max(20),
    window: z.string().trim().min(1).max(40),
    minutes: z.number().int().min(5).max(180),
  })).min(1).max(14),
  profileSummary: z.string().trim().min(10).max(800),
}).superRefine((value, context) => {
  if (value.materialMode === "upload" && value.materials.length === 0) {
    context.addIssue({ code: "custom", path: ["materials"], message: "Add at least one material or choose no materials." });
  }
  if (value.materialMode === "none" && value.materials.length > 0) {
    context.addIssue({ code: "custom", path: ["materials"], message: "Materials must be empty when no materials is selected." });
  }
});

export const GeneratedSessionDraftSchema = z.object({
  title: z.string().trim().min(3).max(90),
  objective: z.string().trim().min(10).max(280),
  method: z.string().trim().min(3).max(80),
  methodReason: z.string().trim().min(10).max(280),
  scheduledFor: z.string().datetime({ offset: true }),
  estimatedMinutes: z.number().int().min(5).max(180),
  amountLabel: z.string().trim().min(3).max(100),
  learningMode: z.enum(["learn", "study"]),
});

export const GeneratedPlanDraftSchema = z.object({
  title: z.string().trim().min(3).max(90),
  topic: z.string().trim().min(3).max(180),
  kind: z.enum(["test", "topic", "course", "book", "skill"]),
  deadline: z.string().datetime({ offset: true }).nullable(),
  rationale: z.string().trim().min(20).max(900),
  sessions: z.array(GeneratedSessionDraftSchema).min(1).max(14),
});

export const LearningPlanSchema = z.object({
  id: z.string().min(1),
  learningItemId: z.string().min(1),
  title: z.string().min(1),
  topic: z.string().min(1),
  kind: z.enum(["test", "topic", "course", "book", "skill"]),
  deadline: z.string().datetime({ offset: true }).nullable(),
  status: z.enum(["draft", "active", "completed", "archived"]),
  sourceMode: z.enum(["user_materials", "yova_generated"]),
  studyMode: z.enum(["inside_yova", "outside_yova"]),
  learningIntent: z.enum(["learn", "study"]),
  rationale: z.string().min(1),
  createdAt: z.string().datetime({ offset: true }),
  materials: z.array(StoredMaterialSchema).max(5),
  sessions: z.array(z.object({
    id: z.string().min(1),
    sequence: z.number().int().positive(),
    title: z.string().min(1),
    objective: z.string().min(1),
    method: z.string().min(1),
    methodReason: z.string().min(1),
    scheduledFor: z.string().datetime({ offset: true }),
    estimatedMinutes: z.number().int().min(5).max(180),
    amountLabel: z.string().min(1),
    learningMode: z.enum(["learn", "study"]),
    status: z.enum(["ready", "upcoming", "complete", "skipped"]),
  })).min(1).max(14),
});

export const PlanGenerationResponseSchema = z.object({
  plan: LearningPlanSchema,
  generation: z.object({
    mode: z.enum(["preview", "openai"]),
    model: z.string().nullable(),
    notice: z.string().nullable(),
    requestId: z.string().min(1),
    durationMs: z.number().int().nonnegative(),
    persistence: z.enum(["browser", "supabase"]),
  }),
});

export type PlanGenerationRequest = z.infer<typeof PlanGenerationRequestSchema>;
export type DiagnosticResponse = z.infer<typeof DiagnosticResponseSchema>;
export type GeneratedPlanDraft = z.infer<typeof GeneratedPlanDraftSchema>;
export type PlanGenerationResponse = z.infer<typeof PlanGenerationResponseSchema>;
