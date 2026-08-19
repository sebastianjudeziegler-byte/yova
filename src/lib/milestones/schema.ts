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

const PostgrestTimestampSchema = z
  .string()
  .datetime({ offset: true })
  .transform((value) => new Date(value).toISOString());

const DeadlineMilestoneRowSchema = z.object({
  id: DeadlineMilestoneSchema.shape.id,
  title: DeadlineMilestoneSchema.shape.title,
  description: DeadlineMilestoneSchema.shape.description,
  due_at: PostgrestTimestampSchema,
  status: DeadlineMilestoneSchema.shape.status,
  linked_learning_item_id: DeadlineMilestoneSchema.shape.linkedLearningItemId,
  created_at: PostgrestTimestampSchema,
});

/**
 * Converts PostgREST's offset-formatted timestamptz fields into the canonical
 * ISO-Z representation exposed by YOVA's API.
 */
export function deadlineMilestoneFromRow(row: unknown) {
  const parsed = DeadlineMilestoneRowSchema.parse(row);
  return DeadlineMilestoneSchema.parse({
    id: parsed.id,
    title: parsed.title,
    description: parsed.description,
    dueAt: parsed.due_at,
    status: parsed.status,
    linkedLearningItemId: parsed.linked_learning_item_id,
    createdAt: parsed.created_at,
  });
}

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
