import type { LearningMaterial } from "../domain";
import { ExternalMaterialResponseSchema } from "@/lib/materials/external-source-schema";
import { MaterialStageResponseSchema, MaterialUploadResponseSchema } from "@/lib/materials/schema";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { PPTX_MIME_TYPE, resolveMaterialMimeType, unsupportedMaterialMessage } from "@/lib/materials/formats";

export const MATERIAL_LIMITS = {
  maxFiles: 5,
  maxBytesPerFile: 10 * 1024 * 1024,
} as const;

export function validateMaterialFiles(files: File[], existing: LearningMaterial[]) {
  const accepted: File[] = [];
  const errors: string[] = [];

  for (const file of files) {
    if (!resolveMaterialMimeType(file.name, file.type ?? "")) {
      errors.push(unsupportedMaterialMessage(file.name));
      continue;
    }
    if (file.size < 1) {
      errors.push(`${file.name} is empty. Choose a file with learning content.`);
      continue;
    }
    if (file.size > MATERIAL_LIMITS.maxBytesPerFile) {
      errors.push(`${file.name} is larger than the 10 MB limit.`);
      continue;
    }
    if ([...existing, ...accepted.map((item) => ({ name: item.name, sizeBytes: item.size }))]
      .some((material) => material.name === file.name && material.sizeBytes === file.size)) {
      errors.push(`${file.name} is already attached.`);
      continue;
    }
    if (existing.length + accepted.length >= MATERIAL_LIMITS.maxFiles) {
      errors.push(`${file.name} was not added. Use up to ${MATERIAL_LIMITS.maxFiles} files for one plan.`);
      continue;
    }
    accepted.push(file);
  }

  return { accepted, errors };
}

export type MaterialUploadProgress = {
  filename: string;
  fileIndex: number;
  fileCount: number;
  stage: "preparing" | "uploading" | "reading";
};

export async function uploadMaterialFiles(
  files: File[],
  existing: LearningMaterial[],
  onProgress?: (progress: MaterialUploadProgress | null) => void,
) {
  const accepted: LearningMaterial[] = [];
  const validation = validateMaterialFiles(files, existing);
  const errors = [...validation.errors];
  const notices: string[] = [];

  for (const [index, file] of validation.accepted.entries()) {
    const reportProgress = (stage: MaterialUploadProgress["stage"]) => onProgress?.({
      filename: file.name, fileIndex: index + 1, fileCount: validation.accepted.length, stage,
    });
    try {
      reportProgress("preparing");
      const stageResponse = await fetch("/api/materials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: file.name, mimeType: file.type, sizeBytes: file.size }),
      });
      const stageBody: unknown = await stageResponse.json().catch(() => null);
      if (!stageResponse.ok) {
        const message = typeof stageBody === "object" && stageBody && "error" in stageBody && typeof stageBody.error === "string"
          ? stageBody.error
          : `YOVA could not upload ${file.name}.`;
        throw new Error(message);
      }

      const staged = MaterialStageResponseSchema.safeParse(stageBody);
      if (!staged.success) throw new Error(`YOVA could not prepare ${file.name} for upload.`);

      const supabase = createSupabaseBrowserClient();
      reportProgress("uploading");
      const { error: storageError } = await supabase.storage
        .from("learning-materials")
        .uploadToSignedUrl(staged.data.storagePath, staged.data.token, file, { contentType: staged.data.mimeType })
        .catch(() => ({ error: { message: "Direct upload unavailable" } }));
      if (storageError) {
        const fallback = new FormData();
        fallback.set("materialId", staged.data.materialId);
        fallback.set("file", file);
        const fallbackResponse = await fetch("/api/materials", { method: "PUT", body: fallback });
        if (!fallbackResponse.ok) {
          await deleteUploadedMaterial(staged.data.materialId).catch(() => undefined);
          const fallbackBody: unknown = await fallbackResponse.json().catch(() => null);
          const fallbackMessage = typeof fallbackBody === "object" && fallbackBody && "error" in fallbackBody && typeof fallbackBody.error === "string"
            ? fallbackBody.error
            : `YOVA could not securely upload ${file.name}.`;
          throw new Error(fallbackMessage);
        }
      }

      reportProgress("reading");
      const response = await fetch("/api/materials", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ materialId: staged.data.materialId }),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const message = typeof body === "object" && body && "error" in body && typeof body.error === "string"
          ? body.error
          : `YOVA could not process ${file.name}.`;
        throw new Error(message);
      }

      const parsed = MaterialUploadResponseSchema.safeParse(body);
      if (!parsed.success) throw new Error(`YOVA could not verify the saved copy of ${file.name}.`);
      accepted.push(parsed.data.material);
      if (parsed.data.material.mimeType === PPTX_MIME_TYPE && parsed.data.extraction.pages) {
        notices.push(parsed.data.extraction.truncated
          ? `${file.name}: ${parsed.data.extraction.pages}-slide presentation imported with limited coverage.`
          : `${file.name}: ${parsed.data.extraction.pages} slides processed.`);
      }
      if (parsed.data.extraction.notice) notices.push(`${file.name}: ${parsed.data.extraction.notice}`);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : `YOVA could not upload ${file.name}.`);
    }
  }

  onProgress?.(null);

  return { accepted, errors, notices };
}

export async function deleteUploadedMaterial(materialId: string): Promise<"removed" | "cleanup_pending"> {
  const response = await fetch("/api/materials", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ materialId }),
    keepalive: true,
  });
  if (response.status === 204) return "removed";
  if (response.status === 202) {
    const body: unknown = await response.json().catch(() => null);
    if (readStringProperty(body, "code") === "material_cleanup_pending"
      && readBooleanProperty(body, "committed") === true) return "cleanup_pending";
    throw new Error("YOVA could not confirm whether this material was cancelled.");
  }

  const body: unknown = await response.json().catch(() => null);
  const message = typeof body === "object" && body && "error" in body && typeof body.error === "string"
    ? body.error
    : "YOVA could not remove this material.";
  throw new Error(message);
}

export async function abandonUploadedMaterials(materials: LearningMaterial[]) {
  const uniqueIds = [...new Set(materials.map((material) => material.id))];
  const results = await Promise.allSettled(uniqueIds.map((id) => deleteUploadedMaterial(id)));
  return results.reduce((summary, result) => {
    if (result.status === "rejected") summary.unconfirmed += 1;
    else if (result.value === "cleanup_pending") summary.cleanupPending += 1;
    else summary.removed += 1;
    return summary;
  }, { requested: uniqueIds.length, removed: 0, cleanupPending: 0, unconfirmed: 0 });
}

export async function importLinkedMaterial(url: string, transcript?: string) {
  const response = await fetch("/api/materials/link", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, transcript: transcript?.trim() || undefined }),
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = typeof body === "object" && body && "error" in body && typeof body.error === "string"
      ? body.error
      : "YOVA could not import this link.";
    throw new Error(message);
  }
  const parsed = ExternalMaterialResponseSchema.safeParse(body);
  if (!parsed.success) throw new Error("The imported material came back in an unsafe format.");
  return parsed.data;
}

function readStringProperty(value: unknown, key: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const property = (value as Record<string, unknown>)[key];
  return typeof property === "string" ? property : null;
}

function readBooleanProperty(value: unknown, key: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const property = (value as Record<string, unknown>)[key];
  return typeof property === "boolean" ? property : null;
}
