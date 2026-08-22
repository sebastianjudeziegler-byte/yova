import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { cleanupPrivateStorageReceipts } from "@/lib/storage-cleanup/private-receipts";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const RECEIPT_ID = "22222222-2222-4222-8222-222222222222";
const TOKEN = "33333333-3333-4333-8333-333333333333";

describe("durable private Storage cleanup receipts", () => {
  const rpc = vi.fn();
  const remove = vi.fn();
  const from = vi.fn(() => ({ remove }));
  const admin = { rpc, storage: { from } } as never;

  beforeEach(() => {
    rpc.mockReset().mockImplementation((name: string) => {
      if (name === "claim_private_storage_cleanup_receipts") {
        return Promise.resolve({ data: [claim()], error: null });
      }
      return Promise.resolve({ data: true, error: null });
    });
    remove.mockReset().mockResolvedValue({ data: [], error: null });
    from.mockClear();
  });

  it("sweeps one exact path and lets the database retain or finalize the receipt", async () => {
    await expect(cleanupPrivateStorageReceipts(admin, { limit: 5_000 })).resolves.toEqual({
      ok: true,
      claimedReceipts: 1,
      sweptReceipts: 1,
      retryReceipts: 0,
    });
    expect(rpc).toHaveBeenCalledWith("claim_private_storage_cleanup_receipts", {
      requested_limit: 1_000,
    });
    expect(from).toHaveBeenCalledWith("learning-materials");
    expect(remove).toHaveBeenCalledWith([`${USER_ID}/material/source.pdf`]);
    expect(rpc).toHaveBeenCalledWith("confirm_private_storage_cleanup_receipt", {
      requested_cleanup_receipt_id: RECEIPT_ID,
      requested_cleanup_token: TOKEN,
    });
  });

  it("releases the lease when Storage fails so the exact path is retried", async () => {
    remove.mockResolvedValue({ data: null, error: { message: "unavailable" } });

    await expect(cleanupPrivateStorageReceipts(admin)).resolves.toEqual({
      ok: false,
      claimedReceipts: 1,
      sweptReceipts: 0,
      retryReceipts: 1,
    });
    expect(rpc).toHaveBeenCalledWith("release_private_storage_cleanup_receipt", {
      requested_cleanup_receipt_id: RECEIPT_ID,
      requested_cleanup_token: TOKEN,
    });
    expect(rpc).not.toHaveBeenCalledWith("confirm_private_storage_cleanup_receipt", expect.anything());
  });

  it("sweeps a database-inventoried opaque legacy key as one exact JSON path", async () => {
    const opaquePath = `${USER_ID}/../legacy\u0001source`;
    rpc.mockResolvedValueOnce({
      data: [claim({ storage_path: opaquePath, legacy_opaque_path: true })],
      error: null,
    });

    await expect(cleanupPrivateStorageReceipts(admin)).resolves.toMatchObject({
      ok: true,
      sweptReceipts: 1,
    });
    expect(remove).toHaveBeenCalledWith([opaquePath]);
  });

  it.each([
    { bucket_id: "public-assets" },
    { storage_path: "another-user/private.pdf" },
    { storage_path: `${USER_ID}/../escape` },
    { storage_path: "another-user/../escape", legacy_opaque_path: true },
    { legacy_opaque_path: "yes" },
    { sweep_phase: "unknown" },
  ])("rejects a malformed or over-broad claim %#", async (override) => {
    rpc.mockResolvedValueOnce({ data: [claim(override)], error: null });

    await expect(cleanupPrivateStorageReceipts(admin)).resolves.toEqual({
      ok: false,
      claimedReceipts: 1,
      sweptReceipts: 0,
      retryReceipts: 1,
    });
    expect(from).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });
});

function claim(overrides: Record<string, unknown> = {}) {
  return {
    cleanup_receipt_id: RECEIPT_ID,
    user_id: USER_ID,
    bucket_id: "learning-materials",
    storage_path: `${USER_ID}/material/source.pdf`,
    legacy_opaque_path: false,
    cleanup_token: TOKEN,
    sweep_phase: "initial",
    ...overrides,
  };
}
