import { describe, expect, it } from "vitest";
import { PPTX_MIME_TYPE, resolveMaterialMimeType, unsupportedMaterialMessage } from "./formats";
import { materialStoragePath } from "./filename";
import { MaterialStageResponseSchema, MaterialUploadResponseSchema } from "./schema";

describe("PowerPoint format boundaries", () => {
  it.each([PPTX_MIME_TYPE, "", "application/octet-stream", "application/zip"])("recognizes a PowerPoint with browser MIME %s", (mime) => {
    expect(resolveMaterialMimeType("International Politics.PPTX", mime)).toBe(PPTX_MIME_TYPE);
  });

  it("rejects incompatible types and gives older PowerPoints a usable next step", () => {
    expect(resolveMaterialMimeType("slides.pptx", "text/plain")).toBeNull();
    expect(resolveMaterialMimeType("archive.zip", PPTX_MIME_TYPE)).toBeNull();
    expect(resolveMaterialMimeType("slides.ppt", "application/vnd.ms-powerpoint")).toBeNull();
    expect(unsupportedMaterialMessage("slides.ppt")).toContain("export it as PDF");
  });

  it("supports the same PowerPoint type in private paths and both response schemas", () => {
    const materialId = "11111111-1111-4111-8111-111111111111";
    const storagePath = materialStoragePath("owner", materialId, PPTX_MIME_TYPE);
    expect(storagePath).toBe(`owner/${materialId}/source.pptx`);
    expect(MaterialStageResponseSchema.safeParse({ materialId, storagePath, token: "token", mimeType: PPTX_MIME_TYPE }).success).toBe(true);
    expect(MaterialUploadResponseSchema.safeParse({
      material: { id: materialId, name: "slides.pptx", mimeType: PPTX_MIME_TYPE, sizeBytes: 1000, textContent: null, processingStatus: "ready" },
      extraction: { characters: 2000, words: 350, pages: 17, truncated: false, quality: "ready", notice: null },
    }).success).toBe(true);
  });
});
