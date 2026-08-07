import { z } from "zod";
import { CORE_METHOD_IDS, LEARNING_TASK_TYPES } from "@/lib/learning/method-catalog";
import { CALIBRATION_PATTERNS } from "@/lib/learning/confidence-calibration";
import { METHOD_PHASES } from "@/lib/learning/method-fidelity";

export const SessionGenerationRequestSchema = z.object({
  planId: z.string().uuid(),
  planSessionId: z.string().uuid(),
  sessionAdjustment: z.object({
    familiarity: z.enum(["as_planned", "already_know", "need_teaching", "challenge_me"]),
    availableMinutes: z.number().int().min(10).max(90).nullable(),
    note: z.string().trim().max(500),
  }).optional(),
  previewContext: z.object({
    learningGoal: z.object({
      title: z.string().trim().min(2).max(160),
      topic: z.string().trim().min(2).max(500),
      kind: z.enum(["test", "topic", "course", "book", "skill"]),
      deadline: z.string().trim().max(80).nullable(),
      sourceMode: z.enum(["user_materials", "yova_generated"]),
      studyMode: z.enum(["inside_yova", "outside_yova"]),
      learningIntent: z.enum(["learn", "study"]),
    }),
    planRationale: z.string().trim().min(10).max(1_200),
    session: z.object({
      title: z.string().trim().min(2).max(160),
      objective: z.string().trim().min(5).max(800),
      method: z.string().trim().min(2).max(160),
      methodReason: z.string().trim().min(5).max(800),
      estimatedMinutes: z.number().int().min(5).max(180),
      learningMode: z.enum(["learn", "study"]),
      contentTargets: z.array(z.string().trim().min(5).max(180)).max(6).default([]),
      completionEvidence: z.array(z.string().trim().min(8).max(220)).max(4).default([]),
    }),
    learnerProfile: z.object({
      commonBlocker: z.string().trim().max(240).nullable(),
      guidancePreference: z.string().trim().max(240).nullable(),
      explanationPreference: z.string().trim().max(240).nullable(),
      focusFrequency: z.string().trim().max(240).nullable(),
      startingPattern: z.string().trim().max(240).nullable(),
      primaryImprovementGoal: z.string().trim().max(240).nullable(),
      processingPreference: z.string().trim().max(240).nullable().optional(),
      memoryChallenge: z.string().trim().max(240).nullable().optional(),
      supportPreference: z.string().trim().max(240).nullable().optional(),
      workspacePreference: z.string().trim().max(240).nullable().optional(),
      freeformContext: z.string().trim().max(800).nullable().optional(),
      observationCorrection: z.string().trim().max(500).nullable().optional(),
    }).nullable(),
    recentResults: z.array(z.object({
      methodId: z.enum(CORE_METHOD_IDS).nullable(),
      correctAnswers: z.number().int().min(0).max(100).nullable(),
      totalAnswers: z.number().int().min(0).max(100).nullable(),
      feedback: z.enum(["too_easy", "about_right", "too_difficult"]).nullable(),
      observedGap: z.string().trim().max(500).nullable(),
      plannedMinutes: z.number().int().min(1).max(300).nullable(),
      actualMinutes: z.number().int().min(1).max(300).nullable(),
      calibrationPattern: z.enum(CALIBRATION_PATTERNS),
    })).max(8),
    recentInterruptions: z.array(z.object({
      occurredAt: z.string().datetime({ offset: true }),
      plannedMinutes: z.number().int().min(1).max(300).nullable(),
      actualMinutes: z.number().int().min(1).max(300).nullable(),
      completedSteps: z.number().int().min(0).max(20).nullable(),
      totalSteps: z.number().int().min(1).max(20).nullable(),
    })).max(4),
    conceptSignals: z.array(z.object({
      concept: z.string().trim().min(2).max(120),
      attempts: z.number().int().min(1).max(100),
      secureAttempts: z.number().int().min(0).max(100),
      needsReviewAttempts: z.number().int().min(0).max(100),
      lastOutcome: z.enum(["secure", "needs_review"]),
      lastObservedAt: z.string().datetime({ offset: true }),
      status: z.enum(["early_signal", "needs_review", "showing_strength"]),
    })).max(20),
    scaffoldSignals: z.array(z.object({
      concept: z.string().trim().min(2).max(120),
      checks: z.number().int().min(1).max(100),
      supportedChecks: z.number().int().min(0).max(100),
      independentChecks: z.number().int().min(0).max(100),
      secureIndependentChecks: z.number().int().min(0).max(100),
      latestOutcome: z.enum(["secure", "needs_review"]),
      latestPhase: z.enum(METHOD_PHASES),
      status: z.enum(["collect_evidence", "restore_support", "fade_support", "independent_transfer"]),
      evidence: z.string().trim().min(10).max(500),
      guidance: z.string().trim().min(10).max(500),
    })).max(20),
  }).optional(),
});

