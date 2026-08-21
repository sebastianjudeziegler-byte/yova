import { beforeEach, describe, expect, it, vi } from "vitest";
import { chunkMaterialText } from "@/lib/materials/chunk";

const parseResponse = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("@/lib/openai/client", () => ({
  getOpenAIClient: () => ({ responses: { parse: parseResponse } }),
}));
vi.mock("@/lib/openai/config", () => ({
  getOpenAIKnowledgeMapConfig: () => ({ model: "gpt-yova-map-test" }),
}));

const materialId = "11111111-1111-4111-8111-111111111111";

describe("whole-document material understanding", () => {
  beforeEach(() => {
    parseResponse.mockReset();
  });

  it("maps every chunk, including the document's final section", async () => {
    const text = `${"Instruction and explanation. ".repeat(900)}\n\nFINAL OUTLINE: Treaty consequences`;
    const expectedChunks = chunkMaterialText(materialId, text);
    parseResponse.mockImplementation(async (request: { input: string }) => {
      const input = JSON.parse(request.input) as { chunks: Array<{ chunkIndex: number; text: string }> };
      return {
        status: "completed",
        output_parsed: {
          roleReason: "Each returned chunk was read and classified according to its instructional substance.",
          chunks: input.chunks.map((chunk) => ({
            chunkIndex: chunk.chunkIndex,
            sectionRole: chunk.text.includes("FINAL OUTLINE") ? "scope_outline" : "content_source",
            topics: [{
              title: chunk.text.includes("FINAL OUTLINE") ? "Treaty consequences" : `Instruction ${chunk.chunkIndex + 1}`,
              description: chunk.text.includes("FINAL OUTLINE")
                ? "The final outline requires the consequences of the treaty."
                : `Instructional substance from document location ${chunk.chunkIndex + 1}.`,
              subtopics: [],
              prerequisiteTitles: [],
            }],
          })),
        },
        usage: {
          input_tokens: 100,
          input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
          output_tokens: 40,
        },
      };
    });
    const { mapMaterialText } = await import("@/lib/materials/material-understanding");

    const result = await mapMaterialText({ materialId, filename: "complete-guide.pdf", text });

    expect(parseResponse).toHaveBeenCalledTimes(Math.ceil(expectedChunks.length / 4));
    expect(result.understanding.chunkCount).toBe(expectedChunks.length);
    expect(result.understanding.role).toBe("mixed");
    expect(result.understanding.topics.map((topic) => topic.title)).toContain("Treaty consequences");
    expect(result.understanding.topics.flatMap((topic) => topic.sourceReferences).map((reference) => reference.chunkId)).toEqual(
      expect.arrayContaining(expectedChunks.map((chunk) => chunk.id)),
    );
    expect(result.chunks.at(-1)?.text).toContain("FINAL OUTLINE");
  });

  it("rejects a batch that silently omits a requested chunk", async () => {
    parseResponse.mockResolvedValue({
      status: "completed",
      output_parsed: {
        roleReason: "Only one chunk was returned even though the request contained more complete locations.",
        chunks: [{
          chunkIndex: 0,
          sectionRole: "content_source",
          topics: [{
            title: "Opening topic",
            description: "Only the opening location was mapped by this invalid response.",
            subtopics: [],
            prerequisiteTitles: [],
          }],
        }],
      },
      usage: {
        input_tokens: 100,
        input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
        output_tokens: 40,
      },
    });
    const { mapMaterialText } = await import("@/lib/materials/material-understanding");

    await expect(mapMaterialText({
      materialId,
      filename: "long-notes.pdf",
      text: "A complete explanation. ".repeat(400),
    })).rejects.toMatchObject({ failedValidator: "material_mapping_chunk_coverage" });
  });

  it("stops a slow multi-wave map with cleanup time left before the route deadline", async () => {
    let now = 1_000;
    const nowSpy = vi.spyOn(Date, "now").mockImplementation(() => now);
    parseResponse.mockImplementation(async (request: { input: string }) => {
      now += 24_000;
      return successfulBatch(request);
    });
    const {
      mapMaterialText,
      MaterialMappingDeadlineError,
    } = await import("@/lib/materials/material-understanding");
    const longText = "A detailed instructional section explains a distinct relationship with examples. ".repeat(2_900);
    const totalBatches = Math.ceil(chunkMaterialText(materialId, longText).length / 4);

    try {
      await expect(mapMaterialText({
        materialId,
        filename: "long-course-notes.pdf",
        text: longText,
        deadlineAt: 70_000,
      })).rejects.toBeInstanceOf(MaterialMappingDeadlineError);
      expect(totalBatches).toBeGreaterThan(3);
      expect(parseResponse).toHaveBeenCalledTimes(3);
      expect(parseResponse.mock.calls.every((call) => {
        const options = call[1] as { timeout?: number } | undefined;
        return typeof options?.timeout === "number" && options.timeout <= 30_000;
      })).toBe(true);
    } finally {
      nowSpy.mockRestore();
    }
  });
});

function successfulBatch(request: { input: string }) {
  const input = JSON.parse(request.input) as { chunks: Array<{ chunkIndex: number }> };
  return {
    status: "completed",
    output_parsed: {
      roleReason: "Every requested location was classified before the bounded mapper deadline.",
      chunks: input.chunks.map((chunk) => ({
        chunkIndex: chunk.chunkIndex,
        sectionRole: "content_source",
        topics: [{
          title: `Mapped relationship ${chunk.chunkIndex + 1}`,
          description: `Instructional substance from bounded location ${chunk.chunkIndex + 1}.`,
          subtopics: [],
          prerequisiteTitles: [],
        }],
      })),
    },
    usage: {
      input_tokens: 100,
      input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
      output_tokens: 40,
    },
  };
}
