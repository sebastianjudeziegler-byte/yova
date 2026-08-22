import { z } from "zod";

export const MAX_SCHEDULE_UPDATES = 28;
export const ScheduleOperationKindSchema = z.enum(["manual", "advance_now"]);

const NormalizedUuidSchema = z.string().uuid().transform((value) => value.toLowerCase());

export const ScheduleSessionUpdateSchema = z.object({
  planSessionId: NormalizedUuidSchema,
  scheduledFor: z.string().datetime({ offset: true }).refine((value) => {
    const timestamp = new Date(value).getTime();
    const earliest = Date.now() - 5 * 60 * 1000;
    const latest = Date.now() + 366 * 24 * 60 * 60 * 1000;
    return timestamp >= earliest && timestamp <= latest;
  }, "Choose a time between now and one year from now."),
});

export const RescheduleSessionRequestSchema = z.object({
  planSessionId: ScheduleSessionUpdateSchema.shape.planSessionId,
  scheduledFor: ScheduleSessionUpdateSchema.shape.scheduledFor.refine(
    (value) => new Date(value).getTime() > Date.now(),
    "Choose a future date and time.",
  ),
});

export const RescheduleSessionResponseSchema = z.object({
  planSessionId: NormalizedUuidSchema,
  scheduledFor: z.string().datetime({ offset: true }),
  persistence: z.literal("supabase"),
});

export const ReschedulePlanSessionsRequestSchema = z.object({
  planId: NormalizedUuidSchema,
  operationKind: ScheduleOperationKindSchema.default("manual"),
  updates: z.array(ScheduleSessionUpdateSchema).min(1).max(MAX_SCHEDULE_UPDATES),
}).superRefine(({ operationKind, updates }, context) => {
  const ids = new Set<string>();
  updates.forEach((update, index) => {
    if (ids.has(update.planSessionId)) {
      context.addIssue({
        code: "custom",
        path: ["updates", index, "planSessionId"],
        message: "Each session may appear only once in a schedule change.",
      });
    }
    ids.add(update.planSessionId);
    if (operationKind === "manual" && new Date(update.scheduledFor).getTime() <= Date.now()) {
      context.addIssue({
        code: "custom",
        path: ["updates", index, "scheduledFor"],
        message: "Choose a future date and time.",
      });
    }
  });
});

export const ReschedulePlanSessionsResponseSchema = z.object({
  planId: NormalizedUuidSchema,
  sessions: z.array(z.object({
    planSessionId: NormalizedUuidSchema,
    scheduledFor: z.string().datetime({ offset: true }),
  })).min(1).max(MAX_SCHEDULE_UPDATES),
  persistence: z.literal("supabase"),
});

export type RescheduleSessionResponse = z.infer<typeof RescheduleSessionResponseSchema>;
export type ScheduleSessionUpdate = z.infer<typeof ScheduleSessionUpdateSchema>;
export type ScheduleOperationKind = z.infer<typeof ScheduleOperationKindSchema>;
export type ReschedulePlanSessionsResponse = z.infer<typeof ReschedulePlanSessionsResponseSchema>;
