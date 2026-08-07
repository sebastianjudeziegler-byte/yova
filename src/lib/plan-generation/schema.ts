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
  profileSummary: z.string().trim().min(10).max(1_600),
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
  contentTargets: z.array(z.string().trim().min(5).max(180)).min(1).max(6),
  completionEvidence: z.array(z.string().trim().min(8).max(220)).min(1).max(4),
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
    contentTargets: z.array(z.string().min(1)).default([]),
    completionEvidence: z.array(z.string().min(1)).default([]),
    status: z.enum(["ready", "upcoming", "complete", "skipped"]),
  })).min(1).max(14),
});

export const PlanGenerationResponseSchema = z.object({
  plan: LearningPlanSchema,
  generation: z.object({
    mode: z.enum(["preview", "openai", "system"]),
    model: z.string().nullable(),
    notice: z.string().nullable(),
    requestId: z.string().min(1),
    durationMs: z.number().int().nonnegative(),
    persistence: z.literal("draft"),
  }),
});

export const PlanActivationRequestSchema = z.object({
  plan: LearningPlanSchema.extend({ status: z.literal("draft") }),
  generationRequest: PlanGenerationRequestSchema,
}).superRefine(({ plan, generationRequest }, context) => {
  const expectedSourceMode = generationRequest.materialMode === "upload"
    ? "user_materials"
    : "yova_generated";
  const expectedStudyMode = generationRequest.studyMode === "outside"
    ? "outside_yova"
    : "inside_yova";
  const planMaterialIds = plan.materials.map((material) => material.id).sort();
  const requestMaterialIds = generationRequest.materials.map((material) => material.id).sort();

  if (plan.sourceMode !== expectedSourceMode) {
    context.addIssue({ code: "custom", path: ["plan", "sourceMode"], message: "The draft source no longer matches the request." });
  }
  if (plan.studyMode !== expectedStudyMode) {
    context.addIssue({ code: "custom", path: ["plan", "studyMode"], message: "The draft study mode no longer matches the request." });
  }
  if (plan.learningIntent !== generationRequest.learningIntent) {
    context.addIssue({ code: "custom", path: ["plan", "learningIntent"], message: "The draft starting approach no longer matches the request." });
  }
  if (JSON.stringify(planMaterialIds) !== JSON.stringify(requestMaterialIds)) {
    context.addIssue({ code: "custom", path: ["plan", "materials"], message: "The draft materials no longer match the request." });
  }
  if (generationRequest.intent === "study_now" && plan.sessions.length !== 1) {
    context.addIssue({ code: "custom", path: ["plan", "sessions"], message: "A focused session must contain exactly one session." });
  }
  if (![plan.id, plan.learningItemId, ...plan.sessions.map((session) => session.id)].every((id) => z.string().uuid().safeParse(id).success)) {
    context.addIssue({ code: "custom", path: ["plan", "id"], message: "The draft contains an invalid identifier." });
  }
});

export const PlanActivationResponseSchema = z.object({
  plan: LearningPlanSchema.extend({ status: z.literal("active") }),
  activation: z.object({
    persistence: z.enum(["browser", "supabase"]),
    requestId: z.string().min(1),
  }),
});

export type PlanGenerationRequest = z.infer<typeof PlanGenerationRequestSchema>;
export type DiagnosticResponse = z.infer<typeof DiagnosticResponseSchema>;
export type GeneratedPlanDraft = z.infer<typeof GeneratedPlanDraftSchema>;
export type PlanGenerationResponse = z.infer<typeof PlanGenerationResponseSchema>;
export type PlanActivationRequest = z.infer<typeof PlanActivationRequestSchema>;
export type PlanActivationResponse = z.infer<typeof PlanActivationResponseSchema>;
