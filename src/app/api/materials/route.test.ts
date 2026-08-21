import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const USER_ID = "11111111-1111-4111-8111-111111111111";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getUser: vi.fn(),
  from: vi.fn(),
  insert: vi.fn(),
  delete: vi.fn(),
  eq: vi.fn(),
  storageFrom: vi.fn(),
  createSignedUploadUrl: vi.fn(),
  checkRateLimit: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: mocks.createClient,
}));
vi.mock("@/lib/server/rate-limit", () => ({
  checkMaterialUploadRateLimit: mocks.checkRateLimit,
  requestRateLimitKey: () => "material-route-test",
}));
vi.mock("@/lib/materials/extract", () => ({
  MaterialExtractionError: class MaterialExtractionError extends Error {},
}));
vi.mock("@/lib/materials/extract-with-recovery", () => ({
  extractMaterialWithRecovery: vi.fn(),
}));
vi.mock("@/lib/materials/quality", () => ({
  assessMaterialQuality: vi.fn(),
}));
vi.mock("@/lib/materials/storage-upload", () => ({
  storePrivateMaterial: vi.fn(),
}));
vi.mock("@/lib/materials/material-understanding", () => ({
  MATERIAL_MAPPING_ROUTE_BUDGET_MS: 90_000,
  mapAndPersistMaterial: vi.fn(),
}));

import { DELETE, POST } from "@/app/api/materials/route";
import { MaterialStageResponseSchema } from "@/lib/materials/schema";

describe("material staging write response", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const databaseBuilder = {
      insert: mocks.insert,
      delete: mocks.delete,
      eq: mocks.eq,
    };
    mocks.getUser.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });
    mocks.from.mockReturnValue(databaseBuilder);
    mocks.insert.mockResolvedValue({ error: null });
    mocks.delete.mockReturnValue(databaseBuilder);
    mocks.eq.mockResolvedValue({ error: null });
    mocks.storageFrom.mockReturnValue({ createSignedUploadUrl: mocks.createSignedUploadUrl });
    mocks.createSignedUploadUrl.mockResolvedValue({
      data: { token: "signed-upload-token" },
      error: null,
    });
    mocks.checkRateLimit.mockReturnValue({ allowed: true, retryAfterSeconds: 0 });
    mocks.createClient.mockResolvedValue({
      auth: { getUser: mocks.getUser },
      from: mocks.from,
      storage: { from: mocks.storageFrom },
    });
  });

  it("returns valid secure-upload instructions after creating the staging row", async () => {
    const response = await POST(stageRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(MaterialStageResponseSchema.safeParse(body).success).toBe(true);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-yova-request-id")).toBeTruthy();
    expect(mocks.insert).toHaveBeenCalledOnce();
    expect(mocks.createSignedUploadUrl).toHaveBeenCalledOnce();
  });

  it("removes the staging row and returns a retryable JSON error when response validation fails", async () => {
    mocks.createSignedUploadUrl.mockResolvedValueOnce({
      data: { token: { malformed: true } },
      error: null,
    });
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await POST(stageRequest());
    const body = await response.json();
    const requestId = response.headers.get("x-yova-request-id");

    expect(response.status).toBe(500);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toEqual({
      error: "YOVA could not prepare the secure upload. The pending upload was removed, so it is safe to try adding the file again.",
      code: "material_stage_response_invalid_rolled_back",
      retryable: true,
      requestId,
    });
    expect(mocks.insert).toHaveBeenCalledOnce();
    expect(mocks.delete).toHaveBeenCalledOnce();
    expect(errorLog).toHaveBeenCalledWith(
      "YOVA material staging response was invalid; staging row removed",
      expect.objectContaining({ requestId: body.requestId }),
    );
    errorLog.mockRestore();
  });

  it("reports the committed pending upload when invalid-response cleanup fails", async () => {
    mocks.createSignedUploadUrl.mockResolvedValueOnce({
      data: { token: { malformed: true } },
      error: null,
    });
    mocks.eq.mockResolvedValueOnce({ error: { code: "storage_cleanup_failed" } });
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await POST(stageRequest());
    const body = await response.json();
    const insertedRow = mocks.insert.mock.calls[0]?.[0] as { id: string };
    const requestId = response.headers.get("x-yova-request-id");

    expect(response.status).toBe(500);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(body).toEqual({
      error: `YOVA created the pending material upload, but could not return its secure upload instructions. Do not add the file again. Contact YOVA Support with reference ${requestId}.`,
      code: "material_stage_committed_response_invalid",
      committed: true,
      materialId: insertedRow.id,
      requestId,
    });
    expect(mocks.insert).toHaveBeenCalledOnce();
    expect(mocks.delete).toHaveBeenCalledOnce();
    expect(errorLog).toHaveBeenCalledWith(
      "YOVA material staging committed but its response was invalid",
      expect.objectContaining({
        materialId: insertedRow.id,
        requestId: body.requestId,
        cleanupCode: "storage_cleanup_failed",
      }),
    );
    errorLog.mockRestore();
  });
});

describe("material staging deletion", () => {
  it("removes durable mapped chunks before deleting the staging row", async () => {
    vi.clearAllMocks();
    mocks.getUser.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });
    const materialId = "22222222-2222-4222-8222-222222222222";
    const chunkDelete = vi.fn();
    const uploadDelete = vi.fn();
    const chunkEq = vi.fn().mockResolvedValue({ error: null });
    const uploadDeleteEq = vi.fn().mockResolvedValue({ error: null });
    const uploadSelectEq = vi.fn(() => ({
      maybeSingle: vi.fn().mockResolvedValue({
        data: { storage_path: `${USER_ID}/${materialId}/notes.txt` },
        error: null,
      }),
    }));
    const uploadSelect = vi.fn(() => ({ eq: uploadSelectEq }));
    chunkDelete.mockImplementation(() => ({ eq: chunkEq }));
    uploadDelete.mockImplementation(() => ({ eq: uploadDeleteEq }));
    const remove = vi.fn().mockResolvedValue({ error: null });
    mocks.createClient.mockResolvedValue({
      auth: { getUser: mocks.getUser },
      from: vi.fn((table: string) => table === "material_chunks"
        ? { delete: chunkDelete }
        : { select: uploadSelect, delete: uploadDelete }),
      storage: { from: vi.fn(() => ({ remove })) },
    });

    const response = await DELETE(new Request("https://yova.example/api/materials", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ materialId }),
    }));

    expect(response.status).toBe(204);
    expect(chunkEq).toHaveBeenCalledWith("material_id", materialId);
    expect(uploadDeleteEq).toHaveBeenCalledWith("id", materialId);
    expect(chunkDelete.mock.invocationCallOrder[0]).toBeLessThan(uploadDelete.mock.invocationCallOrder[0]);
  });
});

function stageRequest() {
  return new Request("https://yova.example/api/materials", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "biology-notes.pdf",
      mimeType: "application/pdf",
      sizeBytes: 2_048,
    }),
  });
}
