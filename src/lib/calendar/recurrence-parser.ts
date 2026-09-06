import { calendarDateAtTime, deadlineDateInputFromIso, findCalendarDateMention, readCalendarClock } from "@/lib/intake/deadline";
import { CalendarRecurrenceSchema, WEEKDAYS, type CalendarRecurrence } from "@/lib/calendar/recurrence-schema";
import { recurrenceDates, shiftCalendarDate } from "@/lib/calendar/recurrence";

const DAY_NAMES = "sun(?:day)?s?|mon(?:day)?s?|tue(?:sday)?s?|wed(?:nesday)?s?|thu(?:rsday)?s?|fri(?:day)?s?|sat(?:urday)?s?";
const NUMBERS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, other: 2 };
const amount = (value: string) => NUMBERS[value.toLowerCase()] ?? Number(value);
export function hasRecurrenceIntent(text: string) {
  return /\b(?:every|each|daily|weekly|fortnightly|biweekly|monthly|yearly|annually|quarterly|weekdays|weekends|repeats?|recurring)\b/i.test(text)
    || new RegExp(`\\b(?:mondays|tuesdays|wednesdays|thursdays|fridays|saturdays|sundays)\\b`, "i").test(text);
}
export function isCalendarDescription(text: string) {
  return hasRecurrenceIntent(text) || (/\b(?:class|lecture|seminar|lab|appointment|meeting)\b/i.test(text) && Boolean(readCalendarClock(text) || readCalendarTimeRange(text)));
}

type ClockToken = { hour: number; minute: number; meridiem: "am" | "pm" | null };
function clockToken(value: string): ClockToken | null {
  const match = value.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?$/i);
  if (!match) return null;
  const hour = Number(match[1]), minute = Number(match[2] ?? 0);
  const meridiem = match[3] ? match[3].toLowerCase().startsWith("p") ? "pm" : "am" : null;
  if (minute > 59 || hour > 23 || (meridiem && (hour < 1 || hour > 12))) return null;
  return {hour, minute, meridiem};
}
function clockCandidates(token: ClockToken) {
  if (token.meridiem) return [token.hour % 12 * 60 + token.minute + (token.meridiem === "pm" ? 720 : 0)];
  return token.hour > 12 || token.hour === 0 ? [token.hour * 60 + token.minute] : [token.hour % 12 * 60 + token.minute, token.hour % 12 * 60 + token.minute + 720];
}
export function readCalendarTimeRange(text: string) {
  const token = "\\d{1,2}(?::\\d{2})?\\s*(?:a\\.?m\\.?|p\\.?m\\.?)?";
  for (const match of text.matchAll(new RegExp(`\\b(?:from\\s+|at\\s+)?(${token})\\s*(?:to|until|–|-)\\s*(${token})(?![\\d:])`, "gi"))) {
    if (/[\d/-]/.test(text[(match.index ?? 0) - 1] ?? "") || /^[-/\d]/.test(text.slice((match.index ?? 0) + match[0].length)) || /^\s*(?:days?|weeks?|months?|years?)\b/i.test(text.slice((match.index ?? 0) + match[0].length))) continue;
    const a = clockToken(match[1]), b = clockToken(match[2]);
    if (!a || !b) continue;
    // Unqualified numbers use a 24-hour clock; a supplied am/pm disambiguates the other end.
    const starts = !a.meridiem && !b.meridiem ? [a.hour * 60 + a.minute] : clockCandidates(a);
    const ends = !a.meridiem && !b.meridiem ? [b.hour * 60 + b.minute] : clockCandidates(b);
    const choices = starts.flatMap((start) => ends.map((end) => ({ start, duration: (end - start + 1440) % 1440 })))
      .filter((choice) => choice.duration >= 5 && choice.duration <= 360).sort((a, b) => a.duration - b.duration);
    const choice = choices[0];
    if (!choice) continue;
    return { text: match[0], index: match.index ?? 0, hour: Math.floor(choice.start / 60), minute: choice.start % 60, durationMinutes: choice.duration };
  }
  return null;
}

