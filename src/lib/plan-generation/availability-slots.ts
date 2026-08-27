import type { PlanGenerationRequest } from "@/lib/plan-generation/schema";

const WINDOW_HOUR: Readonly<Record<string, number>> = Object.freeze({
  morning: 9,
  afternoon: 14,
  evening: 19,
  anytime: 17,
  now: 12,
});

export type PlanAvailabilityInput = Pick<
  PlanGenerationRequest,
  "availability" | "deadline" | "timeZone"
>;

/**
 * One concrete occurrence of a repeating availability window.
 *
 * `dayIndex` is the zero-based local-calendar offset from `now` and
 * `windowIndex` points back to the original flat availability input. Keeping
 * both makes later allocation decisions explainable without letting callers
 * depend on the order produced by chronological sorting.
 */
export type PlanAvailabilitySlot = Readonly<{
  startsAt: string;
  /** Exact exclusive boundary before minute flooring is applied. */
  endsAt: string;
  minutes: number;
  dayIndex: number;
  windowIndex: number;
}>;

/**
 * Materialize repeating learner availability as concrete chronological slots.
 * Calendar arithmetic is performed in the learner's time zone so recurring
 * local windows keep their wall-clock hour across daylight-saving changes.
 */
export function enumeratePlanAvailabilitySlots(
  input: PlanAvailabilityInput,
  now: Date,
  searchDays: number,
): readonly PlanAvailabilitySlot[] {
  const localToday = localCalendarDate(now, input.timeZone);
  const deadline = input.deadline ? new Date(input.deadline).getTime() : null;
  const results: PlanAvailabilitySlot[] = [];

  for (let dayIndex = 0; dayIndex < searchDays; dayIndex += 1) {
    const calendarDate = addCalendarDays(localToday, dayIndex);
    const weekday = weekdayForCalendarDate(calendarDate);

    for (const [windowIndex, window] of input.availability.entries()) {
      const normalizedDay = window.day.toLocaleLowerCase();
      if (
        normalizedDay !== weekday.toLocaleLowerCase()
        && normalizedDay !== "every day"
      ) {
        continue;
      }

      const hour = WINDOW_HOUR[window.window.toLocaleLowerCase()] ?? 17;
      const date = localDateTimeToUtc(calendarDate, hour, input.timeZone);
      if (date.getTime() < now.getTime() - 60_000) continue;
      if (deadline !== null && date.getTime() > deadline) continue;
      const windowEnd = date.getTime() + window.minutes * 60_000;
      const exactEnd = deadline === null ? windowEnd : Math.min(windowEnd, deadline);
      const minutes = Math.floor((exactEnd - date.getTime()) / 60_000);
      if (minutes < 1) continue;

      results.push({
        startsAt: date.toISOString(),
        endsAt: new Date(exactEnd).toISOString(),
        minutes,
        dayIndex,
        windowIndex,
      });
    }
  }

  results.sort((left, right) => (
    Date.parse(left.startsAt) - Date.parse(right.startsAt)
    || left.windowIndex - right.windowIndex
  ));

  return Object.freeze(results.map((slot) => Object.freeze(slot)));
}

/**
 * Turn overlapping availability declarations into one elapsed-time union.
 *
 * The earliest declaration owns shared time; a later declaration contributes
 * only a non-overlapping tail. Keeping this separate from enumeration lets
 * callers inspect the learner's raw declarations while every allocator shares
 * the same no-double-counting capacity rule.
 */
export function canonicalizePlanAvailabilitySlots(
  slots: readonly PlanAvailabilitySlot[],
  now: Date,
): readonly PlanAvailabilitySlot[] {
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) {
    throw new Error("Availability canonicalization requires a valid current time.");
  }
  const ordered = [...slots].sort((left, right) => (
    Date.parse(left.startsAt) - Date.parse(right.startsAt)
    || left.windowIndex - right.windowIndex
    || Date.parse(left.endsAt) - Date.parse(right.endsAt)
  ));
  const merged: Array<{
    startsAtMs: number;
    endsAtMs: number;
    dayIndex: number;
    windowIndex: number;
  }> = [];
  for (const slot of ordered) {
    const originalStart = Date.parse(slot.startsAt);
    const originalEnd = Date.parse(slot.endsAt);
    if (
      !Number.isFinite(originalStart)
      || !Number.isFinite(originalEnd)
      || originalEnd <= originalStart
    ) {
      throw new Error("Availability canonicalization requires valid increasing slot boundaries.");
    }
    const startsAtMs = Math.max(originalStart, nowMs);
    if (originalEnd <= startsAtMs) continue;
    const current = merged[merged.length - 1];
    if (current && startsAtMs <= current.endsAtMs) {
      current.endsAtMs = Math.max(current.endsAtMs, originalEnd);
      continue;
    }
    merged.push({
      startsAtMs,
      endsAtMs: originalEnd,
      dayIndex: slot.dayIndex,
      windowIndex: slot.windowIndex,
    });
  }
  return Object.freeze(merged.flatMap((slot) => {
    const minutes = Math.floor((slot.endsAtMs - slot.startsAtMs) / 60_000);
    return minutes < 1 ? [] : [Object.freeze({
      startsAt: new Date(slot.startsAtMs).toISOString(),
      endsAt: new Date(slot.endsAtMs).toISOString(),
      minutes,
      dayIndex: slot.dayIndex,
      windowIndex: slot.windowIndex,
    })];
  }));
}

type CalendarDate = { year: number; month: number; day: number };

function localCalendarDate(date: Date, timeZone: string): CalendarDate {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(date);
  const value = (type: "year" | "month" | "day") => Number(parts.find((part) => part.type === type)?.value);
  return { year: value("year"), month: value("month"), day: value("day") };
}

function addCalendarDays(date: CalendarDate, days: number): CalendarDate {
  const next = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return {
    year: next.getUTCFullYear(),
    month: next.getUTCMonth() + 1,
    day: next.getUTCDate(),
  };
}

function weekdayForCalendarDate(date: CalendarDate) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(date.year, date.month - 1, date.day, 12)));
}

function localDateTimeToUtc(date: CalendarDate, hour: number, timeZone: string) {
  const initialGuess = Date.UTC(date.year, date.month - 1, date.day, hour);
  const observed = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(new Date(initialGuess));
  const numberPart = (type: "year" | "month" | "day" | "hour" | "minute" | "second") => (
    Number(observed.find((part) => part.type === type)?.value)
  );
  const observedAsUtc = Date.UTC(
    numberPart("year"),
    numberPart("month") - 1,
    numberPart("day"),
    numberPart("hour"),
    numberPart("minute"),
    numberPart("second"),
  );
  return new Date(initialGuess - (observedAsUtc - initialGuess));
}
