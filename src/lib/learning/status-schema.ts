import { z } from "zod";

export const PlanArchiveRequestSchema = z.object({
  planId: z.string().uuid(),
  action: z.enum(["archive", "restore"]),
});

export const PlanArchiveResponseSchema = z.object({
  planId: z.string().uuid(),
  status: z.enum(["active", "completed", "archived"]),
  persistence: z.literal("supabase"),
});

export type PlanArchiveResponse = z.infer<typeof PlanArchiveResponseSchema>;

export const PLAN_DELETION_HEADER = "X-Yova-Confirm";
export const PLAN_DELETION_HEADER_VALUE = "delete-archived-plan";
export const PLAN_DELETION_CONFIRMATION = "DELETE";

export const PlanDeletionRequestSchema = z.object({
  planId: z.string().uuid(),
  confirmation: z.literal(PLAN_DELETION_CONFIRMATION),
}).strict();

export const PlanDeletionRpcResultSchema = z.object({
  deletedPlanId: z.string().uuid(),
  deletedLearningItemId: z.string().uuid(),
  cleanupJobId: z.string().uuid(),
}).strict();

export const PlanDeletionErrorResponseSchema = z.object({
  error: z.string().min(1).max(500),
}).strict();
