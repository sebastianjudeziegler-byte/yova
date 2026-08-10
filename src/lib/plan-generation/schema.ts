import { z } from "zod";
import { resolveLearningIntent } from "@/lib/learning/learning-intent";
import { MaterialUnderstandingSchema, PlanKnowledgeMapSchema } from "@/lib/knowledge-map/schema";

export const MaterialInputSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(180),
  mimeType: z.string().trim().min(1).max(100),
  sizeBytes: z.number().int().min(1).max(10 * 1024 * 1024),
  textContent: z.string().max(288_000).nullable(),
  processingStatus: z.literal("ready"),
  understanding: MaterialUnderstandingSchema.nullable().optional(),
});

export const StoredMaterialSchema = MaterialInputSchema.extend({
  textContent: z.null(),
});

export const DiagnosticResponseSchema = z.object({
  questionId: z.string().uuid().optional(),
  topicId: z.string().uuid().optional(),
  question: z.string().trim().min(3).max(240),
  answer: z.string().trim().min(1).max(160),
  evaluation: z.enum(["correct", "incorrect", "self_report"]),
});

export const PlanDiagnosticQuestionSchema = z.object({
  id: z.string().uuid(),
  topicId: z.string().uuid(),
  prompt: z.string().trim().min(12).max(500),
  options: z.array(z.string().trim().min(1).max(180)).min(3).max(4),
  correctAnswer: z.string().trim().min(1).max(180),
});

export const PlanDiagnosticPreparationResponseSchema = z.object({
  knowledgeMap: PlanKnowledgeMapSchema,
  questions: z.array(PlanDiagnosticQuestionSchema).min(1).max(8),
  generation: z.object({
    requestId: z.string().uuid(),
    durationMs: z.number().int().nonnegative(),
    mode: z.enum(["preview", "openai", "system"]),
  }),
});

export const PlanGenerationRequestSchema = z.object({
  intent: z.enum(["plan", "study_now"]).default("plan"),
  learningIntent: z.enum(["learn", "study"]),
  goal: z.string().trim().min(10).max(600),
  startingContext: z.string().trim().max(800).optional(),
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
  // Work products such as essays and projects do not always need an academic
  // knowledge check before YOVA can organize a useful plan.
  diagnosticResponses: z.array(DiagnosticResponseSchema).max(12),
  availability: z.array(z.object({
    day: z.string().trim().min(1).max(20),
    window: z.string().trim().min(1).max(40),
    minutes: z.number().int().min(5).max(180),
  })).min(1).max(14),
  profileSummary: z.string().trim().min(10).max(1_600),
  knowledgeMap: PlanKnowledgeMapSchema.optional(),
  mapCorrection: z.string().trim().max(800).optional(),
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
  methodReason: z.string().trim().min(10).max(280).describe(
    "Plain-language reason grounded in the task or current knowledge. It may mention a reported preference as tentative context, but must never claim a fixed learning style, brain type, diagnosis, or that the learner learns best in one way.",
  ),
  scheduledFor: z.string().datetime({ offset: true }),
  estimatedMinutes: z.number().int().min(5).max(180),
  amountLabel: z.string().trim().min(3).max(100),
  learningMode: z.enum(["learn", "study"]).describe(
    "Use learn when the session's first job is building a new mental model or procedure. Use study when its first job is retrieving, applying, practicing, assessing, or repairing knowledge already encountered. Every multi-session learn-first plan must later include at least one study session.",
  ),
  topicIds: z.array(z.string().uuid()).min(1).max(6),
  contentTargets: z.array(z.string().trim().min(5).max(180)).min(1).max(6),
  completionEvidence: z.array(z.string().trim().min(8).max(220).describe(
    "Observable evidence produced by the learner. Start with an active verb such as Explain, Solve, Apply, Classify, Compare, Construct, Draft, Recall, or Demonstrate. Never define completion as reading, reviewing, watching, exposure, or time spent.",
  )).min(1).max(4),
});

export const GeneratedPlanDraftSchema = z.object({
  title: z.string().trim().min(3).max(90),
  topic: z.string().trim().min(3).max(180),
  kind: z.enum(["test", "topic", "course", "book", "skill"]),
  deadline: z.string().datetime({ offset: true }).nullable(),
  rationale: z.string().trim().min(20).max(900).describe(
    "Explain the plan sequence using the goal, starting knowledge, time, and tentative delivery preferences. Never claim a fixed learning style, brain type, diagnosis, or that the learner learns best in one way.",
  ),
  deferredTopics: z.array(z.object({
    topicId: z.string().uuid(),
    reason: z.string().trim().min(8).max(300),
  })).max(40),
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
  creationIntent: z.enum(["plan", "study_now"]).default("plan"),
  rationale: z.string().min(1),
  createdAt: z.string().datetime({ offset: true }),
  knowledgeMap: PlanKnowledgeMapSchema.optional(),
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
    topicIds: z.array(z.string().uuid()).default([]),
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
  const expectedLearningIntent = resolveLearningIntent({
    goal: generationRequest.goal,
    startingPoint: generationRequest.startingContext,
    diagnosticResponses: generationRequest.diagnosticResponses,
  }).intent;

  if (plan.sourceMode !== expectedSourceMode) {
    context.addIssue({ code: "custom", path: ["plan", "sourceMode"], message: "The draft source no longer matches the request." });
  }
  if (plan.studyMode !== expectedStudyMode) {
    context.addIssue({ code: "custom", path: ["plan", "studyMode"], message: "The draft study mode no longer matches the request." });
  }
  // Generation resolves the starting approach from the learner's latest
  // evidence on the server. Activation must repeat that same decision instead
  // of trusting the older client recommendation that was sent with the draft.
  if (plan.learningIntent !== expectedLearningIntent) {
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
export type PlanDiagnosticQuestion = z.infer<typeof PlanDiagnosticQuestionSchema>;
export type PlanDiagnosticPreparationResponse = z.infer<typeof PlanDiagnosticPreparationResponseSchema>;
export type GeneratedPlanDraft = z.infer<typeof GeneratedPlanDraftSchema>;
export type PlanGenerationResponse = z.infer<typeof PlanGenerationResponseSchema>;
export type PlanActivationRequest = z.infer<typeof PlanActivationRequestSchema>;
export type PlanActivationResponse = z.infer<typeof PlanActivationResponseSchema>;
