import "server-only";

import { assessMaterialQuality } from "@/lib/materials/quality";

// Enough for roughly a small textbook. The mapping pass chunks this complete
// bounded text instead of repeatedly reading only its opening pages.
export const MAX_EXTRACTED_CHARACTERS = 288_000;
const MAX_PDF_PAGES = 300;

export type ExtractedMaterial = {
  text: string;
  pages: number | null;
  truncated: boolean;
};

export class MaterialExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MaterialExtractionError";
  }
}

export async function extractMaterialText(
  bytes: Uint8Array,
  mimeType: "application/pdf" | "text/plain" | "text/markdown",
): Promise<ExtractedMaterial> {
  if (mimeType !== "application/pdf") return extractPlainText(bytes);
  return extractPdfText(bytes);
}

function extractPlainText(bytes: Uint8Array): ExtractedMaterial {
  const decoded = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  if (decoded.includes("\u0000")) throw new MaterialExtractionError("This text file appears to contain binary data.");

  const normalized = normalizeText(decoded);
  if (!normalized) throw new MaterialExtractionError("This file does not contain readable text.");

  const extracted = {
    text: normalized.slice(0, MAX_EXTRACTED_CHARACTERS),
    pages: null,
    truncated: normalized.length > MAX_EXTRACTED_CHARACTERS,
  };
  assertUsableMaterial(extracted);
  return extracted;
}

async function extractPdfText(bytes: Uint8Array): Promise<ExtractedMaterial> {
  if (new TextDecoder("ascii").decode(bytes.slice(0, 5)) !== "%PDF-") {
    throw new MaterialExtractionError("This file does not appear to be a valid PDF.");
  }

  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = getDocument({
    data: bytes.slice(),
    useWorkerFetch: false,
  });
  let document;
  try {
    document = await loadingTask.promise;
  } catch {
    await loadingTask.destroy();
    throw new MaterialExtractionError("YOVA could not read this PDF. It may be damaged or password protected.");
  }

  try {
    const pageCount = document.numPages;
    const pagesToRead = Math.min(pageCount, MAX_PDF_PAGES);
    const pageTexts: string[] = [];
    let characterCount = 0;

    for (let pageNumber = 1; pageNumber <= pagesToRead && characterCount < MAX_EXTRACTED_CHARACTERS; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const pageText = normalizeText(content.items.map((item) => "str" in item ? item.str : "").join(" "));
      page.cleanup();

      if (!pageText) continue;
      const remaining = MAX_EXTRACTED_CHARACTERS - characterCount;
      pageTexts.push(pageText.slice(0, remaining));
      characterCount += Math.min(pageText.length, remaining);
    }

    const text = pageTexts.join("\n\n").trim();
    if (!text) {
      throw new MaterialExtractionError("YOVA could not find selectable text in this PDF. Scanned-image PDFs need OCR, which is not enabled yet.");
    }

    const extracted = {
      text,
      pages: pageCount,
      truncated: pageCount > pagesToRead || characterCount >= MAX_EXTRACTED_CHARACTERS,
    };
    assertUsableMaterial(extracted);
    return extracted;
  } finally {
    await loadingTask.destroy();
  }
}

function assertUsableMaterial(material: ExtractedMaterial) {
  const quality = assessMaterialQuality(material.text, material.truncated);
  if (quality.status === "unusable") throw new MaterialExtractionError(quality.notice ?? "This file does not contain enough readable learning content.");
}

function normalizeText(value: string) {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[\t ]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
