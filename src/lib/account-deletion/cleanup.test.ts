import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { cleanupDeletedAccountStorage } from "@/lib/account-deletion/cleanup";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const JOB_ID = "22222222-2222-4222-8222-222222222222";
const TOKEN = "33333333-3333-4333-8333-333333333333";

describe("deleted-account private Storage cleanup", () => {
  const rpc = vi.fn();
  const remove = vi.fn();
  const from = vi.fn(() => ({ remove }));
  const admin = { rpc, storage: { from } } as never;

  beforeEach(() => {
    rpc.mockReset().mockImplementation((name: string) => {
      if (name === "claim_account_deletion_cleanup_jobs") {
        return Promise.resolve({ data: [claim()], error: null });
      }
      return Promise.resolve({ data: true, error: null });
    });
    remove.mockReset().mockResolvedValue({ data: [], error: null });
    from.mockClear();
  });

  it("removes only exact account-prefixed paths from both private buckets and token-confirms", async () => {
    const result = await cleanupDeletedAccountStorage(admin);

    expect(result).toEqual({ ok: true, claimedJobs: 1, removedJobs: 1, retryJobs: 0 });
    expect(from).toHaveBeenNthCalledWith(1, "learning-materials");
    expect(from).toHaveBeenNthCalledWith(2, "account-exports");
    expect(remove).toHaveBeenNthCalledWith(1, [`${USER_ID}/material/original.pdf`]);
    expect(remove).toHaveBeenNthCalledWith(2, [`${USER_ID}/export/yova-data.json`]);
    expect(rpc).toHaveBeenCalledWith("confirm_account_deletion_cleanup", {
      requested_cleanup_job_id: JOB_ID,
      requested_cleanup_token: TOKEN,
    });
  });

  it("releases the lease when either Storage bucket fails", async () => {
    remove.mockResolvedValueOnce({ data: null, error: new Error("storage unavailable") });

    const result = await cleanupDeletedAccountStorage(admin);

    expect(result).toEqual({ ok: false, claimedJobs: 1, removedJobs: 0, retryJobs: 1 });
    expect(rpc).toHaveBeenCalledWith("release_account_deletion_cleanup", {
      requested_cleanup_job_id: JOB_ID,
      requested_cleanup_token: TOKEN,
    });
    expect(rpc).not.toHaveBeenCalledWith("confirm_account_deletion_cleanup", expect.anything());
  });

  it("rejects mixed-account and traversal claims without touching Storage", async () => {
    rpc.mockResolvedValueOnce({
      data: [claim({ learning_material_paths: ["another-user/private.pdf", `${USER_ID}/../escape`] })],
      error: null,
    });

    const result = await cleanupDeletedAccountStorage(admin);

    expect(result).toEqual({ ok: false, claimedJobs: 1, removedJobs: 0, retryJobs: 1 });
    expect(from).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });
});

function claim(overrides: Record<string, unknown> = {}) {
  return {
    cleanup_job_id: JOB_ID,
    user_id: USER_ID,
    learning_material_paths: [`${USER_ID}/material/original.pdf`],
    account_export_paths: [`${USER_ID}/export/yova-data.json`],
    cleanup_token: TOKEN,
    ...overrides,
  };
}
