import { describe, expect, it, vi } from "vitest";
import { storePrivateMaterial, type PrivateMaterialBucket } from "./storage-upload";

function uploadFile(size = 128) {
  return new File([new Uint8Array(size)], "study-guide.pdf", { type: "application/pdf" });
}

function bucket(overrides: Partial<PrivateMaterialBucket> = {}): PrivateMaterialBucket {
  return {
    download: vi.fn().mockResolvedValue({ data: null, error: new Error("not found") }),
    remove: vi.fn().mockResolvedValue({ data: {}, error: null }),
    upload: vi.fn().mockResolvedValue({ data: {}, error: null }),
    ...overrides,
  };
}

describe("same-origin material storage fallback", () => {
  it("uploads a missing object with an insert instead of requiring update permission", async () => {
    const storage = bucket();
    const file = uploadFile();

    await expect(storePrivateMaterial(storage, "user/material/file.pdf", file, file.type)).resolves.toEqual({
      ok: true,
      disposition: "uploaded",
    });
    expect(storage.upload).toHaveBeenCalledWith("user/material/file.pdf", file, {
      contentType: "application/pdf",
      upsert: false,
    });
    expect(storage.remove).not.toHaveBeenCalled();
  });

  it("accepts a signed upload that completed even when the browser reported an error", async () => {
    const file = uploadFile();
    const storage = bucket({
      download: vi.fn().mockResolvedValue({ data: new Blob([new Uint8Array(file.size)]), error: null }),
    });

    await expect(storePrivateMaterial(storage, "user/material/file.pdf", file, file.type)).resolves.toEqual({
      ok: true,
      disposition: "already-present",
    });
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it("removes and replaces an incomplete object", async () => {
    const file = uploadFile(256);
    const storage = bucket({
      download: vi.fn().mockResolvedValue({ data: new Blob([new Uint8Array(12)]), error: null }),
    });

    await expect(storePrivateMaterial(storage, "user/material/file.pdf", file, file.type)).resolves.toEqual({
      ok: true,
      disposition: "replaced-partial",
    });
    expect(storage.remove).toHaveBeenCalledWith(["user/material/file.pdf"]);
  });

  it("verifies a late signed-upload success after the fallback insert races", async () => {
    const file = uploadFile();
    const download = vi.fn()
      .mockResolvedValueOnce({ data: null, error: new Error("not found") })
      .mockResolvedValueOnce({ data: new Blob([new Uint8Array(file.size)]), error: null });
    const storage = bucket({
      download,
      upload: vi.fn().mockResolvedValue({ data: null, error: new Error("duplicate") }),
    });

    await expect(storePrivateMaterial(storage, "user/material/file.pdf", file, file.type)).resolves.toEqual({
      ok: true,
      disposition: "already-present",
    });
  });

  it("returns a bounded failure when neither upload path produced the object", async () => {
    const storage = bucket({
      upload: vi.fn().mockResolvedValue({ data: null, error: new Error("storage unavailable") }),
    });

    await expect(storePrivateMaterial(storage, "user/material/file.pdf", uploadFile(), "application/pdf")).resolves.toEqual({
      ok: false,
      reason: "upload",
    });
  });
});
