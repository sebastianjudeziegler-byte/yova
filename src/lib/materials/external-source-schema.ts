import { z } from "zod";
import { MaterialUploadResponseSchema } from "@/lib/materials/schema";

export const ExternalMaterialRequestSchema = z.object({
  url: z.string().trim().url().max(2_000),
  transcript: z.string().trim().min(80).max(50_000).optional(),
});

export const ExternalMaterialReadyResponseSchema = MaterialUploadResponseSchema.extend({
  status: z.literal("ready"),
  source: z.object({
    kind: z.enum(["article", "youtube"]),
    title: z.string().trim().min(1).max(180),
    url: z.string().url().max(2_000),
  }),
});

export const ExternalMaterialTranscriptResponseSchema = z.object({
  status: z.literal("transcript_required"),
  source: z.object({
    kind: z.literal("youtube"),
    title: z.string().trim().min(1).max(180),
    url: z.string().url().max(2_000),
  }),
  instructions: z.string().trim().min(1).max(400),
});

export const ExternalMaterialResponseSchema = z.discriminatedUnion("status", [
  ExternalMaterialReadyResponseSchema,
  ExternalMaterialTranscriptResponseSchema,
]);

export type ExternalMaterialResponse = z.infer<typeof ExternalMaterialResponseSchema>;
