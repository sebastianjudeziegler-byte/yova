import "server-only";

import {
  extractMaterialText,
  MaterialExtractionError,
  type ExtractedMaterial,
} from "@/lib/materials/extract";
import { assessMaterialQuality } from "@/lib/materials/quality";
import { extractScannedPdfTextWithOpenAI } from "@/lib/openai/pdf-text-extractor";

type SupportedMimeType = "application/pdf" | "text/plain" | "text/markdown";

type ExtractionResult = {
  extracted: ExtractedMaterial;
  aiAssistedExtraction: boolean;
};

/**
 * PDF.js is the fast, private first choice. Some valid PDFs still exercise
 * platform-specific parser paths in serverless runtimes, so every PDF parser
 * failure gets one bounded OpenAI file-reading recovery attempt. Plain text
 * failures remain deterministic and do not call AI.
 */
export async function extractMaterialWithRecovery(
  bytes: Uint8Array,
  mimeType: SupportedMimeType,
  filename: string,
): Promise<ExtractionResult> {
  try {
    return {
      extracted: await extractMaterialText(bytes, mimeType),
      aiAssistedExtraction: false,
    };
  } catch (localError) {
    if (mimeType !== "application/pdf") throw localError;

    const recovered = await extractScannedPdfTextWithOpenAI(bytes, filename).catch(() => null);
    if (recovered) {
      const quality = assessMaterialQuality(recovered.text, recovered.truncated);
      if (quality.status !== "unusable") {
        return { extracted: recovered, aiAssistedExtraction: true };
      }
    }

    const localReason = localError instanceof MaterialExtractionError
      ? localError.message
      : "the private PDF parser could not finish";
    throw new MaterialExtractionError(
      `YOVA uploaded the PDF, but could not read its text after two attempts. The first attempt reported: ${localReason}`,
    );
  }
}
