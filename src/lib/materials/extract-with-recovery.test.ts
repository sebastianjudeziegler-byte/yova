import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  extractMaterialText: vi.fn(),
  extractWithOpenAI: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/materials/extract", () => ({
  extractMaterialText: mocks.extractMaterialText,
  MaterialExtractionError: class MaterialExtractionError extends Error {},
}));
vi.mock("@/lib/openai/pdf-text-extractor", () => ({
  extractScannedPdfTextWithOpenAI: mocks.extractWithOpenAI,
}));

describe("material extraction recovery", () => {
  beforeEach(() => {
    mocks.extractMaterialText.mockReset();
    mocks.extractWithOpenAI.mockReset();
  });

  it("uses local extraction without sending a readable PDF to AI", async () => {
    mocks.extractMaterialText.mockResolvedValueOnce({
      text: "World War I alliances and mobilization produced a widening European conflict with many connected causes.",
      pages: 25,
      truncated: false,
    });
    const { extractMaterialWithRecovery } = await import("./extract-with-recovery");

    const result = await extractMaterialWithRecovery(
      new Uint8Array([37, 80, 68, 70]),
      "application/pdf",
      "World War I — Study Guide.pdf",
    );

    expect(result.aiAssistedExtraction).toBe(false);
    expect(result.extracted.pages).toBe(25);
    expect(mocks.extractWithOpenAI).not.toHaveBeenCalled();
  });

  it("recovers a valid PDF when the serverless parser throws", async () => {
    mocks.extractMaterialText.mockRejectedValueOnce(new Error("serverless parser failed"));
    mocks.extractWithOpenAI.mockResolvedValueOnce({
      text: "World War I began after a regional crisis interacted with alliances, mobilization plans, and declarations of war.",
      pages: null,
      truncated: false,
    });
    const { extractMaterialWithRecovery } = await import("./extract-with-recovery");

    const result = await extractMaterialWithRecovery(
      new Uint8Array([37, 80, 68, 70]),
      "application/pdf",
      "World War I — Study Guide.pdf",
    );

    expect(result.aiAssistedExtraction).toBe(true);
    expect(result.extracted.text).toContain("World War I began");
  });

  it("does not send plain text files to the PDF recovery path", async () => {
    mocks.extractMaterialText.mockRejectedValueOnce(new Error("invalid text"));
    const { extractMaterialWithRecovery } = await import("./extract-with-recovery");

    await expect(extractMaterialWithRecovery(
      new Uint8Array([0]),
      "text/plain",
      "notes.txt",
    )).rejects.toThrow("invalid text");
    expect(mocks.extractWithOpenAI).not.toHaveBeenCalled();
  });

  it("reports that both PDF readers failed instead of claiming OCR is unavailable", async () => {
    const { MaterialExtractionError } = await import("@/lib/materials/extract");
    mocks.extractMaterialText.mockRejectedValueOnce(
      new MaterialExtractionError("YOVA could not find selectable text in this PDF."),
    );
    mocks.extractWithOpenAI.mockResolvedValueOnce(null);
    const { extractMaterialWithRecovery } = await import("./extract-with-recovery");

    await expect(extractMaterialWithRecovery(
      new Uint8Array([37, 80, 68, 70]),
      "application/pdf",
      "scan.pdf",
    )).rejects.toThrow("could not read its text after two attempts");
  });
});
