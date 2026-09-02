import { z } from "zod";
import { inferDeadlineDueAt } from "@/lib/intake/deadline";
import { ManualCalendarEventTypeSchema } from "@/lib/calendar/types";

export const CalendarQuickAddDraftSchema = z.object({
  raw: z.string().trim().min(1).max(500),
  title: z.string().trim().min(1).max(160),
  eventType: ManualCalendarEventTypeSchema,
  dueAt: z.string().datetime({ offset: true }).nullable(),
  durationMinutes: z.number().int().min(5).max(360).nullable(),
  startsAt: z.string().datetime({ offset: true }).nullable(),
  endsAt: z.string().datetime({ offset: true }).nullable(),
  fixed: z.boolean(),
  courseLabel: z.string().trim().min(1).max(120).nullable(),
  needsConfirmation: z.literal(true),
}).strict().superRefine((draft, context) => {
  if ((draft.startsAt === null) !== (draft.endsAt === null)) {
    context.addIssue({
      code: "custom",
      path: ["endsAt"],
      message: "A quick-add block needs both a start and end.",
    });
  }
  if (draft.startsAt && draft.endsAt && Date.parse(draft.endsAt) <= Date.parse(draft.startsAt)) {
    context.addIssue({
      code: "custom",
      path: ["endsAt"],
      message: "A quick-add block must end after it starts.",
    });
  }
});

export type CalendarQuickAddDraft = z.infer<typeof CalendarQuickAddDraftSchema>;

export function parseCalendarQuickAdd(
  input: string,
  options: { now?: Date; timeZone?: string } = {},
): CalendarQuickAddDraft | null {
  const raw = input.replace(/\s+/g, " ").trim();
  if (!raw) return null;
  const now = options.now ?? new Date();
  if (!Number.isFinite(now.getTime())) return null;
  const timeZone = validTimeZone(options.timeZone ?? resolvedTimeZone());
  const eventType = inferEventType(raw);
  const dueAt = hasDeadlineIntent(raw)
    ? inferDeadlineDueAt(raw, { now, timeZone })
    : null;
  const durationMinutes = inferDurationMinutes(raw);
  const start = inferBlockStart(raw, { now, timeZone, durationMinutes });
  const blockDuration = start ? durationMinutes ?? 30 : null;
  const endsAt = start && blockDuration
    ? new Date(start.getTime() + blockDuration * 60_000).toISOString()
    : null;

  return CalendarQuickAddDraftSchema.parse({
    raw,
    title: quickAddTitle(raw),
    eventType,
    dueAt,
    durationMinutes,
    startsAt: start?.toISOString() ?? null,
    endsAt,
    fixed: eventType === "class" || eventType === "exam",
    courseLabel: inferCourseLabel(raw),
    needsConfirmation: true,
  });
}

function hasDeadlineIntent(value: string) {
  return /\b(due|deadline|by|exam|test|quiz|midterm|final|assignment|homework|problem set|pset|paper|essay|project)\b/i.test(value);
}

function inferEventType(value: string): z.infer<typeof ManualCalendarEventTypeSchema> {
  if (/\b(class|lecture|seminar|lab|tutorial)\b/i.test(value)) return "class";
  if (/\b(exam|test|quiz|midterm|final)\b/i.test(value)) return "exam";
  if (/\b(free block|free time|available|availability|office hours)\b/i.test(value)) return "free_block";
  if (/\b(due|deadline|assignment|homework|problem set|pset|paper|essay|project)\b/i.test(value)) return "deadline";
  return "personal";
}

function inferDurationMinutes(value: string) {
  const minutes = value.match(/\b(\d{1,3})\s*(?:minutes?|mins?|min)\b/i);
  if (minutes) return boundedDuration(Number(minutes[1]));
  const hours = value.match(/\b(\d{1,2}(?:\.\d)?)\s*(?:hours?|hrs?|hr)\b/i);
  return hours ? boundedDuration(Math.round(Number(hours[1]) * 60)) : null;
}

function boundedDuration(value: number) {
  return Number.isFinite(value) && value >= 5 && value <= 360
    ? Math.round(value)
    : null;
}

