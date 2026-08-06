import { z } from "zod";
import { CORE_METHOD_IDS, LEARNING_TASK_TYPES } from "@/lib/learning/method-catalog";

export const SessionGenerationRequestSchema = z.object({
  planId: z.string().uuid(),
  planSessionId: z.string().uuid(),
  previewContext: z.object({
    learningGoal: z.object({
      title: z.string().trim().min(2).max(160),
      topic: z.string().trim().min(2).max(500),
      kind: z.enum(["test", "topic", "course", "book", "skill"]),
      deadline: z.string().trim().max(80).nullable(),
      sourceMode: z.enum(["user_materials", "yova_generated"]),
      studyMode: z.enum(["inside_yova", "outside_yova"]),
    }),
    planRationale: z.string().trim().min(10).max(1_200),
    session: z.object({
      title: z.string().trim().min(2).max(160),
      objective: z.string().trim().min(5).max(800),
      method: z.string().trim().min(2).max(160),
      methodReason: z.string().trim().min(5).max(800),
      estimatedMinutes: z.number().int().min(5).max(180),
    }),
    learnerProfile: z.object({
      commonBlocker: z.string().trim().max(240).nullable(),
      guidancePreference: z.string().trim().max(240).nullable(),
      explanationPreference: z.string().trim().max(240).nullable(),
      focusFrequency: z.string().trim().max(240).nullable(),
      startingPattern: z.string().trim().max(240).nullable(),
      primaryImprovementGoal: z.string().trim().max(240).nullable(),
    }).nullable(),
    recentResults: z.array(z.object({
      correctAnswers: z.number().int().min(0).max(100).nullable(),
      totalAnswers: z.number().int().min(0).max(100).nullable(),
      observedGap: z.string().trim().max(500).nullable(),
      plannedMinutes: z.number().int().min(1).max(300).nullable(),
      actualMinutes: z.number().int().min(1).max(300).nullable(),
    })).max(3),
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
  }).optional(),
});

export type SessionGenerationRequest = z.infer<typeof SessionGenerationRequestSchema>;
export type PreviewSessionGenerationContext = NonNullable<
  SessionGenerationRequest["previewContext"]
>;

export const SessionMethodBriefingSchema = z.object({
  taskType: z.enum(LEARNING_TASK_TYPES),
  methodId: z.enum(CORE_METHOD_IDS),
  name: z.string().trim().min(3).max(90),
  what: z.string().trim().min(15).max(280),
  why: z.string().trim().min(20).max(500),
  how: z.array(z.string().trim().min(8).max(240)).min(2).max(5),
  completion: z.string().trim().min(15).max(300),
  personalization: z.array(z.string().trim().min(10).max(280)).max(3),
});

export const GeneratedSessionActivitySchema = z.object({
  concept: z.string().trim().min(2).max(120).nullable(),
  label: z.string().trim().min(2).max(50),
  title: z.string().trim().min(3).max(140),
  body: z.string().trim().min(10).max(900),
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
});

export const GeneratedSessionDraftSchema = z.object({
  rationale: z.string().trim().min(20).max(700),
  methodBriefing: SessionMethodBriefingSchema,
  activities: z.array(GeneratedSessionActivitySchema).min(3).max(8),
}).superRefine((session, context) => {
  if (!session.activities.some((activity) => activity.type === "multiple_choice")) {
    context.addIssue({ code: "custom", path: ["activities"], message: "A guided session needs at least one knowledge check." });
  }
  if (!session.activities.some((activity) => activity.type === "free_response")) {
    context.addIssue({ code: "custom", path: ["activities"], message: "A guided session needs at least one typed active-recall attempt." });
  }
});

export const CachedGeneratedSessionSchema = GeneratedSessionDraftSchema.extend({
  schemaVersion: z.literal(4),
  model: z.string().min(1),
  generatedAt: z.string().datetime({ offset: true }),
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
export type SessionGenerationResponse = z.infer<typeof SessionGenerationResponseSchema>;
