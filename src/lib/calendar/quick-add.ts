import { z } from "zod";
import { CalendarRecurrenceSchema } from "@/lib/calendar/recurrence-schema";
import { parseRecurrence, readCalendarTimeRange } from "@/lib/calendar/recurrence-parser";
import { calendarDateAtTime, deadlineDateInputFromIso, findCalendarDateMention, inferDeadlineDueAt, readCalendarClock } from "@/lib/intake/deadline";
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
  recurrence: CalendarRecurrenceSchema.nullable().optional(),
  recurrenceNeedsReview: z.boolean().optional(),
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
  const repeating = parseRecurrence(raw, now, timeZone);
  const range = readCalendarTimeRange(raw);
  const durationMinutes = inferDurationMinutes(raw) ?? range?.durationMinutes ?? null;
  const start = repeating ? repeating.startsAt ? new Date(repeating.startsAt) : null : inferBlockStart(raw, { now, timeZone, eventType, dueAt });
  const blockDuration = start ? durationMinutes ?? 30 : null;
  const endsAt = start && blockDuration
    ? new Date(start.getTime() + blockDuration * 60_000).toISOString()
    : null;

  return CalendarQuickAddDraftSchema.parse({
    raw,
    title: quickAddTitle(repeating?.titleText ?? raw),
    eventType,
    dueAt,
    durationMinutes,
    startsAt: start?.toISOString() ?? null,
    endsAt,
    fixed: eventType === "class" || eventType === "exam",
    courseLabel: inferCourseLabel(raw),
    needsConfirmation: true,
    recurrence: repeating?.recurrence ?? null,
    recurrenceNeedsReview: repeating?.needsReview ?? false,
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
  input: { now: Date; timeZone: string; eventType: string; dueAt: string | null },
) {
  // Remove the deadline clause before looking for a preparation time.
  const cue = value.match(/\b(?:due(?:\s+(?:on|by))?|deadline(?:\s+(?:is|on))?|by|before)\s+/i);
  let work = value;
  if (cue) {
    const prefix = value.slice(0, cue.index);
    const suffix = value.slice((cue.index ?? 0) + cue[0].length);
    const mention = findCalendarDateMention(suffix, input);
    if (mention) {
      let remaining = suffix.slice(mention.index + mention.text.length);
      remaining = remaining.replace(/^\s*(?:at\s+)?\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)\b/i, "")
        .replace(/^\s*at\s+\d{1,2}:\d{2}\b/i, "");
      work = `${prefix} ${remaining}`;
    } else return null;
  }
  const mention = findCalendarDateMention(work, input);
  const clock = readCalendarTimeRange(work) ?? readCalendarClock(work);
  // A timed exam is an event as well as an outcome. A deadline alone is not work.
  if (!mention && !clock) {
    if (input.eventType === "exam" && input.dueAt && readCalendarClock(value)) return new Date(input.dueAt);
    return null;
  }
  if (mention && !mention.date) return null;
  // Unsupported date language must not silently become today.
  if (!mention && /\b(next|on|this|in|week|month|year)\b/i.test(work)) return null;
  const date = mention?.date ?? deadlineDateInputFromIso(input.now.toISOString(), input.timeZone);
  const tonight = /\btonight\b/i.test(work);
  const time = clock ?? { hour: tonight ? 19 : 17, minute: 0 };
  const iso = calendarDateAtTime(date, time.hour, time.minute, input.timeZone);
  if (!iso) return null;
  let candidate = new Date(iso);
  if (tonight && !clock && candidate <= input.now) {
    candidate = new Date(Math.ceil((input.now.getTime() + 1) / (30 * 60_000)) * 30 * 60_000);
  }
  return candidate > input.now ? candidate : null;
}

function quickAddTitle(value: string) {
  const range = readCalendarTimeRange(value);
  let withoutDates = (range ? value.replace(range.text, " ") : value)
    .replace(/^(?:oh[, ]+)?(?:i\s+(?:have|have got|attend|go to)|i[’']ve got|add|schedule)\s+(?:a\s+|an\s+)?/i, "");
  for (let index = 0; index < 4; index += 1) {
    const mention = findCalendarDateMention(withoutDates);
    if (!mention) break;
    withoutDates = withoutDates.slice(0, mention.index) + withoutDates.slice(mention.index + mention.text.length);
  }
  const cleaned = withoutDates
    .replace(/\b(?:due|deadline(?:\s+is)?|by|before|on|next)\s*(?=,|$)/gi, "")
    .replace(/\b(?:due|deadline(?:\s+is)?|by)\s+(?:today|tomorrow|(?:next\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|20\d{2}-\d{1,2}-\d{1,2}|\d{1,2}[/-]\d{1,2}(?:[/-]20\d{2})?)\b/gi, "")
    .replace(/\b\d{1,3}\s*(?:minutes?|mins?|min)\b/gi, "")
    .replace(/\b\d{1,2}(?:\.\d)?\s*(?:hours?|hrs?|hr)\b/gi, "")
    .replace(/\b(?:tonight|tomorrow)\b/gi, "")
    .replace(/\b(?:at\s+)?\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)\b/gi, "")
    .replace(/\bat\s+(?:[01]?\d|2[0-3]):[0-5]\d\b/gi, "")
    .replace(/\s*[,;]+\s*/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim()
    .replace(/\b(?:for|in|at|due|by|before|on)\s*$/i, "")
    .replace(/[-–—,:]+$/g, "")
    .trim();
  const namedClass = cleaned.replace(/^(class|lecture|seminar|lab)\s+(?:on|in|for)\s+(.+)$/i, "$2 $1");
  return titleCase(namedClass || "New calendar item").slice(0, 160);
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
