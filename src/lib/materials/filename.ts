type MaterialMimeType = "application/pdf" | "text/plain" | "text/markdown";

/**
 * Keeps the name learners recognize while removing characters that are unsafe
 * in database fields or UI. The display name never becomes a storage key.
 */
export function sanitizeMaterialDisplayName(value: string) {
  const cleaned = value
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f/\\]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);

  return cleaned || "learning-material";
}

/**
 * Private object keys deliberately omit the learner's filename. This avoids
 * Unicode and punctuation incompatibilities in storage providers and keeps a
 * potentially revealing local filename out of the object path.
 */
export function materialStoragePath(
  userId: string,
  materialId: string,
  mimeType: MaterialMimeType,
) {
  const extension = mimeType === "application/pdf"
    ? "pdf"
    : mimeType === "text/markdown"
      ? "md"
      : "txt";

  return `${userId}/${materialId}/source.${extension}`;
}
