import { calendarDateAtTime, deadlineDateInputFromIso } from "@/lib/intake/deadline";
import { WEEKDAYS, WEEKDAY_ORDER, type CalendarRecurrence } from "@/lib/calendar/recurrence-schema";
import type { ManualCalendarBlock, ManualCalendarEvent } from "@/lib/calendar/types";

const DAY = 86_400_000;
export function shiftCalendarDate(key: string, days: number) {
  return new Date(Date.parse(`${key}T12:00:00Z`) + days * DAY).toISOString().slice(0, 10);
}
const ordinal = (key: string) => Math.floor(Date.parse(`${key}T00:00:00Z`) / DAY);
export function wallClock(iso: string, zone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(iso));
  return { hour: Number(parts.find((p) => p.type === "hour")?.value), minute: Number(parts.find((p) => p.type === "minute")?.value) };
}

export function recurrenceDates(rule: CalendarRecurrence, anchor: string, from: string, to: string): string[] {
  if (!Number.isInteger(rule.interval) || rule.interval < 1 || rule.interval > 365 || ![anchor, from, to].every((key) => Number.isFinite(ordinal(key)))) return [];
  const last = rule.until && rule.until < to ? rule.until : to;
  if (last < anchor || last < from) return [];
  const dates: string[] = [];
  if (rule.frequency === "daily") {
    const first = Math.max(0, Math.ceil((ordinal(from) - ordinal(anchor)) / rule.interval));
    for (let index = first; ; index++) {
      const key = shiftCalendarDate(anchor, index * rule.interval);
      if (key > last || (rule.count !== null && index >= rule.count)) break;
      dates.push(key);
    }
  } else {
    const weekday = new Date(`${anchor}T12:00:00Z`).getUTCDay();
    const monday = shiftCalendarDate(anchor, -((weekday + 6) % 7));
    const offsets = WEEKDAY_ORDER.filter((day) => rule.weekdays.includes(day)).map((day) => (day + 6) % 7);
    let index = 0;
    for (let week = 0; ; week += rule.interval) {
      const base = shiftCalendarDate(monday, week * 7);
      if (base > last) break;
      for (const offset of offsets) {
        const key = shiftCalendarDate(base, offset);
        if (key < anchor) continue;
        if (key > last || (rule.count !== null && index >= rule.count)) return dates;
        index++;
        if (key >= from) dates.push(key);
      }
    }
  }
  return dates;
}

export function expandRecurringEvent(master: ManualCalendarEvent, from: Date, to: Date): ManualCalendarBlock[] {
  const rule = master.recurrence;
  if (!rule) return [manualBlock(master)];
  const anchor = deadlineDateInputFromIso(master.startsAt, rule.timeZone);
  // Include a prior-day start that continues into this range.
  const fromKey = shiftCalendarDate(deadlineDateInputFromIso(from.toISOString(), rule.timeZone), -1);
  const toKey = deadlineDateInputFromIso(to.toISOString(), rule.timeZone);
  const template = { ...master };
  delete template.recurrence;
  delete template.recurrenceExceptions;
  const clock = wallClock(master.startsAt, rule.timeZone);
  const duration = Date.parse(master.endsAt) - Date.parse(master.startsAt);
  const exceptions = new Map(master.recurrenceExceptions?.map((item) => [item.dateKey, item.event]) ?? []);
  const blocks: ManualCalendarBlock[] = [];
  const included = new Set<string>();
  for (const key of recurrenceDates(rule, anchor, fromKey, toKey)) {
    const startsAt = calendarDateAtTime(key, clock.hour, clock.minute, rule.timeZone);
    if (!startsAt) continue; // A clock skipped by daylight saving has no valid occurrence.
    const id = `${master.id}@${key}`;
    const event = exceptions.has(key) ? exceptions.get(key) : {
      ...template, id, startsAt, endsAt: new Date(Date.parse(startsAt) + duration).toISOString(),
    };
    included.add(key);
    if (event && Date.parse(event.endsAt) > from.getTime() && Date.parse(event.startsAt) < to.getTime()) {
      blocks.push({ ...manualBlock(event), series: { master, dateKey: key } });
    }
  }
  // A moved occurrence can enter this range from a different week.
  for (const [key, event] of exceptions) {
    if (included.has(key) || !event || Date.parse(event.startsAt) >= to.getTime() || Date.parse(event.endsAt) <= from.getTime()) continue;
    if (!recurrenceDates(rule, anchor, key, key).includes(key)) continue;
    blocks.push({ ...manualBlock(event), series: { master, dateKey: key } });
  }
  return blocks;
}

function manualBlock(event: ManualCalendarEvent): ManualCalendarBlock {
  return {
    id: `manual:${event.id}`, source: "manual", blockType: event.eventType, title: event.title,
    startsAt: event.startsAt, endsAt: event.endsAt, done: event.done, fixed: event.fixed,
    courseId: event.courseId, courseLabel: event.courseLabel,
    outcomeId: event.outcomeId ?? (event.dueAt ? `outcome:manual:${event.id}` : null), event,
  };
}

export function changeRecurringOccurrence(block: ManualCalendarBlock, after: ManualCalendarEvent | null): ManualCalendarEvent {
  if (!block.series) throw new Error("This item is not part of a repeating series.");
  const { master, dateKey } = block.series;
  const event = after ? { ...after } : null;
  if (event) { delete event.recurrence; delete event.recurrenceExceptions; }
  return { ...master, recurrenceExceptions: [...(master.recurrenceExceptions ?? []).filter((item) => item.dateKey !== dateKey), { dateKey, event }], updatedAt: new Date().toISOString() };
}

export function firstCalendarBlockId(event: ManualCalendarEvent) {
  if (!event.recurrence) return `manual:${event.id}`;
  const anchor = deadlineDateInputFromIso(event.startsAt, event.recurrence.timeZone);
  const first = recurrenceDates(event.recurrence, anchor, anchor, shiftCalendarDate(anchor, event.recurrence.interval * 7 + 7))[0];
  return first ? `manual:${event.id}@${first}` : null;
}

export function recurrenceSummary(rule: CalendarRecurrence) {
  const cadence = rule.frequency === "daily"
    ? rule.interval === 1 ? "Every day" : `Every ${rule.interval} days`
    : `${rule.interval === 1 ? "Every week" : `Every ${rule.interval} weeks`} on ${WEEKDAY_ORDER.filter((day) => rule.weekdays.includes(day)).map((day) => WEEKDAYS[day]).join(" and ")}`;
  const end = rule.until ? ` through ${rule.until}` : rule.count ? ` · ${rule.count} occurrences` : " · no end date";
  return `${cadence}${end}`;
}
