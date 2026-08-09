import "server-only";

export type MaterialExcerpt = {
  materialId?: string;
  chunkId?: string;
  chunkIndex?: number;
  name: string;
  text: string;
  truncated: boolean;
  locationLabel?: string;
  role?: "content_source" | "scope_outline";
};

export type TopicMaterialChunkRow = {
  id: string;
  material_id: string;
  chunk_index: number;
  location_label: string;
  section_role: "content_source" | "scope_outline";
  chunk_text: string;
};

export function buildTopicMaterialExcerpts({
  chunkRows,
  materialNames,
  orderedChunkIds,
}: {
  chunkRows: TopicMaterialChunkRow[];
  materialNames: Map<string, string>;
  orderedChunkIds: string[];
}): MaterialExcerpt[] {
  const byId = new Map(chunkRows.map((chunk) => [chunk.id, chunk]));
  return orderedChunkIds.flatMap((chunkId) => {
    const chunk = byId.get(chunkId);
    if (!chunk?.chunk_text.trim()) return [];
    return [{
      materialId: chunk.material_id,
      chunkId: chunk.id,
      chunkIndex: chunk.chunk_index,
      name: materialNames.get(chunk.material_id) ?? "Uploaded material",
      text: chunk.chunk_text.trim(),
      truncated: false,
      locationLabel: chunk.location_label,
      role: chunk.section_role,
    } satisfies MaterialExcerpt];
  });
}

export function buildMaterialExcerpts(
  rows: Array<{ filename: string; extracted_text: string | null }>,
  totalCharacterLimit = 24_000,
  perMaterialLimit = 8_000,
): MaterialExcerpt[] {
  let remaining = totalCharacterLimit;
  const excerpts: MaterialExcerpt[] = [];

  for (const row of rows) {
    if (remaining <= 0) break;
    if (!row.extracted_text?.trim()) continue;
    const normalized = row.extracted_text.trim();
    const excerptLength = Math.min(normalized.length, perMaterialLimit, remaining);
    excerpts.push({
      name: row.filename,
      text: normalized.slice(0, excerptLength),
      truncated: excerptLength < normalized.length,
    });
    remaining -= excerptLength;
  }

  return excerpts;
}
