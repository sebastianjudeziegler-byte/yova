import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const adminMocks = vi.hoisted(() => ({
  configured: vi.fn(),
  create: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  isSupabaseAdminConfigured: adminMocks.configured,
  createSupabaseAdminClient: adminMocks.create,
}));

import {
  cancelStagedMaterial,
  cleanupExpiredStagedMaterials,
} from "@/lib/materials/staged-cleanup";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const MATERIAL_ID = "22222222-2222-4222-8222-222222222222";
const TOKEN = "33333333-3333-4333-8333-333333333333";
const STORAGE_PATH = `${USER_ID}/${MATERIAL_ID}/source.pdf`;

describe("staged material cleanup", () => {
  const rpc = vi.fn();
  const remove = vi.fn();
  const client = {
    rpc,
    storage: { from: vi.fn(() => ({ remove })) },
  };

  beforeEach(() => {
    rpc.mockReset();
    remove.mockReset().mockResolvedValue({ error: null });
    adminMocks.configured.mockReset().mockReturnValue(false);
    adminMocks.remove.mockReset().mockResolvedValue({ error: null });
    adminMocks.create.mockReset().mockReturnValue({
      storage: { from: vi.fn(() => ({ remove: adminMocks.remove })) },
    });
  });

  it("logically cancels before exact Storage removal and token confirmation", async () => {
    rpc.mockImplementation((name: string) => {
      if (name === "claim_material_upload_cleanup") return Promise.resolve({
        data: explicitClaim(),
        error: null,
      });
      if (name === "confirm_material_upload_cleanup") return Promise.resolve({ data: true, error: null });
      throw new Error(`Unexpected RPC ${name}`);
    });

    await expect(cancelStagedMaterial(client as never, MATERIAL_ID)).resolves.toEqual({
      status: "removed",
      logicalRemovalCommitted: true,
    });
    expect(rpc).toHaveBeenNthCalledWith(1, "claim_material_upload_cleanup", {
      requested_material_id: MATERIAL_ID,
    });
    expect(remove).toHaveBeenCalledWith([STORAGE_PATH]);
    expect(rpc).toHaveBeenNthCalledWith(2, "confirm_material_upload_cleanup", {
      requested_material_id: MATERIAL_ID,
      requested_cleanup_token: TOKEN,
    });
  });

  it("uses service-role Storage for the immediate sweep after logical cancellation", async () => {
    adminMocks.configured.mockReturnValue(true);
    rpc.mockImplementation((name: string) => {
      if (name === "claim_material_upload_cleanup") return Promise.resolve({
        data: explicitClaim(),
        error: null,
      });
      if (name === "confirm_material_upload_cleanup") return Promise.resolve({ data: true, error: null });
      throw new Error(`Unexpected RPC ${name}`);
    });

    await expect(cancelStagedMaterial(client as never, MATERIAL_ID)).resolves.toEqual({
      status: "removed",
      logicalRemovalCommitted: true,
    });
    expect(adminMocks.remove).toHaveBeenCalledWith([STORAGE_PATH]);
    expect(remove).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith("confirm_material_upload_cleanup", {
      requested_material_id: MATERIAL_ID,
      requested_cleanup_token: TOKEN,
    });
  });

  it("reports committed cleanup-pending and releases the lease when Storage fails", async () => {
    rpc.mockImplementation((name: string) => {
      if (name === "claim_material_upload_cleanup") return Promise.resolve({ data: explicitClaim(), error: null });
      if (name === "release_material_upload_cleanup") return Promise.resolve({ data: true, error: null });
      throw new Error(`Unexpected RPC ${name}`);
    });
    remove.mockResolvedValue({ error: { message: "unavailable" } });

    await expect(cancelStagedMaterial(client as never, MATERIAL_ID)).resolves.toEqual({
      status: "cleanup_pending",
      logicalRemovalCommitted: true,
    });
    expect(rpc).toHaveBeenCalledWith("release_material_upload_cleanup", {
      requested_material_id: MATERIAL_ID,
      requested_cleanup_token: TOKEN,
    });
  });

  it("never treats an ambiguous claim response as a confirmed cancellation", async () => {
    rpc.mockResolvedValue({ data: { status: "claimed", materialId: MATERIAL_ID }, error: null });

    await expect(cancelStagedMaterial(client as never, MATERIAL_ID)).resolves.toEqual({
      status: "outcome_unconfirmed",
      logicalRemovalCommitted: "unknown",
    });
    expect(remove).not.toHaveBeenCalled();
  });

  it.each(["missing", "missing_unconfirmed"])(
    "does not confirm an absent row while a legacy signed capability may still create an orphan (%s)",
    async (status) => {
      rpc.mockResolvedValue({ data: { status }, error: null });

      await expect(cancelStagedMaterial(client as never, MATERIAL_ID)).resolves.toEqual({
        status: "outcome_unconfirmed",
        logicalRemovalCommitted: "unknown",
      });
      expect(remove).not.toHaveBeenCalled();
    },
  );

  it("cleans a bounded cron batch without broad Storage paths", async () => {
    rpc.mockImplementation((name: string) => {
      if (name === "claim_expired_material_uploads") return Promise.resolve({
        data: [cronClaim()],
        error: null,
      });
      if (name === "confirm_material_upload_cleanup") return Promise.resolve({ data: true, error: null });
      throw new Error(`Unexpected RPC ${name}`);
    });

    await expect(cleanupExpiredStagedMaterials(client as never, { limit: 2_000 })).resolves.toEqual({
      ok: true,
      claimedUploads: 1,
      removedUploads: 1,
      retryUploads: 0,
    });
    expect(rpc).toHaveBeenCalledWith("claim_expired_material_uploads", { requested_limit: 1_000 });
    expect(remove).toHaveBeenCalledWith([STORAGE_PATH]);
  });

  it("releases a cron lease for retry when exact Storage removal fails", async () => {
    rpc.mockImplementation((name: string) => {
      if (name === "claim_expired_material_uploads") return Promise.resolve({ data: [cronClaim()], error: null });
      if (name === "release_material_upload_cleanup") return Promise.resolve({ data: true, error: null });
      throw new Error(`Unexpected RPC ${name}`);
    });
    remove.mockResolvedValue({ error: { message: "storage unavailable" } });

    await expect(cleanupExpiredStagedMaterials(client as never)).resolves.toEqual({
      ok: false,
      claimedUploads: 1,
      removedUploads: 0,
      retryUploads: 1,
    });
    expect(rpc).toHaveBeenCalledWith("release_material_upload_cleanup", {
      requested_material_id: MATERIAL_ID,
      requested_cleanup_token: TOKEN,
    });
    expect(rpc).not.toHaveBeenCalledWith("confirm_material_upload_cleanup", expect.anything());
  });

  it("refuses malformed or cross-material paths from the cleanup lease", async () => {
    rpc.mockResolvedValue({
      data: [{ ...cronClaim(), storage_path: `${USER_ID}/another-material/source.pdf` }],
      error: null,
    });

    await expect(cleanupExpiredStagedMaterials(client as never)).resolves.toEqual({
      ok: false,
      claimedUploads: 1,
      removedUploads: 0,
      retryUploads: 1,
    });
    expect(remove).not.toHaveBeenCalled();
  });
});

function explicitClaim() {
  return {
    status: "claimed",
    materialId: MATERIAL_ID,
    userId: USER_ID,
    storagePath: STORAGE_PATH,
    cleanupToken: TOKEN,
  };
}

function cronClaim() {
  return {
    material_id: MATERIAL_ID,
    user_id: USER_ID,
    storage_path: STORAGE_PATH,
    mime_type: "application/pdf",
    cleanup_token: TOKEN,
  };
}