function inferBlockStart(
  value: string,
  input: { now: Date; timeZone: string; durationMinutes: number | null },
) {
  const lower = value.toLocaleLowerCase();
  const tonight = /\btonight\b/.test(lower);
  const tomorrow = /\btomorrow\b/.test(lower);
  const dueTomorrow = /\b(?:due|deadline(?:\s+is)?|by)\s+tomorrow\b/.test(lower);
  const explicitClock = readClock(value);
  const tomorrowDescribesBlock = tomorrow && (
    !dueTomorrow
    || tonight
    || explicitClock !== null
    || /\b(?:study|work|block|class|meeting|practice|review)\b/i.test(value)
  );
  if (!tonight && !tomorrowDescribesBlock && !explicitClock) return null;

  const current = calendarParts(input.now, input.timeZone);
  const target = tomorrowDescribesBlock && !tonight
    ? addCalendarDays(current, 1)
    : current;
  const clock = explicitClock ?? (tonight ? { hour: 19, minute: 0 } : { hour: 17, minute: 0 });
  let candidate = localDateTimeToUtc(target, clock.hour, clock.minute, input.timeZone);

  if (tonight && candidate.getTime() <= input.now.getTime()) {
    const rounded = Math.ceil(input.now.getTime() / (30 * 60_000)) * 30 * 60_000;
    candidate = new Date(rounded);
  }
  return candidate;
}

function readClock(value: string) {
  const twelveHour = value.match(/\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b/i);
  if (twelveHour) {
    const rawHour = Number(twelveHour[1]);
    const minute = Number(twelveHour[2] ?? 0);
    if (rawHour < 1 || rawHour > 12 || minute > 59) return null;
    const afternoon = twelveHour[3]!.toLocaleLowerCase().startsWith("p");
    return { hour: rawHour % 12 + (afternoon ? 12 : 0), minute };
  }
  const twentyFourHour = value.match(/\bat\s+([01]?\d|2[0-3]):([0-5]\d)\b/i);
  return twentyFourHour
    ? { hour: Number(twentyFourHour[1]), minute: Number(twentyFourHour[2]) }
    : null;
}

function quickAddTitle(value: string) {
  const cleaned = value
    .replace(/\b(?:due|deadline(?:\s+is)?|by)\s+(?:today|tomorrow|(?:next\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|20\d{2}-\d{1,2}-\d{1,2}|\d{1,2}[/-]\d{1,2}(?:[/-]20\d{2})?)\b/gi, "")
    .replace(/\b\d{1,3}\s*(?:minutes?|mins?|min)\b/gi, "")
    .replace(/\b\d{1,2}(?:\.\d)?\s*(?:hours?|hrs?|hr)\b/gi, "")
    .replace(/\b(?:tonight|tomorrow)\b/gi, "")
    .replace(/\b(?:at\s+)?\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)\b/gi, "")
    .replace(/\bat\s+(?:[01]?\d|2[0-3]):[0-5]\d\b/gi, "")
    .replace(/\s*[,;]+\s*/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim()
    .replace(/\b(?:for|in|at)\s*$/i, "")
    .replace(/[-–—,:]+$/g, "")
    .trim();
  return titleCase(cleaned || "New calendar item").slice(0, 160);
}

function inferCourseLabel(value: string) {
  const match = value.match(/^([a-z][a-z0-9& .'-]{1,40}?)\s+(?:pset|problem set|homework|assignment|exam|test|quiz|class|lecture)\b/i);
  if (!match) return null;
  const label = titleCase(match[1]!.trim());
  return /^(my|the|a|an)$/i.test(label) ? null : label.slice(0, 120);
}

function titleCase(value: string) {
  return value.replace(/\b[a-z]/gi, (letter) => letter.toLocaleUpperCase());
}

type CalendarDate = { year: number; month: number; day: number };

function calendarParts(value: Date, timeZone: string): CalendarDate {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(value);
  const number = (type: "year" | "month" | "day") => Number(parts.find((part) => part.type === type)?.value);
  return { year: number("year"), month: number("month"), day: number("day") };
}

function addCalendarDays(value: CalendarDate, days: number): CalendarDate {
  const date = new Date(Date.UTC(value.year, value.month - 1, value.day + days, 12));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

function localDateTimeToUtc(
  date: CalendarDate,
  hour: number,
  minute: number,
  timeZone: string,
) {
  const guess = Date.UTC(date.year, date.month - 1, date.day, hour, minute);
  const observed = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(new Date(guess));
  const number = (type: "year" | "month" | "day" | "hour" | "minute" | "second") => (
    Number(observed.find((part) => part.type === type)?.value)
  );
  const observedAsUtc = Date.UTC(
    number("year"),
    number("month") - 1,
    number("day"),
    number("hour"),
    number("minute"),
    number("second"),
  );
  return new Date(guess - (observedAsUtc - guess));
}

function validTimeZone(value: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return value;
  } catch {
    return "UTC";
  }
}

function resolvedTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}
