import { z } from "zod";

export const PlanAdjustmentRequestSchema = z.object({
  planId: z.string().uuid(),
  deadline: z.string().datetime({ offset: true }).nullable().refine((value) => {
    if (!value) return true;
    const timestamp = new Date(value).getTime();
    return timestamp >= Date.now() - 60 * 60 * 1000
      && timestamp <= Date.now() + 5 * 366 * 24 * 60 * 60 * 1000;
  }, "Choose today or a future date within five years."),
  studyMode: z.enum(["inside_yova", "outside_yova"]),
  futureSessionMinutes: z.number().int().min(10).max(90),
  direction: z.string().trim().min(5).max(500).nullable().optional(),
});

export const PlanAdjustmentResponseSchema = z.object({
  planId: z.string().uuid(),
  deadline: z.string().datetime({ offset: true }).nullable(),
  studyMode: z.enum(["inside_yova", "outside_yova"]),
  directionApplied: z.string().trim().min(5).max(500).nullable().default(null),
  sessions: z.array(z.object({
    id: z.string().uuid(),
    sequence: z.number().int().positive(),
    title: z.string().trim().min(1).max(160),
    objective: z.string().trim().min(1).max(1_000),
    method: z.string().trim().min(1).max(160),
    methodReason: z.string().trim().min(1).max(1_000),
    scheduledFor: z.string().datetime({ offset: true }),
    estimatedMinutes: z.number().int().min(5).max(90),
    amountLabel: z.string().trim().min(1).max(120),
    learningMode: z.enum(["learn", "study"]),
    contentTargets: z.array(z.string().trim().min(1)).max(6),
    completionEvidence: z.array(z.string().trim().min(1)).max(4),
    status: z.enum(["ready", "upcoming"]),
  })).max(14),
  persistence: z.literal("supabase"),
});

export type PlanAdjustmentResponse = z.infer<typeof PlanAdjustmentResponseSchema>;
export type PlanAdjustmentRequest = z.infer<typeof PlanAdjustmentRequestSchema>;
