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
  rpc: vi.fn(),
  checkRateLimit: vi.fn(),
  cancelStagedMaterial: vi.fn(),
  storePrivateMaterial: vi.fn(),
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
  storePrivateMaterial: mocks.storePrivateMaterial,
}));
vi.mock("@/lib/materials/material-understanding", () => ({
  MATERIAL_MAPPING_ROUTE_BUDGET_MS: 90_000,
  mapAndPersistMaterial: vi.fn(),
}));
vi.mock("@/lib/materials/staged-cleanup", () => ({
  cancelStagedMaterial: mocks.cancelStagedMaterial,
}));

import { DELETE, PATCH, POST, PUT } from "@/app/api/materials/route";
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
    mocks.rpc.mockResolvedValue({ data: true, error: null });
    mocks.cancelStagedMaterial.mockResolvedValue({
      status: "cleanup_pending",
      logicalRemovalCommitted: true,
    });
    mocks.createClient.mockResolvedValue({
      auth: { getUser: mocks.getUser },
      from: mocks.from,
      storage: { from: mocks.storageFrom },
      rpc: mocks.rpc,
    });
  });

  it("returns valid secure-upload instructions after creating the staging row", async () => {
    const response = await POST(stageRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(MaterialStageResponseSchema.safeParse(body).success).toBe(true);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-yova-request-id")).toBeTruthy();
    expect(mocks.rpc).toHaveBeenCalledWith("create_material_upload", {
      payload: expect.objectContaining({
        storagePath: expect.stringMatching(new RegExp(`^${USER_ID}/`)),
        processingStatus: "processing",
      }),
    });
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
    expect(mocks.cancelStagedMaterial).toHaveBeenCalledOnce();
    expect(errorLog).toHaveBeenCalledWith(
      "YOVA material staging response was invalid; staging row cancelled",
      expect.objectContaining({ requestId: body.requestId }),
    );
    errorLog.mockRestore();
  });

  it("reports the committed pending upload when invalid-response cleanup fails", async () => {
    mocks.createSignedUploadUrl.mockResolvedValueOnce({
      data: { token: { malformed: true } },
      error: null,
    });
    mocks.cancelStagedMaterial.mockResolvedValueOnce({
      status: "outcome_unconfirmed",
      logicalRemovalCommitted: "unknown",
    });
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await POST(stageRequest());
    const body = await response.json();
    const createdPayload = mocks.rpc.mock.calls[0]?.[1] as { payload: { id: string } };
    const requestId = response.headers.get("x-yova-request-id");

    expect(response.status).toBe(500);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(body).toEqual({
      error: `YOVA created the pending material upload, but could not return its secure upload instructions. Do not add the file again. Contact YOVA Support with reference ${requestId}.`,
      code: "material_stage_committed_response_invalid",
      committed: true,
      materialId: createdPayload.payload.id,
      requestId,
    });
    expect(mocks.cancelStagedMaterial).toHaveBeenCalledOnce();
    expect(errorLog).toHaveBeenCalledWith(
      "YOVA material staging committed but its response was invalid",
      expect.objectContaining({
        materialId: createdPayload.payload.id,
        requestId: body.requestId,
        cleanupStatus: "outcome_unconfirmed",
      }),
    );
    errorLog.mockRestore();
  });
});

describe("material staging deletion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUser.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });
    mocks.storePrivateMaterial.mockResolvedValue({ ok: true });
    mocks.cancelStagedMaterial.mockResolvedValue({ status: "removed", logicalRemovalCommitted: true });
    mocks.createClient.mockResolvedValue({
      auth: { getUser: mocks.getUser },
      from: mocks.from,
      storage: { from: mocks.storageFrom },
    });
  });

  it("returns no content after the leased cleanup confirms deletion", async () => {
    mocks.cancelStagedMaterial.mockResolvedValue({ status: "removed", logicalRemovalCommitted: true });

    const response = await DELETE(deleteRequest());

    expect(response.status).toBe(204);
    expect(mocks.cancelStagedMaterial).toHaveBeenCalledWith(
      expect.objectContaining({ auth: expect.anything() }),
      "22222222-2222-4222-8222-222222222222",
    );
  });

  it("truthfully reports logical cancellation while physical cleanup is pending", async () => {
    mocks.cancelStagedMaterial.mockResolvedValue({ status: "cleanup_pending", logicalRemovalCommitted: true });

    const response = await DELETE(deleteRequest());
    const body = await response.json();

    expect(response.status).toBe(202);
    expect(body).toEqual(expect.objectContaining({
      status: "cleanup_pending",
      code: "material_cleanup_pending",
      committed: true,
      cleanupPending: true,
    }));
  });

  it("does not claim a deletion when the cancellation outcome is ambiguous", async () => {
    mocks.cancelStagedMaterial.mockResolvedValue({
      status: "outcome_unconfirmed",
      logicalRemovalCommitted: "unknown",
    });

    const response = await DELETE(deleteRequest());
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toEqual(expect.objectContaining({
      code: "material_cleanup_outcome_unconfirmed",
      committed: "unknown",
    }));
  });
});

