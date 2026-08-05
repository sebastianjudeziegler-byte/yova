import { z } from "zod";

export const SessionDurationAdjustmentRequestSchema = z.object({
  planSessionId: z.string().uuid(),
  estimatedMinutes: z.number().int().min(5).max(90),
});

export const SessionDurationAdjustmentResponseSchema = z.object({
  planId: z.string().uuid(),
  planSessionId: z.string().uuid(),
  estimatedMinutes: z.number().int().min(5).max(90),
  amountLabel: z.string().trim().min(1).max(120),
  persistence: z.literal("supabase"),
});

export type SessionDurationAdjustmentRequest = z.infer<typeof SessionDurationAdjustmentRequestSchema>;
export type SessionDurationAdjustmentResponse = z.infer<typeof SessionDurationAdjustmentResponseSchema>;
