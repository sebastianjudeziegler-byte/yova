import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  cleanup: vi.fn(),
  deletionCleanup: vi.fn(),
  materialCleanup: vi.fn(),
  receiptCleanup: vi.fn(),
  adminConfigured: vi.fn(),
  createAdmin: vi.fn(),
}));

vi.mock("@/lib/account-export/cleanup", () => ({
  cleanupExpiredAccountExports: mocks.cleanup,
}));

vi.mock("@/lib/account-deletion/cleanup", () => ({
  cleanupDeletedAccountStorage: mocks.deletionCleanup,
}));

vi.mock("@/lib/materials/staged-cleanup", () => ({
  cleanupExpiredStagedMaterials: mocks.materialCleanup,
}));

vi.mock("@/lib/storage-cleanup/private-receipts", () => ({
  cleanupPrivateStorageReceipts: mocks.receiptCleanup,
}));

vi.mock("@/lib/supabase/admin", () => ({
  isSupabaseAdminConfigured: mocks.adminConfigured,
  createSupabaseAdminClient: mocks.createAdmin,
}));

import { GET } from "@/app/api/internal/account-export-cleanup/route";

const SECRET = "cron-secret-that-is-at-least-thirty-two-characters";
const originalSecret = process.env.CRON_SECRET;

describe("account-export cleanup cron route", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = SECRET;
    mocks.adminConfigured.mockReset().mockReturnValue(true);
    mocks.createAdmin.mockReset().mockReturnValue({ role: "service" });
    mocks.cleanup.mockReset().mockResolvedValue({
      ok: true,
      claimedJobs: 3,
      removedJobs: 2,
      retryJobs: 0,
    });
    mocks.deletionCleanup.mockReset().mockResolvedValue({
      ok: true,
      claimedJobs: 1,
      removedJobs: 1,
      retryJobs: 0,
    });
    mocks.materialCleanup.mockReset().mockResolvedValue({
      ok: true,
      claimedUploads: 4,
      removedUploads: 4,
      retryUploads: 0,
    });
    mocks.receiptCleanup.mockReset().mockResolvedValue({
      ok: true,
      claimedReceipts: 2,
      sweptReceipts: 2,
      retryReceipts: 0,
    });
  });

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = originalSecret;
  });

  it("fails closed when the secret or service-role client is not configured", async () => {
    process.env.CRON_SECRET = "short";
    const noSecret = await GET(request(SECRET));
    expect(noSecret.status).toBe(503);

    process.env.CRON_SECRET = SECRET;
    mocks.adminConfigured.mockReturnValue(false);
    const noAdmin = await GET(request(SECRET));
    expect(noAdmin.status).toBe(503);
    expect(mocks.createAdmin).not.toHaveBeenCalled();
    expect(mocks.cleanup).not.toHaveBeenCalled();
    expect(mocks.deletionCleanup).not.toHaveBeenCalled();
    expect(mocks.materialCleanup).not.toHaveBeenCalled();
    expect(mocks.receiptCleanup).not.toHaveBeenCalled();
  });

  it("rejects a CRON_SECRET with surrounding whitespace instead of comparing a trimmed value", async () => {
    process.env.CRON_SECRET = ` ${SECRET} `;

    const response = await GET(request(` ${SECRET} `));

    expect(response.status).toBe(503);
    expect(mocks.cleanup).not.toHaveBeenCalled();
    expect(mocks.deletionCleanup).not.toHaveBeenCalled();
    expect(mocks.materialCleanup).not.toHaveBeenCalled();
    expect(mocks.receiptCleanup).not.toHaveBeenCalled();
  });

  it("rejects missing, wrong-length, and wrong-value Bearer credentials", async () => {
    const missing = await GET(request());
    const wrongLength = await GET(request("wrong"));
    const wrongValue = await GET(request("x".repeat(SECRET.length)));

    expect([missing.status, wrongLength.status, wrongValue.status]).toEqual([401, 401, 401]);
    expect(mocks.cleanup).not.toHaveBeenCalled();
  });

  it("runs the leased cleanup and returns only bounded counts", async () => {
    const response = await GET(request(SECRET));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      claimedJobs: 3,
      removedJobs: 2,
      retryJobs: 0,
      deletionClaimedJobs: 1,
      deletionRemovedJobs: 1,
      deletionRetryJobs: 0,
      materialClaimedUploads: 4,
      materialRemovedUploads: 4,
      materialRetryUploads: 0,
      receiptClaimedPaths: 2,
      receiptSweptPaths: 2,
      receiptRetryPaths: 0,
    });
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(mocks.cleanup).toHaveBeenCalledWith({ role: "service" });
    expect(mocks.deletionCleanup).toHaveBeenCalledWith({ role: "service" });
    expect(mocks.materialCleanup).toHaveBeenCalledWith({ role: "service" });
    expect(mocks.receiptCleanup).toHaveBeenCalledWith({ role: "service" });
  });

  it("retries when deleted-account Storage cleanup cannot finish", async () => {
    mocks.deletionCleanup.mockResolvedValue({
      ok: false,
      claimedJobs: 1,
      removedJobs: 0,
      retryJobs: 1,
      privatePath: "must-not-leak",
    });

    const response = await GET(request(SECRET));

    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("must-not-leak");
  });

  it("does not disclose job contents when a cleanup run needs retry", async () => {
    mocks.cleanup.mockResolvedValue({
      ok: false,
      claimedJobs: 1,
      removedJobs: 0,
      retryJobs: 1,
      privatePath: "must-not-leak",
    });

    const response = await GET(request(SECRET));

    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("must-not-leak");
  });

  it("retries when expired staged-material cleanup cannot finish", async () => {
    mocks.materialCleanup.mockResolvedValue({
      ok: false,
      claimedUploads: 1,
      removedUploads: 0,
      retryUploads: 1,
      privatePath: "must-not-leak",
    });

    const response = await GET(request(SECRET));

    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("must-not-leak");
  });

  it("retries when a retained final-sweep receipt cannot finish", async () => {
    mocks.receiptCleanup.mockResolvedValue({
      ok: false,
      claimedReceipts: 1,
      sweptReceipts: 0,
      retryReceipts: 1,
      privatePath: "must-not-leak",
    });

    const response = await GET(request(SECRET));

    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("must-not-leak");
  });
});

function request(secret?: string) {
  return new Request("https://yova.example/api/internal/account-export-cleanup", {
    headers: secret ? { Authorization: `Bearer ${secret}` } : undefined,
  });
}
