import { z } from "zod";
import { UploadedMaterialSchema } from "@/lib/materials/schema";

export const MaterialAttachmentRequestSchema = z.object({
  planId: z.string().uuid(),
  materialIds: z.array(z.string().uuid()).min(1).max(5).refine(
    (values) => new Set(values).size === values.length,
    "Each material may only be attached once.",
  ),
});

export const MaterialAttachmentResponseSchema = z.object({
  planId: z.string().uuid(),
  sourceMode: z.literal("user_materials"),
  materials: z.array(UploadedMaterialSchema).min(1).max(5),
  persistence: z.literal("supabase"),
});

export type MaterialAttachmentResponse = z.infer<typeof MaterialAttachmentResponseSchema>;
