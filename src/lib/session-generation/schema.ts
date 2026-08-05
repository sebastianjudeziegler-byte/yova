import { z } from "zod";

export const SessionGenerationRequestSchema = z.object({
  planId: z.string().uuid(),
  planSessionId: z.string().uuid(),
});

export const GeneratedSessionActivitySchema = z.object({
  label: z.string().trim().min(2).max(50),
  title: z.string().trim().min(3).max(140),
  body: z.string().trim().min(10).max(900),
  type: z.enum(["instruction", "multiple_choice", "reflection"]),
  choices: z.array(z.string().trim().min(1).max(220)).max(5),
  correctAnswer: z.string().trim().min(1).max(220).nullable(),
  feedback: z.string().trim().min(5).max(500).nullable(),
}).superRefine((activity, context) => {
  if (activity.type === "multiple_choice") {
    if (activity.choices.length < 3) {
      context.addIssue({ code: "custom", path: ["choices"], message: "Multiple-choice activities need at least three choices." });
    }
    if (!activity.correctAnswer || !activity.choices.includes(activity.correctAnswer)) {
      context.addIssue({ code: "custom", path: ["correctAnswer"], message: "The correct answer must exactly match one choice." });
    }
    if (!activity.feedback) {
      context.addIssue({ code: "custom", path: ["feedback"], message: "Knowledge checks need explanatory feedback." });
    }
  } else if (activity.choices.length || activity.correctAnswer) {
    context.addIssue({ code: "custom", path: ["choices"], message: "Non-question activities cannot contain answer choices." });
  }
});

export const GeneratedSessionDraftSchema = z.object({
  rationale: z.string().trim().min(20).max(700),
  activities: z.array(GeneratedSessionActivitySchema).min(3).max(8),
}).superRefine((session, context) => {
  if (!session.activities.some((activity) => activity.type === "multiple_choice")) {
    context.addIssue({ code: "custom", path: ["activities"], message: "A guided session needs at least one knowledge check." });
  }
});

export const CachedGeneratedSessionSchema = GeneratedSessionDraftSchema.extend({
  schemaVersion: z.literal(1),
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
export type SessionGenerationResponse = z.infer<typeof SessionGenerationResponseSchema>;
