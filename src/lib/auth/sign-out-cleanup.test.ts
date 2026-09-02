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

  it("retains account-scoped manual Calendar data across sign-out", () => {
    const calendarState = (accountId: string) => ({
      version: 1,
      accountId,
      manualEvents: [],
      suggestions: [],
      availabilityOverrides: [],
      changeLog: [],
      ui: {
        view: "week",
        anchorDateKey: null,
        selectedBlockId: null,
        whyExpanded: false,
        changeLogExpanded: false,
      },
      updatedAt: "2026-09-01T09:00:00.000Z",
    });
    const values = new Map<string, string>([[
      "yova.calendar.prototype.v1",
      JSON.stringify({
        version: 1,
        accounts: {
          "user-1": calendarState("user-1"),
          "user-2": calendarState("user-2"),
        },
      }),
    ]]);
    vi.stubGlobal("window", {
      localStorage: {
        getItem: vi.fn((key: string) => values.get(key) ?? null),
        setItem: vi.fn((key: string, value: string) => values.set(key, value)),
        removeItem: vi.fn((key: string) => values.delete(key)),
      },
    });

    const before = values.get("yova.calendar.prototype.v1");
    expect(clearConfirmedSignOutStorage("user-1")).toEqual({ fullyCleared: true });
    expect(JSON.parse(values.get("yova.calendar.prototype.v1")!)).toMatchObject({
      accounts: {
        "user-1": { accountId: "user-1" },
        "user-2": { accountId: "user-2" },
      },
    });
    expect(values.get("yova.calendar.prototype.v1")).toBe(before);
  });

  it("clears only the deleted account's Calendar bucket after permanent deletion", () => {
    const calendarState = (accountId: string) => ({
      version: 1,
      accountId,
      manualEvents: [],
      suggestions: [],
      availabilityOverrides: [],
      changeLog: [],
      ui: {
        view: "week",
        anchorDateKey: null,
        selectedBlockId: null,
        whyExpanded: false,
        changeLogExpanded: false,
      },
      updatedAt: "2026-09-01T09:00:00.000Z",
    });
    const values = new Map<string, string>([[
      "yova.calendar.prototype.v1",
      JSON.stringify({
        version: 1,
        accounts: {
          "deleted-user": calendarState("deleted-user"),
          "other-user": calendarState("other-user"),
        },
      }),
    ]]);
    vi.stubGlobal("window", {
      localStorage: {
        getItem: vi.fn((key: string) => values.get(key) ?? null),
        setItem: vi.fn((key: string, value: string) => values.set(key, value)),
        removeItem: vi.fn((key: string) => values.delete(key)),
      },
    });

    expect(clearConfirmedSignOutStorage("deleted-user", {
      clearDeletedAccountCalendar: true,
    })).toEqual({ fullyCleared: true });
    expect(JSON.parse(values.get("yova.calendar.prototype.v1")!)).toMatchObject({
      accounts: {
        "other-user": { accountId: "other-user" },
      },
    });
    expect(JSON.parse(values.get("yova.calendar.prototype.v1")!).accounts)
      .not.toHaveProperty("deleted-user");
  });

  it("uses the existing cleanup warning result when deleted-account Calendar removal fails", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: vi.fn((key: string) => key === "yova.calendar.prototype.v1"
          ? JSON.stringify({
            version: 1,
            accounts: {
              "deleted-user": {
                version: 1,
                accountId: "deleted-user",
                manualEvents: [],
                suggestions: [],
                availabilityOverrides: [],
                changeLog: [],
                ui: {
                  view: "week",
                  anchorDateKey: null,
                  selectedBlockId: null,
                  whyExpanded: false,
                  changeLogExpanded: false,
                },
                updatedAt: "2026-09-01T09:00:00.000Z",
              },
            },
          })
          : null),
        setItem: vi.fn(() => {
          throw new Error("Calendar cleanup rejected");
        }),
        removeItem: vi.fn(() => {
          throw new Error("Calendar cleanup rejected");
        }),
      },
    });

    expect(clearConfirmedSignOutStorage("deleted-user", {
      clearDeletedAccountCalendar: true,
    })).toEqual({ fullyCleared: false });
  });
});
