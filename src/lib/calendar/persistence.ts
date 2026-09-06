import { z } from "zod";
import {
  CALENDAR_STORAGE_VERSION,
  CalendarPrototypeStateSchema,
  type CalendarChangeLogEntry,
  type CalendarPrototypeState,
} from "@/lib/calendar/types";

export const CALENDAR_PROTOTYPE_STORAGE_KEY = "yova.calendar.prototype.v1" as const;

type ReadableStorage = Pick<Storage, "getItem">;
type WritableStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** All browser writers share this lock, including writers for other accounts. */
export async function withCalendarStorageLock<T>(work: () => T | Promise<T>): Promise<T> {
  if (typeof window === "undefined") return work();
  if (!navigator.locks) {
    throw new Error("This browser cannot safely save calendar changes. Open YOVA in an up-to-date browser using HTTPS.");
  }
  return navigator.locks.request(CALENDAR_PROTOTYPE_STORAGE_KEY, work);
}

/** Apply only the user's edits; never replace unrelated changes from another tab. */
export function mergeCalendarChanges(
  before: CalendarPrototypeState,
  edited: CalendarPrototypeState,
  current: CalendarPrototypeState,
): CalendarPrototypeState {
  if (before.accountId !== current.accountId || edited.accountId !== current.accountId) {
    throw new Error("The calendar account changed. Reopen Calendar before saving.");
  }
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const merge = <T,>(oldItems: T[], nextItems: T[], currentItems: T[], key: (item: T) => string): T[] => {
    const old = new Map(oldItems.map((item) => [key(item), item]));
    const next = new Map(nextItems.map((item) => [key(item), item]));
    const result = new Map(currentItems.map((item) => [key(item), item]));
    for (const id of new Set([...old.keys(), ...next.keys()])) {
      if (same(old.get(id), next.get(id))) continue;
      if (!same(old.get(id), result.get(id)) && !same(next.get(id), result.get(id))) {
        throw new Error("This item changed in another tab. Your edit was not saved. Review the latest details and try again.");
      }
      if (next.has(id)) result.set(id, next.get(id)!);
      else result.delete(id);
    }
    return [...result.values()];
  };
  const ui = { ...current.ui };
  for (const key of Object.keys(edited.ui) as Array<keyof typeof ui>) {
    if (!same(before.ui[key], edited.ui[key])) Object.assign(ui, { [key]: edited.ui[key] });
  }
  return CalendarPrototypeStateSchema.parse({
    ...current,
    manualEvents: merge(before.manualEvents, edited.manualEvents, current.manualEvents, (item) => item.id),
    suggestions: merge(before.suggestions, edited.suggestions, current.suggestions, (item) => item.id),
    availabilityOverrides: merge(before.availabilityOverrides, edited.availabilityOverrides, current.availabilityOverrides, (item) => item.dateKey),
    changeLog: merge(before.changeLog, edited.changeLog, current.changeLog, (item) => item.id).slice(-200),
    ui,
    updatedAt: new Date().toISOString(),
  });
}

export async function commitCalendarPrototypeState(
  storage: WritableStorage,
  before: CalendarPrototypeState,
  edited: CalendarPrototypeState,
) {
  return withCalendarStorageLock(() => {
    const current = loadCalendarPrototypeState(storage, before.accountId);
    const merged = mergeCalendarChanges(before, edited, current);
    if (!saveCalendarPrototypeState(storage, before.accountId, merged)) {
      throw new Error("This calendar change could not be saved on this device. Your edit is still open; free some browser storage and try again.");
    }
    return merged;
  });
}

const CalendarStorageEnvelopeSchema = z.object({
  version: z.literal(CALENDAR_STORAGE_VERSION),
  accounts: z.record(z.string(), CalendarPrototypeStateSchema),
}).strict();

export function emptyCalendarPrototypeState(
  accountId: string,
  now = new Date(),
): CalendarPrototypeState {
  return CalendarPrototypeStateSchema.parse({
    version: CALENDAR_STORAGE_VERSION,
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
    updatedAt: now.toISOString(),
  });
}

/**
 * Calendar prototype data is intentionally device-local and account-scoped.
 * Plans, sessions, deadlines, completions and learner-profile evidence are not
 * copied into this store; those continue to come from their authoritative
 * repositories.
 */
export function hasSavedCalendarPrototypeState(storage: ReadableStorage, accountId: string) {
  return Boolean(readEnvelope(storage).accounts[accountId]);
}

