import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const USER_ID = "11111111-1111-4111-8111-111111111111";

const mocks = vi.hoisted(() => ({
  after: vi.fn(),
  assessQuality: vi.fn(),
  checkRateLimit: vi.fn(),
  createClient: vi.fn(),
  fetchArticle: vi.fn(),
  fetchYouTubeTitle: vi.fn(),
  getUser: vi.fn(),
  insert: vi.fn(),
  mapMaterial: vi.fn(),
  remove: vi.fn(),
  storageFrom: vi.fn(),
  tableFrom: vi.fn(),
  upload: vi.fn(),
}));

vi.mock("next/server", async (importOriginal) => ({
  ...await importOriginal<typeof import("next/server")>(),
  after: mocks.after,
}));
vi.mock("@/lib/materials/external-fetch", () => ({
  ExternalSourceError: class ExternalSourceError extends Error {},
  fetchArticleSource: mocks.fetchArticle,
  fetchYouTubeTitle: mocks.fetchYouTubeTitle,
}));
vi.mock("@/lib/materials/quality", () => ({ assessMaterialQuality: mocks.assessQuality }));
vi.mock("@/lib/materials/material-understanding", () => ({ mapAndPersistMaterial: mocks.mapMaterial }));
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
    mocks.remove.mockResolvedValue({ error: null });
    mocks.storageFrom.mockReturnValue({ upload: mocks.upload, remove: mocks.remove });
    mocks.tableFrom.mockReturnValue({ insert: mocks.insert });
    mocks.createClient.mockResolvedValue({
      auth: { getUser: mocks.getUser },
      from: mocks.tableFrom,
      storage: { from: mocks.storageFrom },
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
    expect(mocks.insert).toHaveBeenCalledOnce();
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
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
    errorLog.mockRestore();
  });

  it("does not misreport a committed import when background mapping cannot be scheduled", async () => {
    mocks.after.mockImplementationOnce(() => {
      throw new Error("request context unavailable");
    });
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await POST(articleRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(ExternalMaterialReadyResponseSchema.safeParse(body).success).toBe(true);
    expect(mocks.upload).toHaveBeenCalledOnce();
    expect(mocks.insert).toHaveBeenCalledOnce();
    expect(errorLog).toHaveBeenCalledWith(
      "YOVA external material mapping was not scheduled",
      expect.objectContaining({ materialId: body.material.id }),
    );
    errorLog.mockRestore();
  });
});

function articleRequest() {
  return new Request("https://yova.example/api/materials/link", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: "https://article.example/cell-respiration" }),
  });
}
