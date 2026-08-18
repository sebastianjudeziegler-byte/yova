import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const USER_ID = "11111111-1111-4111-8111-111111111111";
const CLEANUP_ID = "22222222-2222-4222-8222-222222222222";

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  createServer: vi.fn(),
  rpc: vi.fn(),
  adminConfigured: vi.fn(),
  createAdmin: vi.fn(),
  cleanup: vi.fn(),
}));

vi.mock("@/lib/account-export/auth", () => ({
  authenticateAccountExportStart: mocks.authenticate,
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: mocks.createServer,
}));

vi.mock("@/lib/supabase/admin", () => ({
  isSupabaseAdminConfigured: mocks.adminConfigured,
  createSupabaseAdminClient: mocks.createAdmin,
}));

vi.mock("@/lib/account-deletion/cleanup", () => ({
  cleanupDeletedAccountStorage: mocks.cleanup,
}));

import { DELETE } from "@/app/api/account/route";

describe("account deletion route", () => {
  beforeEach(() => {
    mocks.authenticate.mockReset().mockResolvedValue({
      ok: true,
      context: {
        user: { id: USER_ID, email: "learner@example.com" },
        sessionId: "33333333-3333-4333-8333-333333333333",
      },
    });
    mocks.rpc.mockReset().mockResolvedValue({
      data: { deletedAccountId: USER_ID, cleanupJobId: CLEANUP_ID },
      error: null,
    });
    mocks.createServer.mockReset().mockResolvedValue({ rpc: mocks.rpc });
    mocks.adminConfigured.mockReset().mockReturnValue(true);
    mocks.createAdmin.mockReset().mockReturnValue({ role: "service" });
    mocks.cleanup.mockReset().mockResolvedValue({ ok: true, claimedJobs: 1, removedJobs: 1, retryJobs: 0 });
  });

  it("rejects missing app proof, cross-site requests, and non-JSON before auth", async () => {
    const missing = await DELETE(request({}, undefined, false));
    const wrongOrigin = await DELETE(request({ Origin: "https://attacker.example" }));
    const crossSite = await DELETE(request({ "Sec-Fetch-Site": "cross-site" }));
    const wrongType = await DELETE(request({ "Content-Type": "text/plain" }));

    expect([missing.status, wrongOrigin.status, crossSite.status, wrongType.status]).toEqual([400, 403, 403, 415]);
    expect(mocks.authenticate).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("fails closed before auth when durable cleanup is unavailable", async () => {
    mocks.adminConfigured.mockReturnValue(false);

    const response = await DELETE(request());

    expect(response.status).toBe(503);
    expect(mocks.authenticate).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("requires a recent verified human sign-in", async () => {
    mocks.authenticate.mockResolvedValue({ ok: false, reason: "reauth_required" });
    const stale = await DELETE(request());
    mocks.authenticate.mockResolvedValue({ ok: false, reason: "unverified_email" });
    const unverified = await DELETE(request());

    expect([stale.status, unverified.status]).toEqual([403, 403]);
    await expect(stale.json()).resolves.toMatchObject({ code: "reauth_required" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("does not accept a browser-supplied account other than the authenticated user", async () => {
    const response = await DELETE(request({}, {
      accountId: "44444444-4444-4444-8444-444444444444",
      confirmation: "DELETE",
    }));

    expect(response.status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("passes only the authenticated account id to the atomic deletion RPC", async () => {
    const response = await DELETE(request());

    expect(response.status).toBe(204);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(mocks.rpc).toHaveBeenCalledWith("delete_yova_account", {
      expected_account_id: USER_ID,
    });
    expect(mocks.cleanup).toHaveBeenCalledWith({ role: "service" }, { limit: 100 });
  });

  it("returns success after the account transaction commits even if immediate Storage cleanup retries", async () => {
    mocks.cleanup.mockRejectedValue(new Error("temporary storage failure"));

    const response = await DELETE(request());

    expect(response.status).toBe(204);
  });

  it("maps SQL reauthentication and cleanup bounds without deleting anything", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "PXD01", message: "account_deletion_reauthentication_required" },
    });
    const stale = await DELETE(request());
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "54000", message: "account_deletion_cleanup_limit_exceeded" },
    });
    const tooManyFiles = await DELETE(request());

    expect(stale.status).toBe(403);
    expect(tooManyFiles.status).toBe(409);
    expect(mocks.cleanup).not.toHaveBeenCalled();
  });
});

function request(
  headers: Record<string, string> = {},
  body: unknown = { accountId: USER_ID, confirmation: "DELETE" },
  includeAppHeader = true,
) {
  return new Request("https://yova.example/api/account", {
    method: "DELETE",
    headers: {
      Origin: "https://yova.example",
      "Content-Type": "application/json",
      ...(includeAppHeader ? { "X-Yova-Confirm": "delete-account" } : {}),
      ...headers,
    },
    body: JSON.stringify(body),
  });
}
