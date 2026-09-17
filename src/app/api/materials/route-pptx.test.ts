import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { strToU8, zipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  mapAndPersist: vi.fn(),
  reserve: vi.fn(),
  settle: vi.fn(),
  release: vi.fn(),
  recover: vi.fn(),
  cancel: vi.fn(),
  pdfRecovery: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: mocks.createClient }));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: vi.fn(),
  isSupabaseAdminConfigured: () => true,
}));
vi.mock("@/lib/server/rate-limit", () => ({
  checkMaterialUploadRateLimit: () => ({ allowed: true, retryAfterSeconds: 0 }),
  requestRateLimitKey: () => "isolated-pptx-route-test",
}));
vi.mock("@/lib/materials/material-understanding", () => ({
  MATERIAL_MAPPING_ROUTE_BUDGET_MS: 90_000,
  mapAndPersistMaterialWithConsumedAIUsage: mocks.mapAndPersist,
}));
vi.mock("@/lib/server/ai-usage", () => ({
  reserveAIRequest: mocks.reserve,
  settleAIRequestClaim: mocks.settle,
  refundAIRequestClaimBeforeProvider: mocks.release,
  refundAIRequestReservationBeforeProvider: mocks.recover,
}));
vi.mock("@/lib/materials/staged-cleanup", () => ({ cancelStagedMaterial: mocks.cancel }));
vi.mock("@/lib/openai/pdf-text-extractor", () => ({ extractScannedPdfTextWithOpenAI: mocks.pdfRecovery }));

// Keep format validation, ZIP/XML parsing, quality assessment, extraction
// recovery routing and response schemas real. No network services are used.
import { PATCH, POST } from "@/app/api/materials/route";
import { PPTX_MIME_TYPE } from "@/lib/materials/formats";
import { MaterialStageResponseSchema, MaterialUploadResponseSchema } from "@/lib/materials/schema";

const USER_ID = "91700000-0000-4000-8000-000000000001";
const CLAIM_ID = "91700000-0000-4000-8000-000000000002";

type UploadRow = {
  id: string;
  filename: string;
  storage_path: string;
  mime_type: string;
  byte_size: number;
  processing_status: string;
  metadata: Record<string, unknown>;
  extracted_text?: string;
  expires_at: string;
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.reserve.mockResolvedValue({ allowed: true, claimId: CLAIM_ID });
  mocks.settle.mockResolvedValue(true);
  mocks.release.mockResolvedValue(true);
  mocks.recover.mockResolvedValue(false);
  mocks.cancel.mockResolvedValue({ status: "removed", logicalRemovalCommitted: true });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => vi.restoreAllMocks());

describe("PowerPoint upload API with real extraction", () => {
  it("stages and reads the file, then waits for durable mapping before returning a ready material", async () => {
    const fixture = await courseDeck();
    const harness = configureStorage(fixture.bytes);
    const staged = await stage(fixture.filename, fixture.bytes.length);
    const mappingStarted = Promise.withResolvers<void>();
    const finishMapping = Promise.withResolvers<void>();
    mocks.mapAndPersist.mockImplementationOnce(async () => {
      mappingStarted.resolve();
      await finishMapping.promise;
    });

    let responded = false;
    const processing = PATCH(processRequest(staged.materialId)).then((response) => {
      responded = true;
      return response;
    });
    await mappingStarted.promise;

    expect(responded).toBe(false);
    expect(harness.update).toHaveBeenCalledOnce();
    const persisted = harness.update.mock.calls[0][0];
    expect(persisted).not.toHaveProperty("processing_status");
    expect(harness.row()?.processing_status).toBe("processing");
    expect(persisted.extracted_text.match(/^\[Slide \d+\]$/gm)).toHaveLength(fixture.slides);
    expect(persisted.metadata).toMatchObject({
      pageCount: fixture.slides,
      textTruncated: false,
      aiAssistedExtraction: false,
      mappingStatus: "processing",
    });
    expect(mocks.mapAndPersist).toHaveBeenCalledWith(expect.objectContaining({
      materialId: staged.materialId,
      filename: fixture.filename,
      text: persisted.extracted_text,
    }));
    expect(harness.update.mock.invocationCallOrder[0]).toBeLessThan(mocks.mapAndPersist.mock.invocationCallOrder[0]);
    expect(mocks.settle.mock.invocationCallOrder[0]).toBeLessThan(mocks.mapAndPersist.mock.invocationCallOrder[0]);

    finishMapping.resolve();
    const response = await processing;
    const parsed = MaterialUploadResponseSchema.parse(await response.json());
    expect(response.status).toBe(200);
    expect(parsed.material).toMatchObject({
      id: staged.materialId,
      mimeType: PPTX_MIME_TYPE,
      sizeBytes: fixture.bytes.length,
      textContent: null,
      processingStatus: "ready",
    });
    expect(parsed.extraction).toMatchObject({ pages: fixture.slides, truncated: false });
    expect(parsed.extraction.characters).toBe(persisted.extracted_text.length);
    expect(parsed.extraction.words).toBeGreaterThan(30);
    expect(mocks.pdfRecovery).not.toHaveBeenCalled();
    expect(mocks.cancel).not.toHaveBeenCalled();
    expect(mocks.release).not.toHaveBeenCalled();
  });

  it("rejects a corrupt .pptx before storing text, mapping, or spending provider allowance", async () => {
    const bytes = strToU8("This is not a valid PowerPoint archive.");
    const harness = configureStorage(bytes);
    const staged = await stage("Broken slides.pptx", bytes.length);

    const response = await PATCH(processRequest(staged.materialId));
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body).toMatchObject({ code: "material_extraction_failed_rolled_back", retryable: true });
    expect(body.error).toContain("could not read this PowerPoint");
    expect(body).not.toHaveProperty("material");
    expect(harness.update).not.toHaveBeenCalled();
    expect(mocks.mapAndPersist).not.toHaveBeenCalled();
    expect(mocks.pdfRecovery).not.toHaveBeenCalled();
    expect(mocks.settle).not.toHaveBeenCalled();
    expect(mocks.release).toHaveBeenCalledWith(expect.anything(), CLAIM_ID);
    expect(mocks.cancel).toHaveBeenCalledWith(expect.anything(), staged.materialId);
  });

  it("does not return a ready material when reading succeeds but mapping fails", async () => {
    const bytes = syntheticDeck();
    const harness = configureStorage(bytes);
    const staged = await stage("Class slides.pptx", bytes.length);
    mocks.mapAndPersist.mockRejectedValueOnce(new Error("Mapping provider unavailable"));

    const response = await PATCH(processRequest(staged.materialId));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toMatchObject({ code: "material_mapping_failed_rolled_back", retryable: true });
    expect(body).not.toHaveProperty("material");
    expect(harness.update).toHaveBeenCalledOnce();
    expect(harness.update.mock.calls[0][0]).not.toHaveProperty("processing_status");
    expect(mocks.cancel).toHaveBeenCalledWith(expect.anything(), staged.materialId);
    expect(mocks.settle).toHaveBeenCalledWith(expect.anything(), CLAIM_ID);
    expect(mocks.release).not.toHaveBeenCalled();
    expect(mocks.pdfRecovery).not.toHaveBeenCalled();
  });
});

