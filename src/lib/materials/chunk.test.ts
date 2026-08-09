import { describe, expect, it } from "vitest";
import {
  chunkMaterialText,
  MATERIAL_CHUNK_CHARACTERS,
  MATERIAL_CHUNK_OVERLAP_CHARACTERS,
} from "@/lib/materials/chunk";

describe("material text chunking", () => {
  it("keeps continuous locations through the final section of a long document", () => {
    const text = `${"Foundation sentence. ".repeat(900)}FINAL_EXAM_TOPIC`;
    const chunks = chunkMaterialText("11111111-1111-4111-8111-111111111111", text);

    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks.at(-1)?.text).toContain("FINAL_EXAM_TOPIC");
    expect(chunks[0]?.startCharacter).toBe(0);
    expect(chunks.at(-1)?.endCharacter).toBe(text.length);
    for (let index = 1; index < chunks.length; index += 1) {
      expect(chunks[index]!.startCharacter).toBeLessThanOrEqual(chunks[index - 1]!.endCharacter);
      expect(chunks[index - 1]!.endCharacter - chunks[index]!.startCharacter).toBeLessThanOrEqual(
        MATERIAL_CHUNK_OVERLAP_CHARACTERS,
      );
    }
    expect(chunks.every((chunk) => chunk.text.length <= MATERIAL_CHUNK_CHARACTERS)).toBe(true);
  });
});
