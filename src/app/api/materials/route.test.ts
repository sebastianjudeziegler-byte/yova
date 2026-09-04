import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const USER_ID = "11111111-1111-4111-8111-111111111111";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  createAdmin: vi.fn(),
  isAdminConfigured: vi.fn(),
  getUser: vi.fn(),
  from: vi.fn(),
  insert: vi.fn(),
  delete: vi.fn(),
  eq: vi.fn(),
  storageFrom: vi.fn(),
  adminStorageFrom: vi.fn(),
  createSignedUploadUrl: vi.fn(),
  rpc: vi.fn(),
  checkRateLimit: vi.fn(),
  cancelStagedMaterial: vi.fn(),
  storePrivateMaterial: vi.fn(),
  extractMaterialWithRecovery: vi.fn(),
  assessMaterialQuality: vi.fn(),
  mapAndPersistMaterial: vi.fn(),
  reserve: vi.fn(),
  settle: vi.fn(),
  release: vi.fn(),
  recover: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: mocks.createClient,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: mocks.createAdmin,
  isSupabaseAdminConfigured: mocks.isAdminConfigured,
}));
vi.mock("@/lib/server/rate-limit", () => ({
  checkMaterialUploadRateLimit: mocks.checkRateLimit,
  requestRateLimitKey: () => "material-route-test",
}));
vi.mock("@/lib/materials/extract", () => ({
  MaterialExtractionError: class MaterialExtractionError extends Error {},
}));
vi.mock("@/lib/materials/extract-with-recovery", () => ({
  extractMaterialWithRecovery: mocks.extractMaterialWithRecovery,
}));
vi.mock("@/lib/materials/quality", () => ({
  assessMaterialQuality: mocks.assessMaterialQuality,
}));
vi.mock("@/lib/materials/storage-upload", () => ({
  storePrivateMaterial: mocks.storePrivateMaterial,
}));
vi.mock("@/lib/materials/material-understanding", () => ({
  MATERIAL_MAPPING_ROUTE_BUDGET_MS: 90_000,
  mapAndPersistMaterialWithConsumedAIUsage: mocks.mapAndPersistMaterial,
}));
vi.mock("@/lib/materials/staged-cleanup", () => ({
  cancelStagedMaterial: mocks.cancelStagedMaterial,
}));
vi.mock("@/lib/server/ai-usage", () => ({
  reserveAIRequest: mocks.reserve,
  settleAIRequestClaim: mocks.settle,
  refundAIRequestClaimBeforeProvider: mocks.release,
  refundAIRequestReservationBeforeProvider: mocks.recover,
}));

import { DELETE, PATCH, POST, PUT } from "@/app/api/materials/route";
import { MaterialStageResponseSchema } from "@/lib/materials/schema";

