import { z } from "zod";

export const MaterialStageRequestSchema = z.object({
  name: z.string().trim().min(1).max(260),
  mimeType: z.string().max(100),
  sizeBytes: z.number().int().min(1).max(10 * 1024 * 1024),
});

export const MaterialStageResponseSchema = z.object({
  materialId: z.string().uuid(),
  storagePath: z.string().min(1).max(500),
  token: z.string().min(1),
  mimeType: z.enum(["application/pdf", "text/plain", "text/markdown"]),
});

export const MaterialProcessRequestSchema = z.object({
  materialId: z.string().uuid(),
});

export const UploadedMaterialSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(180),
  mimeType: z.enum(["application/pdf", "text/plain", "text/markdown"]),
  sizeBytes: z.number().int().min(1).max(10 * 1024 * 1024),
  textContent: z.null(),
  processingStatus: z.literal("ready"),
});

export const MaterialUploadResponseSchema = z.object({
  material: UploadedMaterialSchema,
  extraction: z.object({
    characters: z.number().int().positive().max(50_000),
    pages: z.number().int().positive().nullable(),
    truncated: z.boolean(),
  }),
});

export const MaterialDeleteRequestSchema = z.object({
  materialId: z.string().uuid(),
});

export type MaterialUploadResponse = z.infer<typeof MaterialUploadResponseSchema>;
