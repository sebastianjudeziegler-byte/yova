import { beforeEach, describe, expect, it, vi } from "vitest";

const createResponse = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("@/lib/openai/client", () => ({
  getOpenAIClient: () => ({ responses: { create: createResponse } }),
}));
vi.mock("@/lib/openai/config", () => ({
  getOpenAISessionConfig: () => ({ apiKey: "test", model: "gpt-yova-test" }),
}));

describe("scanned PDF extraction", () => {
  beforeEach(() => createResponse.mockReset());

  it("uses a low-detail PDF input and returns normalized document text", async () => {
    createResponse.mockResolvedValueOnce({
      output_text: "WORLD WAR I\r\n\r\n  Causes include alliances and militarism.   ",
    });

    const { extractScannedPdfTextWithOpenAI } = await import("@/lib/openai/pdf-text-extractor");
    const result = await extractScannedPdfTextWithOpenAI(new Uint8Array([37, 80, 68, 70]), "wwi-guide.pdf");

    expect(result?.text).toBe("WORLD WAR I\n\nCauses include alliances and militarism.");
    expect(createResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gpt-yova-test",
        store: false,
        input: [expect.objectContaining({
          content: expect.arrayContaining([
            expect.objectContaining({ type: "input_file", filename: "wwi-guide.pdf", detail: "low" }),
          ]),
        })],
      }),
      { maxRetries: 0, timeout: 45_000 },
    );
  });

  it("does not accept an empty extraction as learning material", async () => {
    createResponse.mockResolvedValueOnce({ output_text: "NO_READABLE_TEXT" });
    const { extractScannedPdfTextWithOpenAI } = await import("@/lib/openai/pdf-text-extractor");
    await expect(extractScannedPdfTextWithOpenAI(new Uint8Array([37, 80, 68, 70]), "blank.pdf")).resolves.toBeNull();
  });
});