describe("material staging expiration boundaries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUser.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });
    mocks.storePrivateMaterial.mockResolvedValue({ ok: true });
    mocks.cancelStagedMaterial.mockResolvedValue({ status: "removed", logicalRemovalCommitted: true });
  });

  it("does not upload bytes into an expired staging row", async () => {
    const gt = vi.fn(() => ({
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    }));
    const eq = vi.fn(() => ({ gt }));
    const select = vi.fn(() => ({ eq }));
    mocks.createClient.mockResolvedValue({
      auth: { getUser: mocks.getUser },
      from: vi.fn(() => ({ select })),
    });
    const form = new FormData();
    form.set("materialId", "22222222-2222-4222-8222-222222222222");
    form.set("file", new File(["notes"], "notes.txt", { type: "text/plain" }));

    const response = await PUT(new Request("https://yova.example/api/materials", {
      method: "PUT",
      body: form,
    }));

    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toEqual(expect.objectContaining({ code: "material_staging_expired" }));
    expect(gt).toHaveBeenCalledWith("expires_at", expect.any(String));
  });

  it("does not process or map an expired staging row", async () => {
    const gt = vi.fn(() => ({
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    }));
    const eq = vi.fn(() => ({ gt }));
    const select = vi.fn(() => ({ eq }));
    mocks.createClient.mockResolvedValue({
      auth: { getUser: mocks.getUser },
      from: vi.fn(() => ({ select })),
    });

    const response = await PATCH(new Request("https://yova.example/api/materials", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ materialId: "22222222-2222-4222-8222-222222222222" }),
    }));

    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toEqual(expect.objectContaining({ code: "material_staging_expired" }));
    expect(gt).toHaveBeenCalledWith("expires_at", expect.any(String));
  });

  it("cancels an upload that expires while bytes are being stored", async () => {
    const activeLookup = queryResult({
      data: { storage_path: `${USER_ID}/22222222-2222-4222-8222-222222222222/source.txt`, mime_type: "text/plain", byte_size: 5 },
      error: null,
    });
    const expiredLookup = queryResult({ data: null, error: null });
    const from = vi.fn()
      .mockReturnValueOnce(activeLookup.builder)
      .mockReturnValueOnce(expiredLookup.builder);
    mocks.createClient.mockResolvedValue({
      auth: { getUser: mocks.getUser },
      from,
      storage: { from: vi.fn(() => ({})) },
    });
    const form = new FormData();
    form.set("materialId", "22222222-2222-4222-8222-222222222222");
    form.set("file", new File(["notes"], "notes.txt", { type: "text/plain" }));

    const response = await PUT(new Request("https://yova.example/api/materials", {
      method: "PUT",
      body: form,
    }));

    const responseBody = await response.json();
    expect(response.status, JSON.stringify(responseBody)).toBe(410);
    expect(responseBody).toMatchObject({
      code: "material_staging_expired",
      committed: true,
      retryable: true,
    });
    expect(mocks.cancelStagedMaterial).toHaveBeenCalledWith(expect.anything(), "22222222-2222-4222-8222-222222222222");
    expect(activeLookup.gt).toHaveBeenCalledWith("expires_at", expect.any(String));
    expect(expiredLookup.gt).toHaveBeenCalledWith("expires_at", expect.any(String));
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

function deleteRequest() {
  return new Request("https://yova.example/api/materials", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ materialId: "22222222-2222-4222-8222-222222222222" }),
  });
}

function queryResult(result: { data: unknown; error: unknown }) {
  const maybeSingle = vi.fn().mockResolvedValue(result);
  const gt = vi.fn(() => ({ maybeSingle }));
  const eq = vi.fn(() => ({ gt }));
  const select = vi.fn(() => ({ eq }));
  return { builder: { select }, gt };
}
