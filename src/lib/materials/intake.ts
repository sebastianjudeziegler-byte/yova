import type { LearningMaterial } from "../domain";

export const MATERIAL_LIMITS = {
  maxFiles: 5,
  maxBytesPerFile: 10 * 1024 * 1024,
  maxTextCharacters: 50_000,
} as const;

export async function prepareMaterialFiles(files: File[], existing: LearningMaterial[]) {
  if (existing.length + files.length > MATERIAL_LIMITS.maxFiles) {
    return { accepted: [] as LearningMaterial[], errors: [`Use up to ${MATERIAL_LIMITS.maxFiles} files for one plan.`] };
  }

  const accepted: LearningMaterial[] = [];
  const errors: string[] = [];

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

    const isPdf = /\.pdf$/i.test(file.name);
    const textContent = isPdf
      ? null
      : (await file.text()).trim().slice(0, MATERIAL_LIMITS.maxTextCharacters);

    if (!isPdf && !textContent) {
      errors.push(`${file.name} does not contain readable text.`);
      continue;
    }

    accepted.push({
      id: makeMaterialId(),
      name: file.name,
      mimeType: file.type || (isPdf ? "application/pdf" : "text/plain"),
      sizeBytes: file.size,
      textContent,
      processingStatus: isPdf ? "staged" : "ready",
    });
  }

  return { accepted, errors };
}

function makeMaterialId() {
  const randomPart = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
  return `material_${randomPart}`;
}
