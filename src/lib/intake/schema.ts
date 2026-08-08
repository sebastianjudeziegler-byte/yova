import { z } from "zod";

export const IntakeItemTypeSchema = z.enum([
  "test",
  "assignment",
  "topic",
  "course",
  "book",
  "skill",
]);

export const IntakeInterpretationRequestSchema = z.object({
  description: z.string().trim().min(3).max(2_000),
  materialNames: z.array(z.string().trim().min(1).max(180)).max(5).default([]),
  timeZone: z.string().trim().min(1).max(100).default("UTC"),
});

export const IntakeInterpretationSchema = z.object({
  title: z.string().trim().min(2).max(100),
  objective: z.string().trim().min(3).max(500),
  itemType: IntakeItemTypeSchema,
  dueAt: z.string().datetime().nullable(),
  scope: z.string().trim().min(2).max(400),
  progress: z.string().trim().max(400),
  requestedMinutes: z.number().int().min(5).max(180).nullable().optional(),
  materialsSummary: z.string().trim().max(300),
  missingFields: z.array(z.enum(["scope", "progress"])),
});

export type IntakeItemType = z.infer<typeof IntakeItemTypeSchema>;
export type IntakeInterpretation = z.infer<typeof IntakeInterpretationSchema>;

export type AddIntakeSeed = IntakeInterpretation & {
  description: string;
  materials: import("@/lib/domain").LearningMaterial[];
};
