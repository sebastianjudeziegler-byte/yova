import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  accountExportFinalPath,
  accountExportTempPath,
  exportFilename,
  finalizeAccountDataArtifact,
} from "@/lib/account-export/server";
import { ACCOUNT_EXPORT_DEVICE_MAX_BYTES } from "@/lib/account-export/schema";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const EXPORT_ID = "22222222-2222-4222-8222-222222222222";
const NOW = new Date("2026-08-17T12:34:56.789Z");

describe("finalizeAccountDataArtifact", () => {
  const rpc = vi.fn();
  const download = vi.fn();
  const upload = vi.fn();
  const remove = vi.fn();
  const createSignedUrl = vi.fn();
  const bucket = { download, upload, remove, createSignedUrl };
  const admin = { storage: { from: vi.fn(() => bucket) } };

  beforeEach(() => {
    rpc.mockReset().mockResolvedValue({
      data: { recordCount: 0, plans: [], aiUsageWindows: [{ requestCount: 2 }] },
      error: null,
    });
    download.mockReset().mockResolvedValue({
      data: new Blob([JSON.stringify(deviceAddendum())], { type: "application/json" }),
      error: null,
    });
    upload.mockReset().mockResolvedValue({ data: { path: "ok" }, error: null });
    remove.mockReset().mockResolvedValue({ data: [], error: null });
    createSignedUrl.mockReset().mockResolvedValue({
      data: { signedUrl: "https://storage.example/private-download" },
      error: null,
    });
  });

  it("builds a bounded allowlisted JSON artifact and returns a short direct link", async () => {
    const ready = await finalizeAccountDataArtifact({
      authenticated: { rpc } as never,
      admin: admin as never,
      user: user() as never,
      exportId: EXPORT_ID,
      now: NOW,
    });

    expect(ready).toEqual({
      downloadUrl: "https://storage.example/private-download",
      filename: "yova-data-2026-08-17T12-34-56Z.json",
      expiresAt: "2026-08-17T12:39:56.789Z",
      sizeBytes: expect.any(Number),
    });
    expect(download).toHaveBeenCalledWith(accountExportTempPath(USER_ID, EXPORT_ID));
    expect(upload).toHaveBeenCalledWith(
      accountExportFinalPath(USER_ID, EXPORT_ID),
      expect.any(Blob),
      { contentType: "application/json", cacheControl: "0", upsert: false },
    );
    const artifact = JSON.parse(await (upload.mock.calls[0][1] as Blob).text()) as {
      account: Record<string, unknown>;
      exportScope: Record<string, unknown>;
    };
    expect(artifact.account).toEqual({
      id: USER_ID,
      email: "person@example.com",
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: null,
      lastSignInAt: null,
      emailConfirmedAt: "2026-08-02T00:00:00.000Z",
      emailConfirmed: true,
      isAnonymous: false,
      providers: ["email"],
      profileMetadata: {
        displayName: "Person",
        termsVersion: "2026-08",
        termsAcceptedAt: null,
        ageConfirmation: null,
      },
    });
    expect(artifact.account).not.toHaveProperty("role");
    expect(JSON.stringify(artifact.account)).not.toContain("raw-secret");
    expect(artifact.exportScope).toMatchObject({
      originalMaterialFilesIncluded: false,
      signInTokensIncluded: false,
      providerLogsIncluded: false,
      serviceUsageCountersIncluded: true,
      internalSecurityLogsIncluded: false,
    });
    expect(remove).toHaveBeenCalledWith([accountExportTempPath(USER_ID, EXPORT_ID)]);
    expect(createSignedUrl).toHaveBeenCalledWith(
      accountExportFinalPath(USER_ID, EXPORT_ID),
      300,
      { download: "yova-data-2026-08-17T12-34-56Z.json" },
    );
  });

  it("rejects cross-account device state before collecting cloud records", async () => {
    download.mockResolvedValue({
      data: new Blob([JSON.stringify(deviceAddendum("33333333-3333-4333-8333-333333333333"))]),
      error: null,
    });

    await expect(finalizeAccountDataArtifact({
      authenticated: { rpc } as never,
      admin: admin as never,
      user: user() as never,
      exportId: EXPORT_ID,
    })).rejects.toMatchObject({ code: "failed" });
    expect(rpc).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
  });

  it("fails closed when the temporary device file exceeds its hard limit", async () => {
    download.mockResolvedValue({
      data: new Blob(["x".repeat(ACCOUNT_EXPORT_DEVICE_MAX_BYTES + 1)]),
      error: null,
    });

    await expect(finalizeAccountDataArtifact({
      authenticated: { rpc } as never,
      admin: admin as never,
      user: user() as never,
      exportId: EXPORT_ID,
    })).rejects.toEqual(expect.objectContaining({ code: "too_large" }));
  });

  it("maps an atomic database limit to a truthful too-large failure", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: "54000", message: "account_export_limit_exceeded" },
    });

    await expect(finalizeAccountDataArtifact({
      authenticated: { rpc } as never,
      admin: admin as never,
      user: user() as never,
      exportId: EXPORT_ID,
    })).rejects.toMatchObject({ code: "too_large" });
    expect(upload).not.toHaveBeenCalled();
  });

  it("fails closed when the cloud result does not carry a trustworthy record count", async () => {
    rpc.mockResolvedValue({ data: { plans: [] }, error: null });

    await expect(finalizeAccountDataArtifact({
      authenticated: { rpc } as never,
      admin: admin as never,
      user: user() as never,
      exportId: EXPORT_ID,
    })).rejects.toMatchObject({ code: "failed" });
    expect(upload).not.toHaveBeenCalled();
  });

  it("enforces the 25,000-record cap across cloud and device records", async () => {
    rpc.mockResolvedValue({ data: { recordCount: 24_999 }, error: null });
    download.mockResolvedValue({
      data: new Blob([JSON.stringify({
        ...deviceAddendum(),
        pendingSessionInterruptions: [pendingInterruption()],
        activeSessionCheckpoints: [activeCheckpoint()],
      })]),
      error: null,
    });

    await expect(finalizeAccountDataArtifact({
      authenticated: { rpc } as never,
      admin: admin as never,
      user: user() as never,
      exportId: EXPORT_ID,
    })).rejects.toMatchObject({ code: "too_large" });
    expect(upload).not.toHaveBeenCalled();
  });

  it("removes the artifact if a signed download link cannot be created", async () => {
    createSignedUrl.mockResolvedValue({ data: null, error: { message: "signing unavailable" } });

    await expect(finalizeAccountDataArtifact({
      authenticated: { rpc } as never,
      admin: admin as never,
      user: user() as never,
      exportId: EXPORT_ID,
    })).rejects.toMatchObject({ code: "failed" });
    expect(remove).toHaveBeenNthCalledWith(1, [accountExportTempPath(USER_ID, EXPORT_ID)]);
    expect(remove).toHaveBeenNthCalledWith(2, [accountExportFinalPath(USER_ID, EXPORT_ID)]);
  });
});

