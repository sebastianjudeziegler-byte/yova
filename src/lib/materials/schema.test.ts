import { describe, expect, it } from "vitest";
import { MaterialUploadResponseSchema } from "@/lib/materials/schema";

describe("material upload response boundary", () => {
  it("accepts the same long-document character range as extraction and Postgres", () => {
    const response = {
      material: {
        id: "11111111-1111-4111-8111-111111111111",
        name: "long-course-notes.md",
        mimeType: "text/markdown",
        sizeBytes: 240_000,
        textContent: null,
        processingStatus: "ready",
      },
      extraction: {
        characters: 240_000,
        words: 38_000,
        pages: null,
        truncated: false,
        quality: "ready",
        notice: null,
      },
    };

    expect(MaterialUploadResponseSchema.safeParse(response).success).toBe(true);
    expect(MaterialUploadResponseSchema.safeParse({
      ...response,
      extraction: { ...response.extraction, characters: 288_001 },
    }).success).toBe(false);
  });
});
