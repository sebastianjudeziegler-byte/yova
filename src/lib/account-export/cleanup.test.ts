import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { cleanupExpiredAccountExports } from "@/lib/account-export/cleanup";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const EXPORT_ID = "22222222-2222-4222-8222-222222222222";
const TOKEN = "33333333-3333-4333-8333-333333333333";

describe("cleanupExpiredAccountExports", () => {
  const rpc = vi.fn();
  const remove = vi.fn();
  const admin = {
    rpc,
    storage: { from: vi.fn(() => ({ remove })) },
  };

  beforeEach(() => {
    rpc.mockReset();
    remove.mockReset().mockResolvedValue({ data: [], error: null });
  });

  it("uses the eligible-only lease and token-confirms after exact Storage removal", async () => {
    rpc.mockImplementation((name: string) => {
      if (name === "claim_expired_account_data_exports") {
        return Promise.resolve({ data: [claim()], error: null });
      }
      if (name === "confirm_account_data_export_cleanup") {
        return Promise.resolve({ data: true, error: null });
      }
      throw new Error(`Unexpected RPC ${name}`);
    });

    await expect(cleanupExpiredAccountExports(admin as never)).resolves.toEqual({
      ok: true,
      claimedJobs: 1,
      removedJobs: 1,
      retryJobs: 0,
    });
    expect(remove).toHaveBeenCalledWith([
      `${USER_ID}/${EXPORT_ID}/device-state.json`,
      `${USER_ID}/${EXPORT_ID}/yova-data.json`,
    ]);
    expect(rpc).toHaveBeenNthCalledWith(1, "claim_expired_account_data_exports", { requested_limit: 250 });
    expect(rpc).toHaveBeenNthCalledWith(2, "confirm_account_data_export_cleanup", {
      requested_export_id: EXPORT_ID,
      requested_cleanup_token: TOKEN,
    });
  });

  it("releases the token for retry when Storage fails", async () => {
    rpc.mockImplementation((name: string) => {
      if (name === "claim_expired_account_data_exports") return Promise.resolve({ data: [claim()], error: null });
      if (name === "release_account_data_export_cleanup") return Promise.resolve({ data: true, error: null });
      throw new Error(`Unexpected RPC ${name}`);
    });
    remove.mockResolvedValue({ data: null, error: { message: "storage unavailable" } });

    const result = await cleanupExpiredAccountExports(admin as never);

    expect(result).toEqual({ ok: false, claimedJobs: 1, removedJobs: 0, retryJobs: 1 });
    expect(rpc).toHaveBeenCalledWith("release_account_data_export_cleanup", {
      requested_export_id: EXPORT_ID,
      requested_cleanup_token: TOKEN,
    });
    expect(rpc).not.toHaveBeenCalledWith("confirm_account_data_export_cleanup", expect.anything());
  });

  it("is idempotent when no jobs are eligible and never broad-selects the table", async () => {
    rpc.mockResolvedValue({ data: [], error: null });

    await expect(cleanupExpiredAccountExports(admin as never, { limit: 10 })).resolves.toEqual({
      ok: true,
      claimedJobs: 0,
      removedJobs: 0,
      retryJobs: 0,
    });
    expect(remove).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith("claim_expired_account_data_exports", { requested_limit: 10 });
    expect(admin).not.toHaveProperty("from");
  });

  it("does not remove paths that fail exact server-derived validation", async () => {
    rpc.mockResolvedValue({
      data: [{ ...claim(), final_storage_path: `${USER_ID}/other/yova-data.json` }],
      error: null,
    });

    const result = await cleanupExpiredAccountExports(admin as never);

    expect(result).toEqual({ ok: false, claimedJobs: 1, removedJobs: 0, retryJobs: 1 });
    expect(remove).not.toHaveBeenCalled();
  });
});

function claim() {
  return {
    export_id: EXPORT_ID,
    user_id: USER_ID,
    temp_storage_path: `${USER_ID}/${EXPORT_ID}/device-state.json`,
    final_storage_path: `${USER_ID}/${EXPORT_ID}/yova-data.json`,
    cleanup_token: TOKEN,
  };
}
