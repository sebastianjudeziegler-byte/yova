import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const USER_ID = "11111111-1111-4111-8111-111111111111";
const EXPORT_ID = "22222222-2222-4222-8222-222222222222";
const FINALIZE_GRANT = "g".repeat(48);
const CRON_SECRET = "cron-secret-that-is-at-least-thirty-two-characters";
const originalCronSecret = process.env.CRON_SECRET;

const mocks = vi.hoisted(() => ({
  authenticateStart: vi.fn(),
  authenticateFinalize: vi.fn(),
  createServer: vi.fn(),
  rpc: vi.fn(),
  adminConfigured: vi.fn(),
  createAdmin: vi.fn(),
  storageFrom: vi.fn(),
  upload: vi.fn(),
  remove: vi.fn(),
  finalizeArtifact: vi.fn(),
}));

vi.mock("@/lib/account-export/auth", () => ({
  authenticateAccountExportStart: mocks.authenticateStart,
  authenticateAccountExportFinalize: mocks.authenticateFinalize,
}));

vi.mock("@/lib/account-export/server", () => ({
  accountExportTempPath: (userId: string, exportId: string) => `${userId}/${exportId}/device-state.json`,
  accountExportFinalPath: (userId: string, exportId: string) => `${userId}/${exportId}/yova-data.json`,
  AccountExportServerError: class AccountExportServerError extends Error {
    code: "too_large" | "failed";
    constructor(code: "too_large" | "failed", message: string) {
      super(message);
      this.code = code;
    }
  },
  finalizeAccountDataArtifact: mocks.finalizeArtifact,
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: mocks.createServer,
}));

vi.mock("@/lib/supabase/admin", () => ({
  isSupabaseAdminConfigured: mocks.adminConfigured,
  createSupabaseAdminClient: mocks.createAdmin,
}));

import { DELETE, POST, PUT } from "@/app/api/account/data-export/route";