describe("exportFilename", () => {
  it("contains only the UTC time and never an account identifier", () => {
    expect(exportFilename(NOW)).toBe("yova-data-2026-08-17T12-34-56Z.json");
    expect(exportFilename(NOW)).not.toContain(USER_ID);
  });
});

function deviceAddendum(accountId = USER_ID) {
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

function user() {
  return {
    id: USER_ID,
    email: "person@example.com",
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: null,
    last_sign_in_at: null,
    email_confirmed_at: "2026-08-02T00:00:00.000Z",
    is_anonymous: false,
    role: "authenticated",
    app_metadata: {
      provider: "email",
      providers: ["email", "../../../raw-secret"],
      app_role: "founder",
    },
    user_metadata: {
      display_name: "Person",
      terms_version: "2026-08",
      sign_in_token: "raw-secret",
      identities: [{ token: "raw-secret" }],
    },
  };
}

function pendingInterruption() {
  return {
    userId: USER_ID,
    interruption: {
      id: "33333333-3333-4333-8333-333333333333",
      planId: "44444444-4444-4444-8444-444444444444",
      planSessionId: "55555555-5555-4555-8555-555555555555",
      startedAt: "2026-08-17T11:00:00.000Z",
      interruptedAt: "2026-08-17T11:10:00.000Z",
      plannedMinutes: 25,
      actualMinutes: 10,
      completedSteps: 1,
      totalSteps: 4,
    },
    queuedAt: "2026-08-17T11:10:00.000Z",
  };
}

function activeCheckpoint() {
  return {
    version: 1,
    accountId: USER_ID,
    runId: "66666666-6666-4666-8666-666666666666",
    planId: "44444444-4444-4444-8444-444444444444",
    planSessionId: "55555555-5555-4555-8555-555555555555",
    status: "working",
    startedAt: "2026-08-17T11:00:00.000Z",
    savedAt: "2026-08-17T11:05:00.000Z",
    activeSeconds: 300,
    plannedMinutes: 25,
    completedSteps: 1,
    totalSteps: 4,
    resumeStep: 1,
    resourceFingerprint: "sr1:0123456789abcdef",
  };
}
