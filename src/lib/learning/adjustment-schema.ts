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
});

export const PlanAdjustmentResponseSchema = z.object({
  planId: z.string().uuid(),
  deadline: z.string().datetime({ offset: true }).nullable(),
  studyMode: z.enum(["inside_yova", "outside_yova"]),
  sessions: z.array(z.object({
    id: z.string().uuid(),
    estimatedMinutes: z.number().int().min(10).max(90),
    amountLabel: z.string().trim().min(1).max(120),
  })).max(14),
  persistence: z.literal("supabase"),
});

export type PlanAdjustmentResponse = z.infer<typeof PlanAdjustmentResponseSchema>;
export type PlanAdjustmentRequest = z.infer<typeof PlanAdjustmentRequestSchema>;