export function loadCalendarPrototypeState(
  storage: ReadableStorage,
  accountId: string,
  now = new Date(),
): CalendarPrototypeState {
  const envelope = readEnvelope(storage);
  const candidate = envelope.accounts[accountId];
  return candidate?.accountId === accountId
    ? candidate
    : emptyCalendarPrototypeState(accountId, now);
}

export function saveCalendarPrototypeState(
  storage: WritableStorage,
  accountId: string,
  state: CalendarPrototypeState,
) {
  const parsed = CalendarPrototypeStateSchema.safeParse(state);
  if (!parsed.success || parsed.data.accountId !== accountId) return false;

  try {
    const envelope = readEnvelope(storage);
    storage.setItem(CALENDAR_PROTOTYPE_STORAGE_KEY, JSON.stringify({
      version: CALENDAR_STORAGE_VERSION,
      accounts: {
        ...envelope.accounts,
        [accountId]: parsed.data,
      },
    }));
    return true;
  } catch {
    return false;
  }
}

export function clearCalendarPrototypeState(
  storage: WritableStorage,
  accountId: string,
) {
  try {
    const envelope = readEnvelope(storage);
    if (!(accountId in envelope.accounts)) return true;
    const accounts = { ...envelope.accounts };
    delete accounts[accountId];
    if (Object.keys(accounts).length === 0) {
      storage.removeItem(CALENDAR_PROTOTYPE_STORAGE_KEY);
    } else {
      storage.setItem(CALENDAR_PROTOTYPE_STORAGE_KEY, JSON.stringify({
        version: CALENDAR_STORAGE_VERSION,
        accounts,
      }));
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Removes the device-local deadline that was used to start a plan only after
 * the plan and its authoritative milestone have both been saved. The helper
 * is account-scoped so finishing one account's plan can never alter another
 * signed-in account's calendar bucket.
 */
export async function removeCalendarManualEventAfterPlanCommit(
  storage: WritableStorage,
  accountId: string,
  eventId: string,
  now = new Date(),
) {
  return withCalendarStorageLock(() => {
    const state = loadCalendarPrototypeState(storage, accountId, now);
    if (!state.manualEvents.some((event) => event.id === eventId)) return true;

    return saveCalendarPrototypeState(storage, accountId, {
      ...state,
      manualEvents: state.manualEvents.filter((event) => event.id !== eventId),
      ui: {
        ...state.ui,
        selectedBlockId: state.ui.selectedBlockId === `manual:${eventId}`
          ? null
          : state.ui.selectedBlockId,
      },
      updatedAt: now.toISOString(),
    });
  });
}

/** Appends one bounded, account-scoped Calendar history record. */
export async function appendCalendarChangeLogEntry(
  storage: WritableStorage,
  accountId: string,
  entry: CalendarChangeLogEntry,
  now = new Date(),
) {
  return withCalendarStorageLock(() => {
    const state = loadCalendarPrototypeState(storage, accountId, now);
    return saveCalendarPrototypeState(storage, accountId, {
      ...state,
      changeLog: [
        ...state.changeLog.filter((candidate) => candidate.id !== entry.id),
        entry,
      ].slice(-200),
      updatedAt: now.toISOString(),
    });
  });
}

function readEnvelope(storage: ReadableStorage): z.infer<typeof CalendarStorageEnvelopeSchema> {
  try {
    const raw = storage.getItem(CALENDAR_PROTOTYPE_STORAGE_KEY);
    if (!raw) return emptyEnvelope();
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return emptyEnvelope();
    const candidate = parsed as Record<string, unknown>;
    if (candidate.version !== CALENDAR_STORAGE_VERSION) return emptyEnvelope();
    const rawAccounts = candidate.accounts;
    if (!rawAccounts || typeof rawAccounts !== "object" || Array.isArray(rawAccounts)) {
      return emptyEnvelope();
    }

    // A malformed bucket must not make another signed-in account inherit or
    // lose unrelated calendar data. Retain only independently valid buckets.
    const accounts = Object.fromEntries(Object.entries(rawAccounts).flatMap(([key, value]) => {
      const account = CalendarPrototypeStateSchema.safeParse(value);
      return account.success && account.data.accountId === key
        ? [[key, account.data] as const]
        : [];
    }));
    return CalendarStorageEnvelopeSchema.parse({
      version: CALENDAR_STORAGE_VERSION,
      accounts,
    });
  } catch {
    return emptyEnvelope();
  }
}

function emptyEnvelope(): z.infer<typeof CalendarStorageEnvelopeSchema> {
  return { version: CALENDAR_STORAGE_VERSION, accounts: {} };
}
