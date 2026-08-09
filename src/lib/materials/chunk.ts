export const MATERIAL_CHUNK_CHARACTERS = 6_000;
export const MATERIAL_CHUNK_OVERLAP_CHARACTERS = 400;
export const MAX_MATERIAL_CHUNKS = 48;

export type MaterialTextChunk = {
  id: string;
  index: number;
  startCharacter: number;
  endCharacter: number;
  locationLabel: string;
  text: string;
};

/**
 * Splits the complete extracted document into stable, overlapping locations.
 * Boundaries prefer paragraph or sentence endings, but never skip middle or
 * final sections merely because the beginning was long.
 */
export function chunkMaterialText(materialId: string, text: string): MaterialTextChunk[] {
  const normalized = text.trim();
  if (!normalized) return [];
  const chunks: MaterialTextChunk[] = [];
  let start = 0;

  while (start < normalized.length && chunks.length < MAX_MATERIAL_CHUNKS) {
    const hardEnd = Math.min(normalized.length, start + MATERIAL_CHUNK_CHARACTERS);
    let end = hardEnd;
    if (hardEnd < normalized.length) {
      const window = normalized.slice(start, hardEnd);
      const paragraph = window.lastIndexOf("\n\n");
      const sentence = Math.max(window.lastIndexOf(". "), window.lastIndexOf("? "), window.lastIndexOf("! "));
      const preferred = Math.max(paragraph, sentence);
      if (preferred >= MATERIAL_CHUNK_CHARACTERS * 0.65) end = start + preferred + (preferred === paragraph ? 2 : 1);
    }
    const chunkText = normalized.slice(start, end).trim();
    if (chunkText) {
      const index = chunks.length;
      chunks.push({
        id: stableChunkId(materialId, index),
        index,
        startCharacter: start,
        endCharacter: end,
        locationLabel: `Characters ${start + 1}-${end}`,
        text: chunkText,
      });
    }
    if (end >= normalized.length) break;
    start = Math.max(start + 1, end - MATERIAL_CHUNK_OVERLAP_CHARACTERS);
  }

  return chunks;
}

function stableChunkId(materialId: string, index: number) {
  const clean = materialId.replace(/-/g, "").padEnd(32, "0").slice(0, 24);
  const suffix = index.toString(16).padStart(8, "0");
  const hex = `${clean}${suffix}`;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
