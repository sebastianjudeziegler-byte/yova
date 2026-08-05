import { z } from "zod";

export const RescheduleSessionRequestSchema = z.object({
  planSessionId: z.string().uuid(),
  scheduledFor: z.string().datetime({ offset: true }).refine((value) => {
    const timestamp = new Date(value).getTime();
    const earliest = Date.now() - 5 * 60 * 1000;
    const latest = Date.now() + 366 * 24 * 60 * 60 * 1000;
    return timestamp >= earliest && timestamp <= latest;
  }, "Choose a time between now and one year from now."),
});

export const RescheduleSessionResponseSchema = z.object({
  planSessionId: z.string().uuid(),
  scheduledFor: z.string().datetime({ offset: true }),
  persistence: z.literal("supabase"),
});

export type RescheduleSessionResponse = z.infer<typeof RescheduleSessionResponseSchema>;
