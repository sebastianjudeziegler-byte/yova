import "server-only";
import { ExternalMaterialSourceSchema } from "./external-source-schema";

export type MaterialExcerpt = {
  materialId?: string;
  chunkId?: string;
  chunkIndex?: number;
  name: string;
  text: string;
  truncated: boolean;
  locationLabel?: string;
  role?: "content_source" | "scope_outline";
  source?: { kind: "article" | "youtube"; title: string; url: string };
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
  materialMetadata,
}: {
  chunkRows: TopicMaterialChunkRow[];
  materialNames: Map<string, string>;
  orderedChunkIds: string[];
  materialMetadata?: Map<string, unknown>;
}): MaterialExcerpt[] {
  const byId = new Map(chunkRows.map((chunk) => [chunk.id, chunk]));
  return orderedChunkIds.flatMap((chunkId) => {
    const chunk = byId.get(chunkId);
    if (!chunk?.chunk_text.trim()) return [];
    const metadata = materialMetadata?.get(chunk.material_id);
    const fields = metadata && typeof metadata === "object" ? metadata as Record<string, unknown> : {};
    const source = ExternalMaterialSourceSchema.safeParse({ kind: fields.sourceKind, title: fields.sourceTitle, url: fields.sourceUrl });
    return [{
      materialId: chunk.material_id,
      chunkId: chunk.id,
      chunkIndex: chunk.chunk_index,
      name: materialNames.get(chunk.material_id) ?? "Uploaded material",
      text: chunk.chunk_text.trim(),
      truncated: false,
      locationLabel: chunk.location_label,
      role: chunk.section_role,
      ...(source.success && /^https?:\/\//i.test(source.data.url) ? { source: source.data } : {}),
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
