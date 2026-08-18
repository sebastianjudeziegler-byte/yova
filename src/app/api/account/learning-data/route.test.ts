import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const USER_ID = "11111111-1111-4111-8111-111111111111";
const EXPORT_ID = "22222222-2222-4222-8222-222222222222";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getUser: vi.fn(),
  from: vi.fn(),
  materialsSelect: vi.fn(),
  stagedMaterialsSelect: vi.fn(),
  storageFrom: vi.fn(),
  remove: vi.fn(),
  rpc: vi.fn(),
  isAdminConfigured: vi.fn(),
  createAdmin: vi.fn(),
  adminStorageFrom: vi.fn(),
  adminRemove: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: mocks.createClient,
}));

vi.mock("@/lib/supabase/admin", () => ({
  isSupabaseAdminConfigured: mocks.isAdminConfigured,
  createSupabaseAdminClient: mocks.createAdmin,
}));

import { DELETE } from "@/app/api/account/learning-data/route";

describe("learning-data reset route", () => {
  beforeEach(() => {
    mocks.getUser.mockReset().mockResolvedValue({
      data: { user: { id: USER_ID } },
      error: null,
    });
    mocks.materialsSelect.mockReset().mockResolvedValue({ data: [], error: null });
    mocks.stagedMaterialsSelect.mockReset().mockResolvedValue({ data: [], error: null });
    mocks.from.mockReset().mockImplementation((table: string) => ({
      select: table === "materials" ? mocks.materialsSelect : mocks.stagedMaterialsSelect,
    }));
    mocks.remove.mockReset().mockResolvedValue({ data: [], error: null });
    mocks.storageFrom.mockReset().mockReturnValue({ remove: mocks.remove });
    mocks.rpc.mockReset().mockResolvedValue({ data: { accountExportPaths: [] }, error: null });
    mocks.isAdminConfigured.mockReset().mockReturnValue(true);
    mocks.adminRemove.mockReset().mockResolvedValue({ data: [], error: null });
    mocks.adminStorageFrom.mockReset().mockReturnValue({ remove: mocks.adminRemove });
    mocks.createAdmin.mockReset().mockReturnValue({
      storage: { from: mocks.adminStorageFrom },
    });
    mocks.createClient.mockReset().mockResolvedValue({
      auth: { getUser: mocks.getUser },
      from: mocks.from,
      storage: { from: mocks.storageFrom },
      rpc: mocks.rpc,
    });
  });

  it("requires the explicit in-app confirmation before opening a cloud session", async () => {
    const response = await DELETE(resetRequest(false));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Confirm the learning-data reset inside YOVA.",
    });
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("requires an authenticated account", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });

    const response = await DELETE(resetRequest());

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Sign in before resetting cloud learning data.",
    });
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("treats an authentication lookup error as signed out", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { id: USER_ID } },
      error: { message: "session unavailable" },
    });

    const response = await DELETE(resetRequest());

    expect(response.status).toBe(401);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it.each(["materials", "material_uploads"])(
    "stops before deleting files when the %s inventory is incomplete",
    async (table) => {
      const select = table === "materials" ? mocks.materialsSelect : mocks.stagedMaterialsSelect;
      select.mockResolvedValue({ data: null, error: { message: "database unavailable" } });

      const response = await DELETE(resetRequest());

      expect(response.status).toBe(500);
      await expect(response.json()).resolves.toEqual({
        error: "YOVA could not safely identify all stored learning materials.",
      });
      expect(mocks.remove).not.toHaveBeenCalled();
      expect(mocks.rpc).not.toHaveBeenCalled();
    },
  );

  it("de-duplicates owned paths, ignores foreign paths, and deletes in storage-sized batches", async () => {
    const ownedPaths = Array.from({ length: 205 }, (_, index) => `${USER_ID}/material-${index}.pdf`);
    mocks.materialsSelect.mockResolvedValue({
      data: [
        ...ownedPaths.slice(0, 130).map((storage_path) => ({ storage_path })),
        { storage_path: ownedPaths[0] },
        { storage_path: `different-user/private.pdf` },
        { storage_path: `${USER_ID}-lookalike/private.pdf` },
        { storage_path: null },
      ],
      error: null,
    });
    mocks.stagedMaterialsSelect.mockResolvedValue({
      data: ownedPaths.slice(130).map((storage_path) => ({ storage_path })),
      error: null,
    });

    const response = await DELETE(resetRequest());

    expect(response.status).toBe(204);
    expect(mocks.from.mock.calls).toEqual([["materials"], ["material_uploads"]]);
    expect(mocks.storageFrom).toHaveBeenCalledTimes(3);
    expect(mocks.storageFrom).toHaveBeenNthCalledWith(1, "learning-materials");
    expect(mocks.remove).toHaveBeenCalledTimes(3);
    expect(mocks.remove).toHaveBeenNthCalledWith(1, ownedPaths.slice(0, 100));
    expect(mocks.remove).toHaveBeenNthCalledWith(2, ownedPaths.slice(100, 200));
    expect(mocks.remove).toHaveBeenNthCalledWith(3, ownedPaths.slice(200));
    expect(mocks.rpc).toHaveBeenCalledOnce();
    expect(mocks.rpc).toHaveBeenCalledWith("reset_yova_learning_data");
  });

  it("does not call storage when the account has no uploaded files", async () => {
    mocks.isAdminConfigured.mockReturnValue(false);

    const response = await DELETE(resetRequest());

    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expect(mocks.storageFrom).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(mocks.createAdmin).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledWith("reset_yova_learning_data");
  });

  it("removes every exact account-export path returned by the atomic reset", async () => {
    const paths = [
      `${USER_ID}/${EXPORT_ID}/device-state.json`,
      `${USER_ID}/${EXPORT_ID}/yova-data.json`,
    ];
    mocks.rpc.mockResolvedValue({ data: { accountExportPaths: paths }, error: null });

    const response = await DELETE(resetRequest());

    expect(response.status).toBe(204);
    expect(mocks.adminStorageFrom).toHaveBeenCalledWith("account-exports");
    expect(mocks.adminRemove).toHaveBeenCalledWith(paths);
  });

  it("commits local clearing after reset while ignoring a foreign or non-derived export path", async () => {
    mocks.rpc.mockResolvedValue({
      data: { accountExportPaths: [`33333333-3333-4333-8333-333333333333/${EXPORT_ID}/yova-data.json`] },
      error: null,
    });

    const response = await DELETE(resetRequest());

    expect(response.status).toBe(204);
    expect(mocks.createAdmin).not.toHaveBeenCalled();
    expect(mocks.adminRemove).not.toHaveBeenCalled();
  });

  it("returns success so local data clears while cancelled export rows wait for configured cleanup", async () => {
    mocks.rpc.mockResolvedValue({
      data: { accountExportPaths: [`${USER_ID}/${EXPORT_ID}/yova-data.json`] },
      error: null,
    });
    mocks.isAdminConfigured.mockReturnValue(false);

    const response = await DELETE(resetRequest());

    expect(response.status).toBe(204);
    expect(mocks.createAdmin).not.toHaveBeenCalled();
  });

  it("returns success after commit when export Storage needs the leased cleanup retry", async () => {
    mocks.rpc.mockResolvedValue({
      data: { accountExportPaths: [`${USER_ID}/${EXPORT_ID}/yova-data.json`] },
      error: null,
    });
    mocks.adminRemove.mockResolvedValue({ data: null, error: { message: "storage unavailable" } });

    const response = await DELETE(resetRequest());

    expect(response.status).toBe(204);
    expect(mocks.adminRemove).toHaveBeenCalledOnce();
    expect(mocks.rpc).toHaveBeenCalledWith("reset_yova_learning_data");
  });

  it("still clears local data when post-commit admin initialization throws", async () => {
    mocks.rpc.mockResolvedValue({
      data: { accountExportPaths: [`${USER_ID}/${EXPORT_ID}/yova-data.json`] },
      error: null,
    });
    mocks.createAdmin.mockImplementation(() => {
      throw new Error("secret unavailable");
    });

    const response = await DELETE(resetRequest());

    expect(response.status).toBe(204);
    expect(mocks.rpc).toHaveBeenCalledWith("reset_yova_learning_data");
  });

  it("stops the database reset if a private file batch cannot be removed", async () => {
    mocks.materialsSelect.mockResolvedValue({
      data: [{ storage_path: `${USER_ID}/material.pdf` }],
      error: null,
    });
    mocks.remove.mockResolvedValue({ data: null, error: { message: "storage unavailable" } });

    const response = await DELETE(resetRequest());

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "YOVA stopped because it could not remove every private uploaded file.",
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("reports a partial reset when file deletion succeeds but the RPC fails", async () => {
    mocks.stagedMaterialsSelect.mockResolvedValue({
      data: [{ storage_path: `${USER_ID}/staged.pdf` }],
      error: null,
    });
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "database unavailable" } });

    const response = await DELETE(resetRequest());

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "The files were removed, but YOVA could not finish resetting the learning records. Try again.",
    });
    expect(mocks.remove).toHaveBeenCalledWith([`${USER_ID}/staged.pdf`]);
  });
});

function resetRequest(confirmed = true) {
  return new Request("https://yova.example/api/account/learning-data", {
    method: "DELETE",
    headers: confirmed ? { "X-Yova-Confirm": "reset-learning-data" } : undefined,
  });
}
