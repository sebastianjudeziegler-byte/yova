import { describe, expect, it } from "vitest";
import type { LearningMaterial } from "../domain";
import { MATERIAL_LIMITS, validateMaterialFiles } from "./intake";

function candidate(name: string, size = 1024) {
  return { name, size } as File;
}

function existing(name: string, sizeBytes = 1024): LearningMaterial {
  return {
    id: crypto.randomUUID(),
    name,
    mimeType: "application/pdf",
    sizeBytes,
    textContent: null,
    processingStatus: "ready",
  };
}

describe("material intake validation", () => {
  it("accepts PDFs, text, and Markdown dropped together", () => {
    const result = validateMaterialFiles([
      candidate("study-guide.pdf"),
      candidate("class-notes.txt"),
      candidate("review.md"),
    ], []);

    expect(result.accepted.map((file) => file.name)).toEqual([
      "study-guide.pdf",
      "class-notes.txt",
      "review.md",
    ]);
    expect(result.errors).toEqual([]);
  });

  it("rejects unsupported, oversized, and duplicate files with specific messages", () => {
    const result = validateMaterialFiles([
      candidate("worksheet.docx"),
      candidate("textbook.pdf", MATERIAL_LIMITS.maxBytesPerFile + 1),
      candidate("study-guide.pdf"),
    ], [existing("study-guide.pdf")]);

    expect(result.accepted).toEqual([]);
    expect(result.errors).toEqual([
      "worksheet.docx is not supported. Use PDF, TXT, or Markdown.",
      "textbook.pdf is larger than the 10 MB limit.",
      "study-guide.pdf is already attached.",
    ]);
  });

  it("fills the remaining slots and identifies only the overflow files", () => {
    const current = ["one.pdf", "two.pdf", "three.pdf", "four.pdf"].map((name) => existing(name));
    const result = validateMaterialFiles([
      candidate("five.pdf"),
      candidate("six.pdf"),
    ], current);

    expect(result.accepted.map((file) => file.name)).toEqual(["five.pdf"]);
    expect(result.errors).toEqual(["six.pdf was not added. Use up to 5 files for one plan."]);
  });
});
