import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PPTX_MIME_TYPE } from "./formats";

const mocks = vi.hoisted(() => ({ upload: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({
  createSupabaseBrowserClient: () => ({ storage: { from: () => ({ uploadToSignedUrl: mocks.upload }) } }),
}));
import { uploadMaterialFiles, type MaterialUploadProgress } from "./intake";

const materialId = "11111111-1111-4111-8111-111111111111";
const file = new File(["test bytes"], "Lecture.pptx", { type: PPTX_MIME_TYPE });
const staged = { materialId, storagePath: `owner/${materialId}/source.pptx`, token: "token", mimeType: PPTX_MIME_TYPE };
const saved = {
  material: { id: materialId, name: file.name, mimeType: PPTX_MIME_TYPE, sizeBytes: file.size, textContent: null, processingStatus: "ready" },
  extraction: { characters: 1800, words: 250, pages: 17, truncated: false, quality: "limited", notice: "Images and linked videos were not read." },
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("slide upload journey", () => {
  beforeEach(() => { mocks.upload.mockReset().mockResolvedValue({ error: null }); });
  afterEach(() => vi.unstubAllGlobals());

  it("uploads slides with progress and reports coverage only after processing succeeds", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json(staged)).mockResolvedValueOnce(json(saved));
    vi.stubGlobal("fetch", fetchMock);
    const progress: Array<MaterialUploadProgress | null> = [];
    const result = await uploadMaterialFiles([file], [], (update) => progress.push(update));

    expect(result.accepted).toEqual([saved.material]);
    expect(result.errors).toEqual([]);
    expect(result.notices).toEqual(["Lecture.pptx: 17 slides processed.", "Lecture.pptx: Images and linked videos were not read."]);
    expect(progress.map((step) => step?.stage ?? null)).toEqual(["preparing", "uploading", "reading", null]);
    expect(progress[0]).toMatchObject({ filename: "Lecture.pptx", fileIndex: 1, fileCount: 1 });
    expect(mocks.upload).toHaveBeenCalledWith(staged.storagePath, "token", file, { contentType: PPTX_MIME_TYPE });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ materialId });
  });

  it("uses the same staged upload when a network failure blocks direct storage", async () => {
    mocks.upload.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const fetchMock = vi.fn().mockResolvedValueOnce(json(staged)).mockResolvedValueOnce(json({ ok: true })).mockResolvedValueOnce(json(saved));
    vi.stubGlobal("fetch", fetchMock);
    const result = await uploadMaterialFiles([file], []);
    expect(result.accepted).toEqual([saved.material]);
    expect(fetchMock.mock.calls.map(([, init]) => init.method)).toEqual(["POST", "PUT", "PATCH"]);
    expect(fetchMock.mock.calls[1][1].body.get("materialId")).toBe(materialId);
  });

  it("keeps failed processing out of ready materials and gives non-JSON failures a readable message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(json(staged)).mockResolvedValueOnce(new Response("Gateway timeout", { status: 504 })));
    const onProgress = vi.fn();
    const result = await uploadMaterialFiles([file], [], onProgress);
    expect(result.accepted).toEqual([]);
    expect(result.notices).toEqual([]);
    expect(result.errors).toEqual(["YOVA could not process Lecture.pptx."]);
    expect(onProgress).toHaveBeenLastCalledWith(null);
  });
});
