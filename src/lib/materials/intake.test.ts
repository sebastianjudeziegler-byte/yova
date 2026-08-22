import { afterEach, describe, expect, it, vi } from "vitest";
import type { LearningMaterial } from "../domain";
import {
  abandonUploadedMaterials,
  deleteUploadedMaterial,
  MATERIAL_LIMITS,
  validateMaterialFiles,
} from "./intake";

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

describe("material abandonment", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("accepts a structured 202 only when logical cancellation committed", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: "material_cleanup_pending",
      committed: true,
    }), { status: 202, headers: { "Content-Type": "application/json" } })));

    await expect(deleteUploadedMaterial("22222222-2222-4222-8222-222222222222"))
      .resolves.toBe("cleanup_pending");
  });

  it("summarizes best-effort cleanup without treating ambiguity as success", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        code: "material_cleanup_outcome_unconfirmed",
        committed: "unknown",
        error: "Outcome unknown",
      }), { status: 503, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(abandonUploadedMaterials([
      existing("one.pdf"),
      existing("two.pdf"),
    ])).resolves.toEqual({
      requested: 2,
      removed: 1,
      cleanupPending: 0,
      unconfirmed: 1,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
