import { z } from "zod";

export const TutorMessageSchema = z.object({
  id: z.string().uuid(),
  threadId: z.string().uuid(),
  role: z.enum(["user", "assistant"]),
  content: z.string().trim().min(1).max(12_000),
  createdAt: z.string().datetime({ offset: true }),
});

export const TutorHistoryMessageSchema = TutorMessageSchema.pick({
  role: true,
  content: true,
});

export const TutorRequestSchema = z.object({
  question: z.string().trim().min(2).max(2_000),
  planId: z.string().uuid().nullable().optional(),
  threadId: z.string().uuid().nullable().optional(),
  history: z.array(TutorHistoryMessageSchema).max(12).default([]),
});

export const TutorResponseSchema = z.object({
  threadId: z.string().uuid(),
  messages: z.array(TutorMessageSchema).length(2),
  model: z.string(),
  persistence: z.enum(["browser", "supabase"]),
});

export const TutorHistoryResponseSchema = z.object({
  threadId: z.string().uuid().nullable(),
  messages: z.array(TutorMessageSchema),
});

export type TutorMessage = z.infer<typeof TutorMessageSchema>;
export type TutorRequest = z.infer<typeof TutorRequestSchema>;
export type TutorResponse = z.infer<typeof TutorResponseSchema>;