export type SessionGenerationRequest = z.infer<typeof SessionGenerationRequestSchema>;
export type SessionAdjustment = NonNullable<SessionGenerationRequest["sessionAdjustment"]>;
export type PreviewSessionGenerationContext = NonNullable<
  SessionGenerationRequest["previewContext"]
>;

export const SessionMethodBriefingSchema = z.object({
  learningMode: z.enum(["learn", "study"]),
  taskType: z.enum(LEARNING_TASK_TYPES),
  methodId: z.enum(CORE_METHOD_IDS),
  name: z.string().trim().min(3).max(90),
  what: z.string().trim().min(15).max(280),
  why: z.string().trim().min(20).max(500),
  how: z.array(z.string().trim().min(8).max(240)).min(2).max(5),
  completion: z.string().trim().min(15).max(300),
  personalization: z.array(z.string().trim().min(10).max(280)).max(3),
});

export const SessionCoverageSchema = z.object({
  focus: z.string().trim().min(10).max(240),
  essentialIdeas: z.array(z.string().trim().min(5).max(180)).min(1).max(4),
  completionEvidence: z.array(z.string().trim().min(8).max(220)).min(1).max(3),
  evidenceMap: z.array(z.object({
    essentialIdea: z.string().trim().min(5).max(180),
    activityConcept: z.string().trim().min(2).max(120),
  })).min(1).max(4),
  deferredContent: z.array(z.string().trim().min(5).max(180)).max(4),
});

export const TeachingBlockSchema = z.object({
  keyIdea: z.string().trim().min(10).max(220),
  explanation: z.string().trim().min(40).max(700),
  example: z.object({
    setup: z.string().trim().min(10).max(180),
    steps: z.array(z.string().trim().min(8).max(200)).min(2).max(5),
    takeaway: z.string().trim().min(10).max(180),
  }).nullable(),
  commonMistake: z.object({
    mistake: z.string().trim().min(8).max(240),
    correction: z.string().trim().min(10).max(300),
  }).nullable(),
});

export const GeneratedSessionActivitySchema = z.object({
  methodPhase: z.enum(METHOD_PHASES),
  concept: z.string().trim().min(2).max(120).nullable(),
  estimatedMinutes: z.number().int().min(1).max(20),
  requiredForCompletion: z.boolean(),
  label: z.string().trim().min(2).max(50),
  title: z.string().trim().min(3).max(140),
  body: z.string().trim().min(10).max(320),
  teaching: TeachingBlockSchema.nullable(),
  type: z.enum(["instruction", "multiple_choice", "free_response", "reflection"]),
  choices: z.array(z.string().trim().min(1).max(220)).max(5),
  correctAnswer: z.string().trim().min(1).max(600).nullable(),
  feedback: z.string().trim().min(20).max(500).nullable(),
}).superRefine((activity, context) => {
  if (activity.type === "multiple_choice") {
    if (!activity.concept) {
      context.addIssue({ code: "custom", path: ["concept"], message: "Knowledge checks need a named concept." });
    }
    if (activity.choices.length < 3) {
      context.addIssue({ code: "custom", path: ["choices"], message: "Multiple-choice activities need at least three choices." });
    }
    if (!activity.correctAnswer || !activity.choices.includes(activity.correctAnswer)) {
      context.addIssue({ code: "custom", path: ["correctAnswer"], message: "The correct answer must exactly match one choice." });
    }
    if (!activity.feedback) {
      context.addIssue({ code: "custom", path: ["feedback"], message: "Knowledge checks need explanatory feedback." });
    }
  } else if (activity.type === "free_response") {
    if (!activity.concept) {
      context.addIssue({ code: "custom", path: ["concept"], message: "Free-response activities need a named concept." });
    }
    if (activity.choices.length) {
      context.addIssue({ code: "custom", path: ["choices"], message: "Free-response activities cannot contain choices." });
    }
    if (!activity.correctAnswer || !activity.feedback) {
      context.addIssue({ code: "custom", path: ["correctAnswer"], message: "Free-response activities need a reference answer and feedback." });
    }
  } else if (activity.choices.length || activity.correctAnswer || activity.concept) {
    context.addIssue({ code: "custom", path: ["choices"], message: "Non-question activities cannot contain question data." });
  }
  if (activity.methodPhase === "model" && !activity.teaching) {
    context.addIssue({ code: "custom", path: ["teaching"], message: "Model activities need a structured teaching block." });
  }
  if (activity.type !== "instruction" && activity.teaching) {
    context.addIssue({ code: "custom", path: ["teaching"], message: "Only instruction activities can contain teaching blocks." });
  }
});

