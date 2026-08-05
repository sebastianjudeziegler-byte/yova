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
