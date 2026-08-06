import { z } from "zod";

export const AnswerEvaluationActivitySchema = z.object({
  title: z.string().trim().min(3).max(140),
  prompt: z.string().trim().min(10).max(700),
  concept: z.string().trim().min(2).max(120),
  referenceAnswer: z.string().trim().min(2).max(700),
  rubric: z.string().trim().min(10).max(600),
});

export const AnswerEvaluationRequestSchema = z.object({
  planId: z.string().uuid(),
  planSessionId: z.string().uuid(),
  learnerAnswer: z.string().trim().min(2).max(3_000),
  activity: AnswerEvaluationActivitySchema,
});

export const AnswerEvaluationDraftSchema = z.object({
  verdict: z.enum(["secure", "needs_review", "uncertain"]),
  feedback: z.string().trim().min(15).max(420),
  matchedIdeas: z.array(z.string().trim().min(2).max(160)).max(4),
  missingIdeas: z.array(z.string().trim().min(2).max(160)).max(3),
});

export const AnswerEvaluationResponseSchema = AnswerEvaluationDraftSchema.extend({
  mode: z.enum(["openai", "preview"]),
});

export type AnswerEvaluationRequest = z.infer<typeof AnswerEvaluationRequestSchema>;
export type AnswerEvaluationDraft = z.infer<typeof AnswerEvaluationDraftSchema>;
export type AnswerEvaluationResponse = z.infer<typeof AnswerEvaluationResponseSchema>;