beforeEach(() => {
  mocks.isAdminConfigured.mockReturnValue(true);
  mocks.adminStorageFrom.mockReturnValue({ admin: true });
  mocks.createAdmin.mockReturnValue({
    storage: { from: mocks.adminStorageFrom },
  });
});

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
    expect(mocks.createAdmin).not.toHaveBeenCalled();
  });

  it("fails closed when the verified same-origin fallback has no admin storage boundary", async () => {
    const activeLookup = queryResult({
      data: {
        storage_path: `${USER_ID}/22222222-2222-4222-8222-222222222222/source.txt`,
        mime_type: "text/plain",
        byte_size: 5,
      },
      error: null,
    });
    mocks.createClient.mockResolvedValue({
      auth: { getUser: mocks.getUser },
      from: vi.fn(() => activeLookup.builder),
    });
    mocks.isAdminConfigured.mockReturnValue(false);
    const form = new FormData();
    form.set("materialId", "22222222-2222-4222-8222-222222222222");
    form.set("file", new File(["notes"], "notes.txt", { type: "text/plain" }));

    const response = await PUT(new Request("https://yova.example/api/materials", {
      method: "PUT",
      body: form,
    }));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      error: expect.stringContaining("secure upload fallback"),
      requestId: expect.any(String),
    }));
    expect(mocks.createAdmin).not.toHaveBeenCalled();
    expect(mocks.storePrivateMaterial).not.toHaveBeenCalled();
  });

  it("requires cancel and re-stage when the exact Storage path already conflicts", async () => {
    const activeLookup = queryResult({
      data: {
        storage_path: `${USER_ID}/22222222-2222-4222-8222-222222222222/source.txt`,
        mime_type: "text/plain",
        byte_size: 5,
      },
      error: null,
    });
    mocks.createClient.mockResolvedValue({
      auth: { getUser: mocks.getUser },
      from: vi.fn(() => activeLookup.builder),
    });
    mocks.storePrivateMaterial.mockResolvedValueOnce({
      ok: false,
      reason: "object-conflict",
    });
    const form = new FormData();
    form.set("materialId", "22222222-2222-4222-8222-222222222222");
    form.set("file", new File(["notes"], "notes.txt", { type: "text/plain" }));

    const response = await PUT(new Request("https://yova.example/api/materials", {
      method: "PUT",
      body: form,
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "material_storage_object_conflict",
      retryable: false,
    });
    expect(mocks.cancelStagedMaterial).not.toHaveBeenCalled();
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
    expect(mocks.adminStorageFrom).toHaveBeenCalledWith("learning-materials");
    expect(mocks.storePrivateMaterial).toHaveBeenCalledWith(
      { admin: true },
      `${USER_ID}/22222222-2222-4222-8222-222222222222/source.txt`,
      expect.any(File),
      "text/plain",
    );
    expect(mocks.cancelStagedMaterial).toHaveBeenCalledWith(expect.anything(), "22222222-2222-4222-8222-222222222222");
    expect(activeLookup.gt).toHaveBeenCalledWith("expires_at", expect.any(String));
    expect(expiredLookup.gt).toHaveBeenCalledWith("expires_at", expect.any(String));
  });
});

