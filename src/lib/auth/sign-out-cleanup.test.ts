import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearConfirmedSignOutStorage,
  resolveSignOutCleanupAccountId,
  SIGN_OUT_STORAGE_WARNING,
} from "@/lib/auth/sign-out-cleanup";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("confirmed sign-out storage cleanup", () => {
  it("retains the trusted snapshot account scope when a cloud-error screen has null React account state", () => {
    expect(resolveSignOutCleanupAccountId(null, "trusted-cloud-account"))
      .toBe("trusted-cloud-account");
    expect(resolveSignOutCleanupAccountId("current-account", "trusted-cloud-account"))
      .toBe("current-account");
  });

  it("stays non-throwing and returns a bounded warning when browser removal fails", () => {
    const removeItem = vi.fn(() => {
      throw new Error("browser-specific storage detail");
    });
    vi.stubGlobal("window", {
      localStorage: {
        getItem: vi.fn(() => null),
        setItem: vi.fn(),
        removeItem,
      },
    });

    expect(() => clearConfirmedSignOutStorage("user-1")).not.toThrow();
    expect(clearConfirmedSignOutStorage("user-1")).toEqual({ fullyCleared: false });
    expect(removeItem).toHaveBeenCalled();
    expect(SIGN_OUT_STORAGE_WARNING).not.toContain("browser-specific storage detail");
  });

  it("reports complete cleanup when browser storage accepts every removal", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: vi.fn(() => null),
        setItem: vi.fn(),
        removeItem: vi.fn(),
      },
    });

    expect(clearConfirmedSignOutStorage("user-1")).toEqual({ fullyCleared: true });
  });

  it("reports an account-scoped outbox failure even when preview cleanup succeeds", () => {
    const removedKeys: string[] = [];
    vi.stubGlobal("window", {
      localStorage: {
        getItem: vi.fn(() => null),
        setItem: vi.fn(),
        removeItem: vi.fn((key: string) => {
          removedKeys.push(key);
          if (key === "yova.cloud-sync-outbox.v1") {
            throw new Error("completion outbox removal failed");
          }
        }),
      },
    });

    expect(clearConfirmedSignOutStorage("user-1")).toEqual({ fullyCleared: false });
    expect(removedKeys).toContain("yova.preview.v1");
  });
});
