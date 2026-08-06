import type { LearningMaterial } from "../domain";
import { MaterialStageResponseSchema, MaterialUploadResponseSchema } from "@/lib/materials/schema";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export const MATERIAL_LIMITS = {
  maxFiles: 5,
  maxBytesPerFile: 10 * 1024 * 1024,
} as const;

export async function uploadMaterialFiles(files: File[], existing: LearningMaterial[]) {
  if (existing.length + files.length > MATERIAL_LIMITS.maxFiles) {
    return { accepted: [] as LearningMaterial[], errors: [`Use up to ${MATERIAL_LIMITS.maxFiles} files for one plan.`], notices: [] as string[] };
  }

  const accepted: LearningMaterial[] = [];
  const errors: string[] = [];
  const notices: string[] = [];

  for (const file of files) {
    if (!/\.(pdf|txt|md)$/i.test(file.name)) {
      errors.push(`${file.name} is not supported. Use PDF, TXT, or Markdown.`);
      continue;
    }
    if (file.size > MATERIAL_LIMITS.maxBytesPerFile) {
      errors.push(`${file.name} is larger than the 10 MB alpha limit.`);
      continue;
    }
    if ([...existing, ...accepted].some((material) => material.name === file.name && material.sizeBytes === file.size)) {
      errors.push(`${file.name} is already attached.`);
      continue;
    }

    try {
      const stageResponse = await fetch("/api/materials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: file.name, mimeType: file.type, sizeBytes: file.size }),
      });
      const stageBody: unknown = await stageResponse.json();
      if (!stageResponse.ok) {
        const message = typeof stageBody === "object" && stageBody && "error" in stageBody && typeof stageBody.error === "string"
          ? stageBody.error
          : `YOVA could not upload ${file.name}.`;
        throw new Error(message);
      }

      const staged = MaterialStageResponseSchema.safeParse(stageBody);
      if (!staged.success) throw new Error(`YOVA could not prepare ${file.name} for upload.`);

      const supabase = createSupabaseBrowserClient();
      const { error: storageError } = await supabase.storage
        .from("learning-materials")
        .uploadToSignedUrl(staged.data.storagePath, staged.data.token, file, { contentType: staged.data.mimeType });
      if (storageError) {
        await deleteUploadedMaterial(staged.data.materialId).catch(() => undefined);
        throw new Error(`YOVA could not securely upload ${file.name}.`);
      }

      const response = await fetch("/api/materials", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ materialId: staged.data.materialId }),
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        const message = typeof body === "object" && body && "error" in body && typeof body.error === "string"
          ? body.error
          : `YOVA could not process ${file.name}.`;
        throw new Error(message);
      }

      const parsed = MaterialUploadResponseSchema.safeParse(body);
      if (!parsed.success) throw new Error(`YOVA could not verify the saved copy of ${file.name}.`);
      accepted.push(parsed.data.material);
      if (parsed.data.extraction.notice) notices.push(`${file.name}: ${parsed.data.extraction.notice}`);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : `YOVA could not upload ${file.name}.`);
    }
  }

  return { accepted, errors, notices };
}

export async function deleteUploadedMaterial(materialId: string) {
  const response = await fetch("/api/materials", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ materialId }),
  });
  if (response.ok) return;

  const body: unknown = await response.json().catch(() => null);
  const message = typeof body === "object" && body && "error" in body && typeof body.error === "string"
    ? body.error
    : "YOVA could not remove this material.";
  throw new Error(message);
}
