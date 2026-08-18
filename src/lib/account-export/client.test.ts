import { beforeEach, describe, expect, it, vi } from "vitest";

const ACCOUNT_ID = "11111111-1111-4111-8111-111111111111";
const EXPORT_ID = "22222222-2222-4222-8222-222222222222";
const GRANT = "g".repeat(48);

const mocks = vi.hoisted(() => ({
  loadSnapshot: vi.fn(),
  loadCompletions: vi.fn(),
  loadInterruptions: vi.fn(),
  loadCheckpoints: vi.fn(),
  requestEmail: vi.fn(),
  verifyEmail: vi.fn(),
}));

vi.mock("@/lib/persistence/preview-store", () => ({
  readPreviewSnapshotForExport: mocks.loadSnapshot,
}));
vi.mock("@/lib/sync/session-completion-outbox", () => ({
  readQueuedSessionCompletionsForExport: mocks.loadCompletions,
}));
vi.mock("@/lib/sync/session-interruption-outbox", () => ({
  readQueuedSessionInterruptionsForExport: mocks.loadInterruptions,
}));
vi.mock("@/lib/learning/active-session-checkpoint", () => ({
  readActiveSessionCheckpointsForExport: mocks.loadCheckpoints,
}));
vi.mock("@/lib/auth/client", () => ({
  requestEmailAuthentication: mocks.requestEmail,
  verifyEmailAuthenticationCode: mocks.verifyEmail,
}));

import {
  AccountDataExportError,
  prepareAccountDataExport,
  requestAccountDataExportVerification,
  verifyAccountDataExportCode,
} from "@/lib/account-export/client";

describe("account-export client", () => {
  beforeEach(() => {
    mocks.loadSnapshot.mockReset().mockReturnValue({ ok: true, value: null });
    mocks.loadCompletions.mockReset().mockReturnValue({ ok: true, value: [] });
    mocks.loadInterruptions.mockReset().mockReturnValue({ ok: true, value: [] });
    mocks.loadCheckpoints.mockReset().mockReturnValue({ ok: true, value: [] });
    mocks.requestEmail.mockReset().mockResolvedValue({ mode: "supabase" });
    mocks.verifyEmail.mockReset().mockResolvedValue({ id: ACCOUNT_ID });
    vi.unstubAllGlobals();
  });

  it("sends only canonical current-device JSON through same-origin routes", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        status: "ready_to_finalize",
        exportId: EXPORT_ID,
        finalizeGrant: GRANT,
        prepareExpiresAt: "2026-08-17T12:15:00.000Z",
      }))
      .mockResolvedValueOnce(jsonResponse({
        downloadUrl: "https://storage.example/download",
        filename: "yova-data-2026-08-17T12-00-00Z.json",
        expiresAt: "2026-08-17T12:05:00.000Z",
      }));
    vi.stubGlobal("fetch", fetch);

    const ready = await prepareAccountDataExport(ACCOUNT_ID);

    expect(ready.downloadUrl).toBe("https://storage.example/download");
    expect(mocks.loadCompletions).toHaveBeenCalledWith(ACCOUNT_ID);
    expect(mocks.loadInterruptions).toHaveBeenCalledWith(ACCOUNT_ID);
    expect(mocks.loadCheckpoints).toHaveBeenCalledWith(ACCOUNT_ID);
    expect(fetch).toHaveBeenCalledTimes(2);
    const [startUrl, startInit] = fetch.mock.calls[0] as [string, RequestInit];
    expect(startUrl).toBe("/api/account/data-export");
    expect(startInit).toMatchObject({
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
    });
    expect(startInit.headers).toMatchObject({
      "X-Yova-Data-Export": "account-data",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(startInit.body as string)).toEqual({
      deviceState: expect.objectContaining({
        accountId: ACCOUNT_ID,
        previewSnapshot: null,
      }),
    });
    const [, finalizeInit] = fetch.mock.calls[1] as [string, RequestInit];
    expect(finalizeInit.method).toBe("PUT");
    expect(JSON.parse(finalizeInit.body as string)).toEqual({
      exportId: EXPORT_ID,
      finalizeGrant: GRANT,
    });
  });

  it("does not include a snapshot from another account", async () => {
    mocks.loadSnapshot.mockReturnValue({
      ok: true,
      value: { account: { id: "33333333-3333-4333-8333-333333333333" } },
    });
    const fetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        status: "ready_to_finalize",
        exportId: EXPORT_ID,
        finalizeGrant: GRANT,
        prepareExpiresAt: "2026-08-17T12:15:00.000Z",
      }))
      .mockResolvedValueOnce(jsonResponse({
        downloadUrl: "https://storage.example/download",
        filename: "yova-data-2026-08-17T12-00-00Z.json",
        expiresAt: "2026-08-17T12:05:00.000Z",
      }));
    vi.stubGlobal("fetch", fetch);

    await prepareAccountDataExport(ACCOUNT_ID);

    const body = JSON.parse((fetch.mock.calls[0][1] as RequestInit).body as string);
    expect(body.deviceState.previewSnapshot).toBeNull();
  });

  it("surfaces reauthentication and durable rate limits as typed states", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(
      { error: "Verify again.", code: "reauth_required" },
      403,
    )));
    await expect(prepareAccountDataExport(ACCOUNT_ID)).rejects.toMatchObject({
      name: "AccountDataExportError",
      code: "reauth_required",
    });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(
      { error: "Wait before trying again.", code: "rate_limited" },
      429,
    )));
    await expect(prepareAccountDataExport(ACCOUNT_ID)).rejects.toMatchObject({
      code: "rate_limited",
    });
  });

  it("best-effort revokes a started job when finalization fails", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        status: "ready_to_finalize",
        exportId: EXPORT_ID,
        finalizeGrant: GRANT,
        prepareExpiresAt: "2026-08-17T12:15:00.000Z",
      }))
      .mockResolvedValueOnce(jsonResponse({ error: "Failed.", code: "failed" }, 500))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetch);

    await expect(prepareAccountDataExport(ACCOUNT_ID)).rejects.toBeInstanceOf(AccountDataExportError);

    expect(fetch).toHaveBeenCalledTimes(3);
    const [revokeUrl, revokeInit] = fetch.mock.calls[2] as [string, RequestInit];
    expect(revokeUrl).toBe("/api/account/data-export");
    expect(revokeInit.method).toBe("DELETE");
    expect(revokeInit.headers).toMatchObject({
      "X-Yova-Data-Export": "account-data",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(revokeInit.body as string)).toEqual({ exportId: EXPORT_ID });
  });

  it("stops before reading browser data when already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(prepareAccountDataExport(ACCOUNT_ID, { signal: controller.signal })).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(mocks.loadSnapshot).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed when any known current-device store cannot be read", async () => {
    mocks.loadInterruptions.mockReturnValue({ ok: false });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(prepareAccountDataExport(ACCOUNT_ID)).rejects.toMatchObject({
      code: "failed",
      message: expect.stringContaining("could not safely read all data saved in this browser"),
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses existing-account OTP only and rejects a code that opens another account", async () => {
    await requestAccountDataExportVerification("person@example.com", "captcha-token");
    expect(mocks.requestEmail).toHaveBeenCalledWith({
      email: "person@example.com",
      displayName: "",
      shouldCreateUser: false,
      captchaToken: "captcha-token",
    });

    mocks.verifyEmail.mockResolvedValue({ id: "33333333-3333-4333-8333-333333333333" });
    await expect(verifyAccountDataExportCode(
      ACCOUNT_ID,
      "person@example.com",
      "123456",
    )).rejects.toMatchObject({ code: "failed" });
  });
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