export const SessionSourceGroundingSchema = z.object({
  mode: z.enum(["materials_only", "materials_plus_ai"]),
  summary: z.string().trim().min(20).max(420),
  sourceNames: z.array(z.string().trim().min(1).max(180)).min(1).max(5),
  anchors: z.array(z.object({
    sourceName: z.string().trim().min(1).max(180),
    excerpt: z.string().trim().min(12).max(240),
    usedFor: z.string().trim().min(10).max(240),
  })).min(1).max(4),
  supplements: z.array(z.object({
    topic: z.string().trim().min(2).max(140),
    reason: z.string().trim().min(15).max(280),
  })).max(3),
}).superRefine((grounding, context) => {
  if (grounding.mode === "materials_only" && grounding.supplements.length > 0) {
    context.addIssue({ code: "custom", path: ["supplements"], message: "Material-only sessions cannot list AI supplements." });
  }
  if (grounding.mode === "materials_plus_ai" && grounding.supplements.length === 0) {
    context.addIssue({ code: "custom", path: ["supplements"], message: "Supplemented sessions must explain what YOVA added." });
  }
});

export const SessionSupportPlanSchema = z.object({
  level: z.enum(["supported_start", "fading", "independent_start"]),
  title: z.string().trim().min(3).max(180),
  explanation: z.string().trim().min(20).max(600),
  evidenceLabel: z.string().trim().min(3).max(180),
  concept: z.string().trim().min(2).max(120).nullable(),
});

export const GeneratedSessionDraftSchema = z.object({
  rationale: z.string().trim().min(20).max(700),
  coverage: SessionCoverageSchema,
  methodBriefing: SessionMethodBriefingSchema,
  sourceGrounding: SessionSourceGroundingSchema.nullable(),
  activities: z.array(GeneratedSessionActivitySchema).min(3).max(8),
}).superRefine((session, context) => {
  if (!session.activities.some((activity) => activity.type === "multiple_choice")) {
    context.addIssue({ code: "custom", path: ["activities"], message: "A guided session needs at least one knowledge check." });
  }
  if (!session.activities.some((activity) => activity.type === "free_response")) {
    context.addIssue({ code: "custom", path: ["activities"], message: "A guided session needs at least one typed active-recall attempt." });
  }
  const firstActivity = session.activities[0];
  if (session.methodBriefing.learningMode === "learn" && firstActivity?.type !== "instruction") {
    context.addIssue({ code: "custom", path: ["activities", 0], message: "Teaching-first sessions must begin with a concise explanation or model." });
  }
  if (session.methodBriefing.learningMode === "learn" && !firstActivity?.teaching) {
    context.addIssue({ code: "custom", path: ["activities", 0, "teaching"], message: "Teaching-first sessions must begin with a structured subject lesson, not a paragraph in the instruction field." });
  }
  if (session.methodBriefing.learningMode === "study" && firstActivity?.type !== "multiple_choice" && firstActivity?.type !== "free_response") {
    context.addIssue({ code: "custom", path: ["activities", 0], message: "Practice-first sessions must begin with an unsupported attempt." });
  }
  if (!session.activities.some((activity) => activity.requiredForCompletion && (activity.type === "multiple_choice" || activity.type === "free_response"))) {
    context.addIssue({ code: "custom", path: ["activities"], message: "Completion must require at least one knowledge-producing attempt." });
  }
});

export const CachedGeneratedSessionSchema = GeneratedSessionDraftSchema.extend({
  schemaVersion: z.literal(11),
  model: z.string().min(1),
  generatedAt: z.string().datetime({ offset: true }),
  supportPlan: SessionSupportPlanSchema.optional(),
});

export const SessionGenerationResponseSchema = z.object({
  planSessionId: z.string().uuid(),
  session: CachedGeneratedSessionSchema,
  generation: z.object({
    mode: z.enum(["openai", "cache"]),
    persistence: z.enum(["browser", "supabase"]),
  }),
});

export type GeneratedSessionDraft = z.infer<typeof GeneratedSessionDraftSchema>;
export type SessionMethodBriefing = z.infer<typeof SessionMethodBriefingSchema>;
export type SessionCoverage = z.infer<typeof SessionCoverageSchema>;
export type TeachingBlock = z.infer<typeof TeachingBlockSchema>;
export type SessionSourceGrounding = z.infer<typeof SessionSourceGroundingSchema>;
export type SessionGenerationResponse = z.infer<typeof SessionGenerationResponseSchema>;