function configureStorage(bytes: Uint8Array) {
  let row: UploadRow | undefined;
  const update = vi.fn((payload: { extracted_text: string; metadata: Record<string, unknown> }) => {
    if (row) Object.assign(row, payload);
    return { eq: vi.fn().mockResolvedValue({ error: null }) };
  });
  const lookup = {
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        gt: vi.fn(() => ({ maybeSingle: vi.fn(async () => ({ data: row, error: null })) })),
      })),
    })),
    update,
  };
  const rpc = vi.fn(async (name: string, { payload }: { payload: Record<string, unknown> }) => {
    expect(name).toBe("create_material_upload");
    row = {
      id: String(payload.id),
      filename: String(payload.filename),
      storage_path: String(payload.storagePath),
      mime_type: String(payload.mimeType),
      byte_size: Number(payload.byteSize),
      processing_status: String(payload.processingStatus),
      metadata: payload.metadata as Record<string, unknown>,
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    };
    return { data: true, error: null };
  });
  mocks.createClient.mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: USER_ID } }, error: null }) },
    rpc,
    from: vi.fn(() => lookup),
    storage: {
      from: vi.fn(() => ({
        createSignedUploadUrl: vi.fn().mockResolvedValue({ data: { token: "local-signed-token" }, error: null }),
        download: vi.fn(async (path: string) => {
          expect(path).toBe(row?.storage_path);
          return { data: new Blob([Uint8Array.from(bytes)]), error: null };
        }),
      })),
    },
  });
  return { update, row: () => row };
}

async function stage(filename: string, sizeBytes: number) {
  const response = await POST(new Request("http://localhost/api/materials", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: filename, mimeType: "application/zip", sizeBytes }),
  }));
  expect(response.status).toBe(200);
  const staged = MaterialStageResponseSchema.parse(await response.json());
  expect(staged.mimeType).toBe(PPTX_MIME_TYPE);
  expect(staged.storagePath).toBe(`${USER_ID}/${staged.materialId}/source.pptx`);
  return staged;
}

function processRequest(materialId: string) {
  return new Request("http://localhost/api/materials", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ materialId }),
  });
}

async function courseDeck() {
  const filename = process.env.YOVA_PPTX_TEST_FILE;
  if (filename) return { bytes: await readFile(filename), filename: basename(filename), slides: 17 };
  return { bytes: syntheticDeck(), filename: "Class slides.pptx", slides: 3 };
}

function syntheticDeck() {
  const relationship = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const packageNamespace = "http://schemas.openxmlformats.org/package/2006/relationships";
  const paragraphs = [
    "International politics studies how states cooperate and compete across borders. Sovereignty describes the authority of a state over its territory and population.",
    "Collective action problems occur when individually rational choices prevent a group from achieving a shared goal. Institutions can support cooperation through information and repeated interaction.",
    "Security dilemmas arise when defensive actions by one state create insecurity for another state. Compare the intentions of each government with the observable consequences of its actions.",
  ];
  const entries: Record<string, string> = {
    "[Content_Types].xml": '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/></Types>',
    "_rels/.rels": `<Relationships xmlns="${packageNamespace}"><Relationship Id="root" Type="${relationship}/officeDocument" Target="ppt/presentation.xml"/></Relationships>`,
    "ppt/presentation.xml": `<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="${relationship}"><p:sldIdLst>${paragraphs.map((_, index) => `<p:sldId id="${256 + index}" r:id="slide${index + 1}"/>`).join("")}</p:sldIdLst></p:presentation>`,
    "ppt/_rels/presentation.xml.rels": `<Relationships xmlns="${packageNamespace}">${paragraphs.map((_, index) => `<Relationship Id="slide${index + 1}" Type="${relationship}/slide" Target="slides/slide${index + 1}.xml"/>`).join("")}</Relationships>`,
    ...Object.fromEntries(paragraphs.map((text, index) => [
      `ppt/slides/slide${index + 1}.xml`,
      `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
    ])),
  };
  return zipSync(Object.fromEntries(Object.entries(entries).map(([path, text]) => [path, strToU8(text)])));
}
