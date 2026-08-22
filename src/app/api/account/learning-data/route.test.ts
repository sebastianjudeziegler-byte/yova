import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const USER_ID = "11111111-1111-4111-8111-111111111111";
const MATERIAL_ID = "22222222-2222-4222-8222-222222222222";
const EXPORT_ID = "33333333-3333-4333-8333-333333333333";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getUser: vi.fn(),
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
    mocks.rpc.mockReset().mockResolvedValue({
      data: { learningMaterialPaths: [], accountExportPaths: [] },
      error: null,
    });
    mocks.isAdminConfigured.mockReset().mockReturnValue(true);
    mocks.adminRemove.mockReset().mockResolvedValue({ data: [], error: null });
    mocks.adminStorageFrom.mockReset().mockReturnValue({ remove: mocks.adminRemove });
    mocks.createAdmin.mockReset().mockReturnValue({
      storage: { from: mocks.adminStorageFrom },
    });
    mocks.createClient.mockReset().mockResolvedValue({
      auth: { getUser: mocks.getUser },
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
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("commits the transactional logical reset before best-effort Storage sweeps", async () => {
    const events: string[] = [];
    const learningPath = `${USER_ID}/${MATERIAL_ID}/source.pdf`;
    const exportPath = `${USER_ID}/${EXPORT_ID}/yova-data.json`;
    mocks.rpc.mockImplementation(async () => {
      events.push("database-reset");
      return {
        data: {
          learningMaterialPaths: [learningPath],
          accountExportPaths: [exportPath],
        },
        error: null,
      };
    });
    mocks.adminRemove.mockImplementation(async () => {
      events.push("storage-sweep");
      return { data: [], error: null };
    });

    const response = await DELETE(resetRequest());

    expect(response.status).toBe(204);
    expect(events).toEqual(["database-reset", "storage-sweep", "storage-sweep"]);
    expect(mocks.rpc).toHaveBeenCalledWith("reset_yova_learning_data");
    expect(mocks.adminStorageFrom).toHaveBeenNthCalledWith(1, "learning-materials");
    expect(mocks.adminStorageFrom).toHaveBeenNthCalledWith(2, "account-exports");
    expect(mocks.adminRemove).toHaveBeenNthCalledWith(1, [learningPath]);
    expect(mocks.adminRemove).toHaveBeenNthCalledWith(2, [exportPath]);
  });

  it("de-duplicates exact receipt paths and sweeps in bounded Storage batches", async () => {
    const paths = Array.from(
      { length: 1_001 },
      (_, index) => `${USER_ID}/${MATERIAL_ID}/source-${index}.pdf`,
    );
    mocks.rpc.mockResolvedValue({
      data: { learningMaterialPaths: [...paths, paths[0]], accountExportPaths: [] },
      error: null,
    });

    const response = await DELETE(resetRequest());

    expect(response.status).toBe(204);
    expect(mocks.adminRemove).toHaveBeenCalledTimes(2);
    expect(mocks.adminRemove).toHaveBeenNthCalledWith(1, paths.slice(0, 1_000));
    expect(mocks.adminRemove).toHaveBeenNthCalledWith(2, paths.slice(1_000));
  });

  it("still clears local data when no private Storage paths exist", async () => {
    const response = await DELETE(resetRequest());

    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expect(mocks.createAdmin).not.toHaveBeenCalled();
  });

  it("refuses malformed or foreign RPC paths while trusting the durable receipt", async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        learningMaterialPaths: [`another-user/${MATERIAL_ID}/source.pdf`],
        accountExportPaths: [],
      },
      error: null,
    });

    const response = await DELETE(resetRequest());

    expect(response.status).toBe(204);
    expect(mocks.createAdmin).not.toHaveBeenCalled();
  });

  it("does not let a legacy opaque owner key block reset or the immediate sweep of safe keys", async () => {
    const safePath = `${USER_ID}/${MATERIAL_ID}/source.pdf`;
    mocks.rpc.mockResolvedValue({
      data: {
        learningMaterialPaths: [safePath, `${USER_ID}/../legacy\u0001source`],
        accountExportPaths: [],
      },
      error: null,
    });

    const response = await DELETE(resetRequest());

    expect(response.status).toBe(204);
    expect(mocks.adminRemove).toHaveBeenCalledWith([safePath]);
  });

  it("returns success after commit when admin cleanup is unavailable", async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        learningMaterialPaths: [`${USER_ID}/${MATERIAL_ID}/source.pdf`],
        accountExportPaths: [],
      },
      error: null,
    });
    mocks.isAdminConfigured.mockReturnValue(false);

    const response = await DELETE(resetRequest());

    expect(response.status).toBe(204);
    expect(mocks.createAdmin).not.toHaveBeenCalled();
  });

  it("returns success after commit when the immediate sweep fails", async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        learningMaterialPaths: [`${USER_ID}/${MATERIAL_ID}/source.pdf`],
        accountExportPaths: [],
      },
      error: null,
    });
    mocks.adminRemove.mockResolvedValue({ data: null, error: { message: "unavailable" } });

    const response = await DELETE(resetRequest());

    expect(response.status).toBe(204);
    expect(mocks.adminRemove).toHaveBeenCalledOnce();
  });

  it("still clears local data when post-commit admin initialization throws", async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        learningMaterialPaths: [`${USER_ID}/${MATERIAL_ID}/source.pdf`],
        accountExportPaths: [],
      },
      error: null,
    });
    mocks.createAdmin.mockImplementation(() => {
      throw new Error("secret unavailable");
    });

    const response = await DELETE(resetRequest());

    expect(response.status).toBe(204);
  });

  it("reports a fully rolled-back reset when the transactional RPC fails", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "database unavailable" } });

    const response = await DELETE(resetRequest());

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "YOVA could not reset the learning records. Nothing was changed. Try again.",
    });
    expect(mocks.createAdmin).not.toHaveBeenCalled();
  });
});

function resetRequest(confirmed = true) {
  return new Request("https://yova.example/api/account/learning-data", {
    method: "DELETE",
    headers: confirmed ? { "X-Yova-Confirm": "reset-learning-data" } : undefined,
  });
}
