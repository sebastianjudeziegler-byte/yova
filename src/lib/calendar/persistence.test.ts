import { describe, expect, it } from "vitest";
import {
  CALENDAR_PROTOTYPE_STORAGE_KEY,
  appendCalendarChangeLogEntry,
  clearCalendarPrototypeState,
  emptyCalendarPrototypeState,
  loadCalendarPrototypeState,
  removeCalendarManualEventAfterPlanCommit,
  saveCalendarPrototypeState,
} from "@/lib/calendar/persistence";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
    values,
  };
}

describe("calendar prototype persistence", () => {
  it("keeps device-local state isolated by account", () => {
    const storage = memoryStorage();
    const now = new Date("2026-09-02T10:00:00.000Z");
    const first = {
      ...emptyCalendarPrototypeState("account-a", now),
      ui: {
        ...emptyCalendarPrototypeState("account-a", now).ui,
        view: "month" as const,
      },
    };

    expect(saveCalendarPrototypeState(storage, "account-a", first)).toBe(true);
    expect(loadCalendarPrototypeState(storage, "account-a", now).ui.view).toBe("month");
    expect(loadCalendarPrototypeState(storage, "account-b", now)).toMatchObject({
      accountId: "account-b",
      manualEvents: [],
      suggestions: [],
      changeLog: [],
    });
  });

  it("drops a malformed account bucket without discarding a valid sibling", () => {
    const storage = memoryStorage();
    const valid = emptyCalendarPrototypeState("valid", new Date("2026-09-02T10:00:00.000Z"));
    storage.setItem(CALENDAR_PROTOTYPE_STORAGE_KEY, JSON.stringify({
      version: 1,
      accounts: {
        valid,
        forged: { accountId: "forged", plans: [{ private: "copied-authority" }] },
      },
    }));

    expect(loadCalendarPrototypeState(storage, "valid").accountId).toBe("valid");
    expect(loadCalendarPrototypeState(storage, "forged")).toMatchObject({
      accountId: "forged",
      manualEvents: [],
    });
  });

  it("refuses cross-account writes and clears only the requested account", () => {
    const storage = memoryStorage();
    const first = emptyCalendarPrototypeState("account-a");
    const second = emptyCalendarPrototypeState("account-b");
    expect(saveCalendarPrototypeState(storage, "account-a", first)).toBe(true);
    expect(saveCalendarPrototypeState(storage, "account-b", second)).toBe(true);
    expect(saveCalendarPrototypeState(storage, "account-a", second)).toBe(false);

    expect(clearCalendarPrototypeState(storage, "account-a")).toBe(true);
    expect(loadCalendarPrototypeState(storage, "account-b").accountId).toBe("account-b");
    expect(storage.values.has(CALENDAR_PROTOTYPE_STORAGE_KEY)).toBe(true);
    expect(clearCalendarPrototypeState(storage, "account-b")).toBe(true);
    expect(storage.values.has(CALENDAR_PROTOTYPE_STORAGE_KEY)).toBe(false);
  });

  it("removes only the local deadline upgraded by a committed plan", () => {
    const storage = memoryStorage();
    const now = new Date("2026-09-02T10:00:00.000Z");
    const manualEvent = {
      id: "stats-deadline",
      title: "Stats Pset",
      eventType: "deadline" as const,
      startsAt: "2026-09-02T19:00:00.000Z",
      endsAt: "2026-09-02T20:30:00.000Z",
      dueAt: "2026-09-04T23:59:59.999Z",
      fixed: false,
      done: false,
      courseId: null,
      courseLabel: "Stats",
      outcomeId: null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    const first = {
      ...emptyCalendarPrototypeState("account-a", now),
      manualEvents: [manualEvent],
      ui: {
        ...emptyCalendarPrototypeState("account-a", now).ui,
        selectedBlockId: "manual:stats-deadline",
      },
    };
    const second = {
      ...emptyCalendarPrototypeState("account-b", now),
      manualEvents: [{ ...manualEvent, id: "account-b-deadline" }],
    };
    expect(saveCalendarPrototypeState(storage, "account-a", first)).toBe(true);
    expect(saveCalendarPrototypeState(storage, "account-b", second)).toBe(true);

    expect(removeCalendarManualEventAfterPlanCommit(
      storage,
      "account-a",
      "stats-deadline",
      new Date("2026-09-02T10:05:00.000Z"),
    )).toBe(true);
    expect(loadCalendarPrototypeState(storage, "account-a")).toMatchObject({
      manualEvents: [],
      ui: { selectedBlockId: null },
      updatedAt: "2026-09-02T10:05:00.000Z",
    });
    expect(loadCalendarPrototypeState(storage, "account-b").manualEvents)
      .toHaveLength(1);
  });

  it("appends an automatic schedule receipt only to the active account bucket", () => {
    const storage = memoryStorage();
    const now = new Date("2026-09-02T10:00:00.000Z");
    expect(saveCalendarPrototypeState(storage, "account-a", emptyCalendarPrototypeState("account-a", now))).toBe(true);
    expect(saveCalendarPrototypeState(storage, "account-b", emptyCalendarPrototypeState("account-b", now))).toBe(true);

    expect(appendCalendarChangeLogEntry(storage, "account-a", {
      id: "advance-receipt",
      at: now.toISOString(),
      summary: "Pulled two sessions forward after an early start.",
      reason: "You approved Start and adjust calendar, so YOVA preserved the learning order while moving the remaining schedule.",
      origin: "automatic",
      undoable: false,
      undoneAt: null,
      undo: {
        kind: "session_schedule",
        planId: "plan-a",
        planSessionId: "session-a",
        from: "2026-09-03T17:00:00.000Z",
        to: "2026-09-02T17:00:00.000Z",
      },
    }, now)).toBe(true);

    expect(loadCalendarPrototypeState(storage, "account-a").changeLog)
      .toHaveLength(1);
    expect(loadCalendarPrototypeState(storage, "account-b").changeLog)
      .toEqual([]);
  });
});
