import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const USER_ID = "11111111-1111-4111-8111-111111111111";

const mocks = vi.hoisted(() => ({
  assessQuality: vi.fn(),
  checkRateLimit: vi.fn(),
  createClient: vi.fn(),
  fetchArticle: vi.fn(),
  fetchYouTubeTitle: vi.fn(),
  getUser: vi.fn(),
  delete: vi.fn(),
  eq: vi.fn(),
  insert: vi.fn(),
  mapMaterial: vi.fn(),
  remove: vi.fn(),
  storageFrom: vi.fn(),
  tableFrom: vi.fn(),
  upload: vi.fn(),
  cancelStagedMaterial: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/lib/materials/external-fetch", () => ({
  ExternalSourceError: class ExternalSourceError extends Error {},
  fetchArticleSource: mocks.fetchArticle,
  fetchYouTubeTitle: mocks.fetchYouTubeTitle,
}));
vi.mock("@/lib/materials/quality", () => ({ assessMaterialQuality: mocks.assessQuality }));
vi.mock("@/lib/materials/material-understanding", () => ({
  MATERIAL_MAPPING_ROUTE_BUDGET_MS: 90_000,
  mapAndPersistMaterial: mocks.mapMaterial,
}));
vi.mock("@/lib/materials/staged-cleanup", () => ({
  cancelStagedMaterial: mocks.cancelStagedMaterial,
}));
vi.mock("@/lib/server/rate-limit", () => ({
  checkMaterialUploadRateLimit: mocks.checkRateLimit,
  requestRateLimitKey: () => "material-link-route-test",
}));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: mocks.createClient }));

import { POST } from "@/app/api/materials/link/route";
import { ExternalMaterialReadyResponseSchema } from "@/lib/materials/external-source-schema";

describe("linked material write response", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUser.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });
    mocks.checkRateLimit.mockReturnValue({ allowed: true, retryAfterSeconds: 0 });
    mocks.fetchArticle.mockResolvedValue({
      canonicalUrl: "https://article.example/cell-respiration",
      title: "Cellular respiration",
      text: "Cellular respiration transfers energy through a sequence of reactions. ".repeat(8),
      truncated: false,
    });
    mocks.assessQuality.mockReturnValue({ status: "ready", wordCount: 72, notice: null });
    mocks.upload.mockResolvedValue({ error: null });
    mocks.insert.mockResolvedValue({ error: null });
    mocks.delete.mockReturnValue({ eq: mocks.eq });
    mocks.eq.mockResolvedValue({ error: null });
    mocks.remove.mockResolvedValue({ error: null });
    mocks.mapMaterial.mockResolvedValue(undefined);
    mocks.cancelStagedMaterial.mockResolvedValue({ status: "cleanup_pending", logicalRemovalCommitted: true });
    mocks.rpc.mockResolvedValue({ data: true, error: null });
    mocks.storageFrom.mockReturnValue({ upload: mocks.upload, remove: mocks.remove });
    mocks.tableFrom.mockReturnValue({ insert: mocks.insert, delete: mocks.delete });
    mocks.createClient.mockResolvedValue({
      auth: { getUser: mocks.getUser },
      from: mocks.tableFrom,
      storage: { from: mocks.storageFrom },
      rpc: mocks.rpc,
    });
  });

  it("returns a schema-valid response for the committed material", async () => {
    const response = await POST(articleRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(ExternalMaterialReadyResponseSchema.safeParse(body).success).toBe(true);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-yova-request-id")).toBeTruthy();
    expect(mocks.upload).toHaveBeenCalledOnce();
    expect(mocks.rpc).toHaveBeenCalledWith("create_material_upload", {
      payload: expect.objectContaining({
        processingStatus: "processing",
        metadata: expect.objectContaining({ mappingStatus: "processing" }),
      }),
    });
    expect(mocks.mapMaterial).toHaveBeenCalledWith(expect.objectContaining({
      deadlineAt: expect.any(Number),
    }));
    expect(mocks.rpc.mock.invocationCallOrder[0]).toBeLessThan(mocks.upload.mock.invocationCallOrder[0]);
  });

  it("rejects an invalid final canonical URL before Storage or Postgres is mutated", async () => {
    mocks.fetchArticle.mockResolvedValueOnce({
      canonicalUrl: `https://article.example/${"a".repeat(2_100)}`,
      title: "Redirected article",
      text: "A useful redirected article with enough readable learning content. ".repeat(8),
      truncated: false,
    });
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await POST(articleRequest());
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(body.error).toBe("YOVA could not import this link. Try again or add the material another way.");
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalledWith("create_material_upload", expect.anything());
    expect(mocks.remove).not.toHaveBeenCalled();
    errorLog.mockRestore();
  });

  it("rolls back a committed import before inviting a retry when mapping fails", async () => {
    mocks.mapMaterial.mockRejectedValueOnce(new Error("provider unavailable"));
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await POST(articleRequest());
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toMatchObject({
      code: "external_material_mapping_failed_cleanup_pending",
      committed: true,
      cleanupPending: true,
      retryable: true,
    });
    expect(mocks.upload).toHaveBeenCalledOnce();
    expect(mocks.rpc).toHaveBeenCalledWith("create_material_upload", expect.anything());
    expect(mocks.cancelStagedMaterial).toHaveBeenCalledWith(expect.anything(), expect.any(String));
    expect(errorLog).toHaveBeenCalledWith(
      "YOVA external material mapping failed",
      expect.objectContaining({ materialId: expect.any(String) }),
    );
    errorLog.mockRestore();
  });

  it("reports an ambiguous cancellation instead of inviting a duplicate after Storage fails", async () => {
    mocks.upload.mockResolvedValueOnce({ error: { message: "storage unavailable" } });
    mocks.cancelStagedMaterial.mockResolvedValueOnce({
      status: "outcome_unconfirmed",
      logicalRemovalCommitted: "unknown",
    });

    const response = await POST(articleRequest());
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toMatchObject({
      code: "external_material_storage_cleanup_outcome_unconfirmed",
      committed: "unknown",
    });
    expect(mocks.rpc).toHaveBeenCalledWith("create_material_upload", expect.anything());
    expect(mocks.cancelStagedMaterial).toHaveBeenCalledOnce();
    expect(mocks.mapMaterial).not.toHaveBeenCalled();
  });
});

function articleRequest() {
  return new Request("https://yova.example/api/materials/link", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: "https://article.example/cell-respiration" }),
  });
}
