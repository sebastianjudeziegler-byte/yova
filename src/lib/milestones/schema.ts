import { z } from "zod";

export const DeadlineMilestoneSchema = z.object({
  id: z.string().min(1),
  title: z.string().trim().min(2).max(120),
  description: z.string().trim().max(1_000),
  dueAt: z.string().datetime(),
  status: z.enum(["open", "completed"]),
  linkedLearningItemId: z.string().nullable(),
  createdAt: z.string().datetime(),
});

export const CreateMilestoneRequestSchema = z.object({
  title: z.string().trim().min(2).max(120),
  description: z.string().trim().max(1_000).default(""),
  dueAt: z.string().datetime(),
  linkedLearningItemId: z.string().uuid().nullable().default(null),
});

export const UpdateMilestoneRequestSchema = z.object({
  id: z.string().uuid(),
  title: z.string().trim().min(2).max(120).optional(),
  description: z.string().trim().max(1_000).optional(),
  dueAt: z.string().datetime().optional(),
  status: z.enum(["open", "completed"]).optional(),
  linkedLearningItemId: z.string().uuid().nullable().optional(),
});
