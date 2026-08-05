import "server-only";

export type MaterialExcerpt = {
  name: string;
  text: string;
  truncated: boolean;
};

export function buildMaterialExcerpts(
  rows: Array<{ filename: string; extracted_text: string | null }>,
  totalCharacterLimit = 24_000,
  perMaterialLimit = 8_000,
): MaterialExcerpt[] {
  let remaining = totalCharacterLimit;
  const excerpts: MaterialExcerpt[] = [];

  for (const row of rows) {
    if (remaining <= 0 || !row.extracted_text?.trim()) break;
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
