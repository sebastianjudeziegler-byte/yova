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
  persistenceMode: z.enum(["thread", "ephemeral"]).default("thread"),
  history: z.array(TutorHistoryMessageSchema).max(12).default([]),
  sessionContext: z.object({
    planSessionId: z.string().uuid().nullable().optional(),
    activityIndex: z.number().int().min(0).max(40).nullable().optional(),
    activityTitle: z.string().trim().min(1).max(180),
    activityType: z.enum(["instruction", "multiple_choice", "free_response", "reflection"]),
    activityInstruction: z.string().trim().min(1).max(500),
    concept: z.string().trim().min(1).max(180).nullable(),
    methodPhase: z.string().trim().min(1).max(80).nullable(),
    teachingSummary: z.string().trim().min(1).max(1_200).nullable(),
    choices: z.array(z.string().trim().min(1).max(220)).max(5),
    referenceAnswer: z.string().trim().min(1).max(800).nullable(),
    feedback: z.string().trim().min(1).max(600).nullable(),
    answerState: z.enum(["not_attempted", "correct", "incorrect", "revealed"]),
    selectedChoice: z.string().trim().min(1).max(220).nullable(),
    helpIntent: z.enum([
      "open_question",
      "explain_differently",
      "show_example",
      "give_hint",
      "check_understanding",
      "repair_gap",
    ]),
  }).nullable().optional(),
});

const ShortenSessionActionSchema = z.object({
  id: z.string().uuid(),
  type: z.literal("shorten_current_session"),
  planId: z.string().uuid(),
  planSessionId: z.string().uuid(),
  minutes: z.number().int().min(5).max(90),
  title: z.string().trim().min(1).max(180),
  explanation: z.string().trim().min(1).max(500),
});

const RedirectPlanActionSchema = z.object({
  id: z.string().uuid(),
  type: z.literal("redirect_plan"),
  planId: z.string().uuid(),
  direction: z.string().trim().min(5).max(500),
  title: z.string().trim().min(1).max(180),
  explanation: z.string().trim().min(1).max(500),
});

export const TutorProposedActionSchema = z.discriminatedUnion("type", [
  ShortenSessionActionSchema,
  RedirectPlanActionSchema,
]);

export const TutorResponseSchema = z.object({
  threadId: z.string().uuid(),
  messages: z.array(TutorMessageSchema).length(2),
  model: z.string(),
  persistence: z.enum(["browser", "supabase", "ephemeral"]),
  proposedAction: TutorProposedActionSchema.nullable().default(null),
});

export const TutorHistoryResponseSchema = z.object({
  threadId: z.string().uuid().nullable(),
  messages: z.array(TutorMessageSchema),
});

export const TutorThreadSummarySchema = z.object({
  id: z.string().uuid(),
  title: z.string().trim().min(1).max(120),
  learningItemId: z.string().uuid().nullable(),
  contextTitle: z.string().trim().min(1).max(180).nullable(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});

export const TutorThreadListResponseSchema = z.object({
  threads: z.array(TutorThreadSummarySchema).max(50),
});

export type TutorMessage = z.infer<typeof TutorMessageSchema>;
export type TutorRequest = z.infer<typeof TutorRequestSchema>;
export type TutorResponse = z.infer<typeof TutorResponseSchema>;
export type TutorProposedAction = z.infer<typeof TutorProposedActionSchema>;
export type TutorThreadSummary = z.infer<typeof TutorThreadSummarySchema>;