describe("material processing AI allowance and single flight", () => {
  const materialId = "22222222-2222-4222-8222-222222222222";
  const claimId = "33333333-3333-4333-8333-333333333333";

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUser.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });
    mocks.reserve.mockResolvedValue({
      allowed: true,
      claimId,
      operationKey: materialId,
      reservationState: "reserved",
      replayed: false,
      retryAfterSeconds: 0,
      remainingToday: 2,
    });
    mocks.settle.mockResolvedValue(true);
    mocks.release.mockResolvedValue(true);
    mocks.recover.mockResolvedValue(false);
    mocks.mapAndPersistMaterial.mockResolvedValue({ role: "content_source" });
    mocks.assessMaterialQuality.mockReturnValue({
      status: "ready",
      wordCount: 24,
      notice: null,
    });
    mocks.cancelStagedMaterial.mockResolvedValue({
      status: "removed",
      logicalRemovalCommitted: true,
    });
  });

  it("uses the material id as a durable lease before mapping and settles success", async () => {
    configureReadyMaterial();

    const response = await PATCH(processRequest(materialId));

    expect(response.status).toBe(200);
    expect(mocks.reserve).toHaveBeenCalledWith(
      expect.anything(),
      "material_processing",
      materialId,
      expect.any(String),
    );
    expect(mocks.reserve.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.settle.mock.invocationCallOrder[0],
    );
    expect(mocks.settle.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.mapAndPersistMaterial.mock.invocationCallOrder[0],
    );
    expect(mocks.settle).toHaveBeenCalledWith(expect.anything(), claimId);
    expect(mocks.release).not.toHaveBeenCalled();
  });

  it("rejects a concurrent duplicate before any provider mapping work", async () => {
    configureReadyMaterial();
    mocks.reserve.mockResolvedValueOnce({
      allowed: false,
      claimId: null,
      operationKey: materialId,
      denialReason: "operation_in_progress",
      retryAfterSeconds: 37,
      remainingToday: 2,
    });

    const response = await PATCH(processRequest(materialId));

    expect(response.status).toBe(409);
    expect(response.headers.get("retry-after")).toBe("37");
    await expect(response.json()).resolves.toMatchObject({
      code: "ai_operation_in_progress",
      retryable: true,
    });
    expect(mocks.mapAndPersistMaterial).not.toHaveBeenCalled();
    expect(mocks.settle).not.toHaveBeenCalled();
  });

  it("returns a retryable quota response without mapping or cancelling the upload", async () => {
    configureReadyMaterial();
    mocks.reserve.mockResolvedValueOnce({
      allowed: false,
      claimId: null,
      operationKey: materialId,
      denialReason: "usage_limit",
      retryAfterSeconds: 600,
      remainingToday: 0,
    });

    const response = await PATCH(processRequest(materialId));

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("600");
    expect(mocks.mapAndPersistMaterial).not.toHaveBeenCalled();
    expect(mocks.cancelStagedMaterial).not.toHaveBeenCalled();
  });

  it("keeps failed provider mapping consumed before cleaning up", async () => {
    configureReadyMaterial();
    mocks.mapAndPersistMaterial.mockRejectedValueOnce(new Error("provider unavailable"));
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await PATCH(processRequest(materialId));

    expect(response.status).toBe(503);
    expect(mocks.settle).toHaveBeenCalledWith(expect.anything(), claimId);
    expect(mocks.release).not.toHaveBeenCalled();
    expect(mocks.cancelStagedMaterial).toHaveBeenCalledOnce();
    errorLog.mockRestore();
  });

  it("releases failure known to occur before any provider-capable work", async () => {
    const upload = queryResult({
      data: {
        id: materialId,
        filename: "biology.txt",
        storage_path: `${USER_ID}/${materialId}/source.txt`,
        mime_type: "text/plain",
        byte_size: 2,
        processing_status: "processing",
        metadata: {},
        expires_at: "2026-09-05T12:00:00.000Z",
      },
      error: null,
    });
    mocks.createClient.mockResolvedValue({
      auth: { getUser: mocks.getUser },
      from: vi.fn(() => upload.builder),
      storage: {
        from: vi.fn(() => ({
          download: vi.fn().mockResolvedValue({ data: new Blob(["x"]), error: null }),
        })),
      },
    });
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await PATCH(processRequest(materialId));

    expect(response.status).toBe(422);
    expect(mocks.release).toHaveBeenCalledWith(expect.anything(), claimId);
    expect(mocks.settle).not.toHaveBeenCalled();
    expect(mocks.extractMaterialWithRecovery).not.toHaveBeenCalled();
    errorLog.mockRestore();
  });

  function configureReadyMaterial() {
    const upload = queryResult({
      data: {
        id: materialId,
        filename: "biology.txt",
        storage_path: `${USER_ID}/${materialId}/source.txt`,
        mime_type: "text/plain",
        byte_size: 200,
        processing_status: "ready",
        metadata: { mappingStatus: "failed" },
        expires_at: "2026-09-05T12:00:00.000Z",
      },
      error: null,
    });
    const extracted = queryResult({
      data: {
        extracted_text: "Cell respiration converts stored chemical energy into ATP through several linked stages.",
        metadata: { mappingStatus: "failed", pageCount: null, textTruncated: false },
      },
      error: null,
    });
    const from = vi.fn()
      .mockReturnValueOnce(upload.builder)
      .mockReturnValueOnce(extracted.builder);
    mocks.createClient.mockResolvedValue({
      auth: { getUser: mocks.getUser },
      from,
    });
  }
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

function processRequest(materialId: string) {
  return new Request("https://yova.example/api/materials", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ materialId }),
  });
}

function queryResult(result: { data: unknown; error: unknown }) {
  const maybeSingle = vi.fn().mockResolvedValue(result);
  const gt = vi.fn(() => ({ maybeSingle }));
  const eq = vi.fn(() => ({ gt }));
  const select = vi.fn(() => ({ eq }));
  return { builder: { select }, gt };
}