describe("account data-export route", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = CRON_SECRET;
    vi.restoreAllMocks();
    vi.spyOn(crypto, "randomUUID").mockReturnValue(EXPORT_ID);
    mocks.authenticateStart.mockReset().mockResolvedValue(authSuccess());
    mocks.authenticateFinalize.mockReset().mockResolvedValue(authSuccess());
    mocks.rpc.mockReset().mockImplementation((name: string) => {
      if (name === "begin_account_data_export") {
        return Promise.resolve({
          data: {
            exportId: EXPORT_ID,
            finalizeGrant: FINALIZE_GRANT,
            tempStoragePath: `${USER_ID}/${EXPORT_ID}/device-state.json`,
            prepareExpiresAt: "2026-08-17T12:15:00.000Z",
          },
          error: null,
        });
      }
      if (name === "claim_account_data_export" || name === "complete_account_data_export") {
        return Promise.resolve({ data: true, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    });
    mocks.createServer.mockReset().mockResolvedValue({ rpc: mocks.rpc });
    mocks.adminConfigured.mockReset().mockReturnValue(true);
    mocks.upload.mockReset().mockResolvedValue({ data: { path: "ok" }, error: null });
    mocks.remove.mockReset().mockResolvedValue({ data: [], error: null });
    mocks.storageFrom.mockReset().mockReturnValue({ upload: mocks.upload, remove: mocks.remove });
    mocks.createAdmin.mockReset().mockReturnValue({ storage: { from: mocks.storageFrom } });
    mocks.finalizeArtifact.mockReset().mockResolvedValue({
      downloadUrl: "https://storage.example/download",
      filename: "yova-data-2026-08-17T12-00-00Z.json",
      expiresAt: "2026-08-17T12:05:00.000Z",
      sizeBytes: 1234,
    });
  });

  afterAll(() => {
    if (originalCronSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = originalCronSecret;
  });

  it("rejects missing app proof, cross-site Origin, and cross-site Fetch Metadata before auth", async () => {
    const noHeader = await POST(startRequest({}, {}));
    const wrongOrigin = await POST(startRequest({ Origin: "https://attacker.example" }));
    const crossSite = await POST(startRequest({ "Sec-Fetch-Site": "cross-site" }));

    expect(noHeader.status).toBe(400);
    expect(wrongOrigin.status).toBe(403);
    expect(crossSite.status).toBe(403);
    expect(mocks.authenticateStart).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("rejects an oversized declared body before auth or parsing", async () => {
    const response = await POST(startRequest({ "Content-Length": String(2 * 1024 * 1024 + 20_000) }));

    expect(response.status).toBe(413);
    expect(mocks.authenticateStart).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("stops an oversized streamed body before quota or Storage even without Content-Length", async () => {
    const response = await POST(new Request("https://yova.example/api/account/data-export", {
      method: "POST",
      headers: validHeaders(),
      body: JSON.stringify({ privateDeviceState: "x".repeat(2 * 1024 * 1024 + 20_000) }),
    }));

    expect(response.status).toBe(413);
    expect(mocks.authenticateStart).toHaveBeenCalledOnce();
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("requires the exact application/json media type", async () => {
    const response = await POST(startRequest({ "Content-Type": "application/json-patch+json" }));
    expect(response.status).toBe(415);
    expect(mocks.authenticateStart).not.toHaveBeenCalled();
  });

  it("does not activate exports without the private cleanup credential", async () => {
    delete process.env.CRON_SECRET;

    const response = await POST(startRequest());

    expect(response.status).toBe(503);
    expect(mocks.authenticateStart).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("does not finalize an artifact while cleanup is unavailable", async () => {
    delete process.env.CRON_SECRET;

    const response = await PUT(mutationRequest("PUT", {
      exportId: EXPORT_ID,
      finalizeGrant: FINALIZE_GRANT,
    }));

    expect(response.status).toBe(503);
    expect(mocks.authenticateFinalize).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.finalizeArtifact).not.toHaveBeenCalled();
  });

  it.each(["signed_out", "reauth_required"] as const)(
    "does not read or persist private device state when auth is %s",
    async (reason) => {
      mocks.authenticateStart.mockResolvedValue({ ok: false, reason });
      const text = vi.fn(() => {
        throw new Error("private body must not be read");
      });
      const request = {
        method: "POST",
        url: "https://yova.example/api/account/data-export",
        headers: validHeaders(),
        text,
      } as unknown as Request;

      const response = await POST(request);

      expect(response.status).toBe(reason === "signed_out" ? 401 : 403);
      expect(text).not.toHaveBeenCalled();
      expect(mocks.rpc).not.toHaveBeenCalled();
      expect(mocks.upload).not.toHaveBeenCalled();
    },
  );

  it("starts with a strict current-account addendum and server-uploads the exact temp object", async () => {
    const response = await POST(startRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "ready_to_finalize",
      exportId: EXPORT_ID,
      finalizeGrant: FINALIZE_GRANT,
      prepareExpiresAt: "2026-08-17T12:15:00.000Z",
    });
    expect(mocks.rpc).toHaveBeenCalledWith("begin_account_data_export", {
      requested_export_id: EXPORT_ID,
    });
    expect(mocks.upload).toHaveBeenCalledWith(
      `${USER_ID}/${EXPORT_ID}/device-state.json`,
      JSON.stringify(deviceState()),
      { contentType: "application/json", cacheControl: "0", upsert: false },
    );
    expect(mocks.storageFrom).toHaveBeenCalledWith("account-exports");
  });

  it("does not consume quota or touch Storage for another account's addendum", async () => {
    const response = await POST(startRequest(undefined, {
      deviceState: deviceState("33333333-3333-4333-8333-333333333333"),
    }));

    expect(response.status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it.each([
    ["PXA01", "account_export_hourly_quota_exceeded", "retry_after_seconds=725", "725"],
    ["PXA02", "account_export_daily_quota_exceeded", "retry_after_seconds=999999", "86400"],
  ])("maps %s durable quota errors to 429", async (code, message, details, expectedRetry) => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code, message, details } });

    const response = await POST(startRequest());

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe(expectedRetry);
    await expect(response.json()).resolves.toMatchObject({ code: "rate_limited" });
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("maps the one-active-job guard to 409", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "PXA03", message: "account_export_in_progress" },
    });

    const response = await POST(startRequest());

    expect(response.status).toBe(409);
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("claims once, builds the artifact, and records completion before returning the link", async () => {
    const response = await PUT(mutationRequest("PUT", {
      exportId: EXPORT_ID,
      finalizeGrant: FINALIZE_GRANT,
    }));

    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenNthCalledWith(1, "claim_account_data_export", {
      requested_export_id: EXPORT_ID,
      requested_finalize_grant: FINALIZE_GRANT,
    });
    expect(mocks.finalizeArtifact).toHaveBeenCalledWith(expect.objectContaining({ exportId: EXPORT_ID }));
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, "complete_account_data_export", {
      requested_export_id: EXPORT_ID,
      requested_size_bytes: 1234,
      requested_filename: "yova-data-2026-08-17T12-00-00Z.json",
    });
  });

  it("does not build when the session-bound one-time finalize grant is rejected", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: false, error: null });

    const response = await PUT(mutationRequest("PUT", {
      exportId: EXPORT_ID,
      finalizeGrant: FINALIZE_GRANT,
    }));

    expect(response.status).toBe(409);
    expect(mocks.finalizeArtifact).not.toHaveBeenCalled();
  });

  it("revokes with strict JSON and removes only the signed-in account's derived paths", async () => {
    const response = await DELETE(mutationRequest("DELETE", { exportId: EXPORT_ID }));

    expect(response.status).toBe(204);
    expect(mocks.rpc).toHaveBeenCalledWith("revoke_account_data_export", {
      requested_export_id: EXPORT_ID,
    });
    expect(mocks.remove).toHaveBeenCalledWith([
      `${USER_ID}/${EXPORT_ID}/device-state.json`,
      `${USER_ID}/${EXPORT_ID}/yova-data.json`,
    ]);
  });
});

function authSuccess() {
  return {
    ok: true,
    context: {
      user: {
        id: USER_ID,
        email: "person@example.com",
        email_confirmed_at: "2026-08-17T00:00:00.000Z",
      },
      sessionId: "44444444-4444-4444-8444-444444444444",
    },
  };
}

function deviceState(accountId = USER_ID) {
  return {
    schemaVersion: 1,
    accountId,
    capturedAt: "2026-08-17T12:00:00.000Z",
    previewSnapshot: null,
    pendingSessionCompletions: [],
    pendingSessionInterruptions: [],
    activeSessionCheckpoints: [],
  };
}

function validHeaders(overrides: HeadersInit = {}) {
  return new Headers({
    Origin: "https://yova.example",
    "Content-Type": "application/json",
    "X-Yova-Data-Export": "account-data",
    "Sec-Fetch-Site": "same-origin",
    ...Object.fromEntries(new Headers(overrides)),
  });
}

function startRequest(headers?: HeadersInit, body: unknown = { deviceState: deviceState() }) {
  const effectiveHeaders = headers === undefined
    ? validHeaders()
    : Object.keys(Object.fromEntries(new Headers(headers))).length === 0
      ? new Headers({ Origin: "https://yova.example", "Content-Type": "application/json" })
      : validHeaders(headers);
  return new Request("https://yova.example/api/account/data-export", {
    method: "POST",
    headers: effectiveHeaders,
    body: JSON.stringify(body),
  });
}

function mutationRequest(method: "PUT" | "DELETE", body: unknown) {
  return new Request("https://yova.example/api/account/data-export", {
    method,
    headers: validHeaders(),
    body: JSON.stringify(body),
  });
}
