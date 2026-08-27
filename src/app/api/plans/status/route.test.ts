import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const USER_ID = "11111111-1111-4111-8111-111111111111";
const PLAN_ID = "22222222-2222-4222-8222-222222222222";
const ITEM_ID = "33333333-3333-4333-8333-333333333333";
const CLEANUP_ID = "44444444-4444-4444-8444-444444444444";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  rpc: vi.fn(),
  createServer: vi.fn(),
  cleanupConfigured: vi.fn(),
  createAdmin: vi.fn(),
  cleanup: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: mocks.createServer }));
vi.mock("@/lib/account-export/config", () => ({
  isAccountExportCleanupConfigured: mocks.cleanupConfigured,
}));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: mocks.createAdmin }));
vi.mock("@/lib/account-deletion/cleanup", () => ({ cleanupDeletedAccountStorage: mocks.cleanup }));

import { DELETE, PATCH } from "@/app/api/plans/status/route";

describe("learning-plan status route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUser.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });
    mocks.rpc.mockResolvedValue({
      data: { deletedPlanId: PLAN_ID, deletedLearningItemId: ITEM_ID, cleanupJobId: CLEANUP_ID },
      error: null,
    });
    mocks.createServer.mockResolvedValue({ auth: { getUser: mocks.getUser }, rpc: mocks.rpc });
    mocks.cleanupConfigured.mockReturnValue(true);
    mocks.createAdmin.mockReturnValue({ role: "service" });
    mocks.cleanup.mockResolvedValue({ ok: true, claimedJobs: 1, removedJobs: 1, retryJobs: 0 });
  });

  it.each([
    ["archive", "archived"],
    ["restore", "active"],
  ] as const)("keeps authenticated %s routed through the atomic archive RPC", async (action, status) => {
    mocks.rpc.mockResolvedValueOnce({
      data: { planId: PLAN_ID, status },
      error: null,
    });

    const response = await PATCH(new Request("https://yova.example/api/plans/status", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planId: PLAN_ID, action }),
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      planId: PLAN_ID,
      status,
      persistence: "supabase",
    });
    expect(mocks.rpc).toHaveBeenCalledWith("set_learning_plan_archive_state", {
      payload: { planId: PLAN_ID, action },
    });
  });

  it("rejects missing app proof, cross-site requests, and non-JSON before auth", async () => {
    const missing = await DELETE(request({}, true, false));
    const wrongOrigin = await DELETE(request({ Origin: "https://attacker.example" }));
    const crossSite = await DELETE(request({ "Sec-Fetch-Site": "cross-site" }));
    const wrongType = await DELETE(request({ "Content-Type": "text/plain" }));

    expect([missing.status, wrongOrigin.status, crossSite.status, wrongType.status]).toEqual([400, 403, 403, 415]);
    expect(mocks.getUser).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("fails closed before mutation when durable private-file cleanup is unavailable", async () => {
    mocks.cleanupConfigured.mockReturnValue(false);

    const response = await DELETE(request());

    expect(response.status).toBe(503);
    expect(mocks.getUser).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("requires an authenticated account and exact typed confirmation", async () => {
    mocks.getUser.mockResolvedValueOnce({ data: { user: null }, error: null });
    const signedOut = await DELETE(request());
    const wrongConfirmation = await DELETE(request({}, false));

    expect(signedOut.status).toBe(401);
    expect(wrongConfirmation.status).toBe(422);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("passes only the validated plan id to the atomic owner-scoped RPC", async () => {
    const response = await DELETE(request());

    expect(response.status).toBe(204);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(mocks.rpc).toHaveBeenCalledWith("delete_archived_learning_plan", {
      payload: { planId: PLAN_ID },
    });
    expect(mocks.cleanup).toHaveBeenCalledWith({ role: "service" }, { limit: 100 });
  });

  it("returns success after commit when immediate Storage cleanup must retry", async () => {
    mocks.cleanup.mockRejectedValue(new Error("temporary Storage outage"));

    const response = await DELETE(request());

    expect(response.status).toBe(204);

    mocks.createAdmin.mockImplementationOnce(() => { throw new Error("admin initialization unavailable"); });
    const adminUnavailable = await DELETE(request());
    expect(adminUnavailable.status).toBe(204);
  });

  it("fails truthfully when SQL rejects an active, missing, shared, or oversized goal", async () => {
    for (const error of [
      { code: "55000", message: "plan_deletion_requires_archived" },
      { code: "PDP01", message: "plan_deletion_not_found" },
      { code: "21000", message: "plan_deletion_shared_learning_item" },
      { code: "54000", message: "plan_deletion_cleanup_limit_exceeded" },
    ]) {
      mocks.rpc.mockResolvedValueOnce({ data: null, error });
      const response = await DELETE(request());
      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining("Nothing was changed") });
    }
    expect(mocks.cleanup).not.toHaveBeenCalled();
  });
});

function request(
  headers: Record<string, string> = {},
  validConfirmation = true,
  includeAppHeader = true,
) {
  return new Request("https://yova.example/api/plans/status", {
    method: "DELETE",
    headers: {
      Origin: "https://yova.example",
      "Content-Type": "application/json",
      ...(includeAppHeader ? { "X-Yova-Confirm": "delete-archived-plan" } : {}),
      ...headers,
    },
    body: JSON.stringify({ planId: PLAN_ID, confirmation: validConfirmation ? "DELETE" : "delete" }),
  });
}