export function parseRecurrence(text: string, now: Date, timeZone: string) {
  if (!hasRecurrenceIntent(text)) return null;
  const options = { now, timeZone };
  const range = readCalendarTimeRange(text);
  const clock = range ?? readCalendarClock(text);
  let cleaned = range ? text.replace(range.text, " ") : text;
  const rule: CalendarRecurrence = { frequency: "weekly", interval: 1, weekdays: [], timeZone, until: null, count: null };
  const interval = text.match(/\b(?:every|each)\s+(other|one|two|three|four|five|six|seven|eight|nine|ten|twelve|\d+)\s+(days?|weeks?)\b/i);
  if (interval) { rule.frequency = interval[2].toLowerCase().startsWith("day") ? "daily" : "weekly"; rule.interval = amount(interval[1]); cleaned = cleaned.replace(interval[0], " "); }
  else if (/\b(?:daily|every day|each day)\b/i.test(text)) rule.frequency = "daily";
  if (/\b(?:fortnightly|biweekly|every other week)\b/i.test(text)) rule.interval = 2;

  let anchor = deadlineDateInputFromIso(now.toISOString(), timeZone);
  let dateNeedsReview = false;
  let explicitStart = false;
  const start = cleaned.match(/\b(?:starting(?:\s+on)?|starts?(?:\s+on)?|beginning|from)\s+(.+)/i);
  if (start) {
    const mention = findCalendarDateMention(start[1], options);
    if (mention && mention.index === 0 && mention.date) {
      anchor = mention.date;
      explicitStart = true;
      cleaned = cleaned.replace(start[0].slice(0, start[0].length - start[1].length) + mention.text, " ");
    } else dateNeedsReview = true;
  } else {
    const relative = cleaned.match(/\b(?:today|tomorrow)\b/i);
    if (relative) { anchor = findCalendarDateMention(relative[0], options)?.date ?? anchor; cleaned = cleaned.replace(relative[0], " "); }
  }
  const until = cleaned.match(/\b(?:until|through|ending(?:\s+on)?|ends(?:\s+on)?)\s+(.+)/i);
  if (until && !(until[0].toLowerCase().startsWith("through") && new RegExp(`(?:${DAY_NAMES})\\s*$`, "i").test(cleaned.slice(0, until.index)))) {
    const mention = findCalendarDateMention(until[1], options);
    if (mention && mention.index === 0) {
      rule.until = mention.date;
      dateNeedsReview = dateNeedsReview || !mention.date;
      cleaned = cleaned.replace(until[0].slice(0, until[0].length - until[1].length) + mention.text, " ");
    } else dateNeedsReview = true;
  }
  const length = cleaned.match(/\bfor\s+(one|two|three|four|five|six|seven|eight|nine|ten|twelve|\d+)\s+(weeks?|occurrences?|times?)\b/i);
  if (length) {
    const total = amount(length[1]);
    if (!Number.isInteger(total) || total < 1 || total > 1000) dateNeedsReview = true;
    else if (length[2].toLowerCase().startsWith("week")) rule.until = shiftCalendarDate(anchor, total * 7 - 1);
    else rule.count = total;
    cleaned = cleaned.replace(length[0], " ");
  }
  if (/\bweekdays\b/i.test(cleaned)) rule.weekdays = [1, 2, 3, 4, 5];
  else if (/\bweekends\b/i.test(cleaned)) rule.weekdays = [0, 6];
  else {
    const dayRange = cleaned.match(new RegExp(`\\b(${DAY_NAMES})\\s*(?:through|to|–|-)\\s*(${DAY_NAMES})\\b`, "i"));
    const index = (word: string) => WEEKDAYS.findIndex((day) => day.toLowerCase().startsWith(word.slice(0, 3).toLowerCase()));
    if (dayRange) {
      let day = index(dayRange[1]);
      for (let i = 0; i < 7; i++, day = (day + 1) % 7) { rule.weekdays.push(day); if (day === index(dayRange[2])) break; }
    } else rule.weekdays = [...new Set(Array.from(cleaned.matchAll(new RegExp(`\\b(${DAY_NAMES})\\b`, "gi")), (match) => index(match[1])))];
  }
  if (rule.frequency === "weekly" && rule.weekdays.length === 0) rule.weekdays = [new Date(`${anchor}T12:00:00Z`).getUTCDay()];
  if (rule.weekdays.length && !/\b(?:daily|every day|each day)\b/i.test(text) && !interval?.[2].toLowerCase().startsWith("day")) rule.frequency = "weekly";
  const recognizedCadence = Boolean(interval) || new RegExp(`\\b(?:daily|weekly|fortnightly|biweekly|weekdays|weekends|${DAY_NAMES})\\b|\\b(?:every|each)\\s+(?:day|week)\\b`, "i").test(cleaned);
  const unsupported = dateNeedsReview || !recognizedCadence || !CalendarRecurrenceSchema.safeParse(rule).success || /\b(?:monthly|yearly|annually|quarterly|months?|years?|except|excluding|holidays)\b/i.test(cleaned) || (rule.until !== null && rule.until < anchor);
  cleaned = cleaned.replace(new RegExp(`\\b(?:every|each|on)?\\s*(?:${DAY_NAMES})(?:\\s*(?:,|and|&|through|to|–|-)\\s*(?:${DAY_NAMES}))*\\b`, "gi"), " ")
    .replace(/\b(?:every|each)\s+(?:other\s+)?(?:day|week)\b|\b(?:daily|weekly|biweekly|fortnightly|weekdays|weekends|recurring)\b/gi, " ")
    .replace(/\b(?:every|each|on|and)\s*$/i, "").trim();
  let startsAt: string | null = null;
  if (!unsupported && clock) {
    const candidates = recurrenceDates(rule, anchor, anchor, shiftCalendarDate(anchor, Math.max(14, rule.interval * 7 + 7)));
    for (const date of candidates) {
      const candidate = calendarDateAtTime(date, clock.hour, clock.minute, timeZone);
      if (candidate && (explicitStart || Date.parse(candidate) > now.getTime())) { startsAt = candidate; break; }
    }
  }
  return { recurrence: unsupported ? null : rule, startsAt, durationMinutes: range?.durationMinutes ?? null, titleText: cleaned, needsReview: unsupported };
}
