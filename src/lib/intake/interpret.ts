import type { IntakeInterpretation, IntakeItemType } from "@/lib/intake/schema";
import { LEARNING_TITLE_CHARACTER_LIMIT } from "@/lib/learning/title-limits";

const TEST_PATTERN = /\b(test|exam|quiz|midterm|final|sat|act|ap exam)\b/i;
const ASSIGNMENT_PATTERN = /\b(assignment|homework|paper|essay|project|presentation|worksheet|problem set|lab report|submit|turn in|due)\b|\bcomplete\s+\d+/i;
const COURSE_PATTERN = /\b(all of|entire|full)\s+(calculus|course|class)|\bcourse\b/i;
const BOOK_PATTERN = /\b(book|novel|chapter|read)\b/i;
const SKILL_PATTERN = /\b(skill|product rule|coding|programming|speaking|vocabulary|language)\b/i;
const TITLE_CHARACTER_LIMIT = LEARNING_TITLE_CHARACTER_LIMIT;
const RESOLVED_TITLE_CHARACTER_LIMIT = 72;
const MIN_TITLE_BOUNDARY_WORDS = 3;
const DANGLING_TITLE_WORDS = new Set([
  "a", "about", "above", "across", "after", "against", "along", "although", "among", "an", "and", "around", "as", "at",
  "because", "before", "behind", "below", "beneath", "beside", "between", "beyond", "but", "by", "concerning", "despite",
  "down", "during", "except", "excluding", "for", "from", "if", "in", "including", "inside", "into", "like", "near", "nor",
  "of", "off", "on", "onto", "or", "out", "outside", "over", "past", "regarding", "since", "so", "that", "the",
  "her", "his", "its", "my", "our", "their", "though", "through", "throughout", "to", "toward", "under", "underneath", "unless", "until", "up", "upon", "using", "versus", "via",
  "when", "whenever", "where", "whereas", "wherever", "whether", "while", "with", "within", "without", "yet",
  "your",
]);

export function interpretIntake(input: {
  description: string;
  materialNames: string[];
  now?: Date;
  timeZone?: string;
}): IntakeInterpretation {
  const description = normalize(input.description);
  const itemType = inferType(description);
  const dueAt = inferDueAt(
    description,
    input.now ?? new Date(),
    input.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC",
  );
  const scope = inferScope(description);
  const progress = inferProgress(description);

  return {
    title: deriveLearningTitle(description, itemType),
    objective: deriveObjective(description, itemType),
    itemType,
    dueAt,
    scope,
    progress,
    requestedMinutes: inferRequestedMinutes(description),
    materialsSummary: input.materialNames.length
      ? `${input.materialNames.length} attached ${input.materialNames.length === 1 ? "source" : "sources"}: ${input.materialNames.join(", ")}`
      : "No materials attached. YOVA can create or guide the learning from the description.",
    missingFields: [
      ...(scope.length < 8 ? ["scope" as const] : []),
      ...(!progress ? ["progress" as const] : []),
    ],
  };
}

export function deriveLearningTitle(description: string, itemType: IntakeItemType = inferType(description)) {
  const text = normalize(description);
  /**
   * Titles are derived from what the learner actually wrote.
   *
   * A keyword table used to short-circuit this and return a canned subject
   * title instead. It misfired constantly, because the keywords appear in
   * ordinary sentences: "extra credit", "credit hours", "budget my study time"
   * and "investing time in practice" all became "Personal Finance
   * Fundamentals", a goal that said "not photosynthesis" was titled
   * "Photosynthesis and Cellular Respiration", and any goal mentioning biology
   * lost its actual subject. The generated content was always correct; only the
   * title lied, on every screen that shows one.
   */

  const cleaned = text
    .replace(/^i\s+(?:have|need|want|am|would like)\s+/i, "")
    .replace(/^to\s+/i, "")
    .replace(/^(?:my|the|a|an)\s+/i, "")
    .replace(/\bnext\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi, "")
    .replace(/\s+(?:is\s+)?(?:due|by|before|on)\s+(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}(?:,\s*20\d{2})?.*$/i, "")
    .replace(/\b(?:by|before|due|on)\s+(?:tomorrow|today|next\s+\w+|in\s+\d+\s+(?:days?|weeks?)|\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?).*$/i, "")
    .replace(/\s+due(?:\s+and\b.*)?$/i, "")
    .replace(/\b(?:in|for)\s+(?:two|three|four|\d+)\s+weeks?.*$/i, "")
    .replace(/\b(?:in|for|within)\s+\d{1,3}\s*(?:minutes?|mins?|hours?|hrs?)\b.*$/i, "")
    .replace(/\bwith\s+(?:a|my)\s+(?:study guide|pdf|notes).*$/i, "")
    .replace(/\s{2,}/g, " ")
    .replace(/[.,;:]+$/g, "")
    .trim();
  const title = trimToTitlePhrase(cleaned);
  const base = title ? titleCase(title) : "New learning goal";
  // "prep" counts too, so a goal naming an SAT prep book does not become
  // "... SAT Prep Book Test Prep".
  if (itemType === "test" && !/test|exam|quiz|prep\b/i.test(base)) {
    const suffix = " Test Prep";
    const shortenedTitle = trimToTitlePhrase(cleaned, TITLE_CHARACTER_LIMIT - suffix.length);
    return `${shortenedTitle ? titleCase(shortenedTitle) : "New learning goal"}${suffix}`;
  }
  return base;
}

const GENERIC_LEARNING_TITLE = /^(personalized learning plan|personalized study plan|learning plan|study plan|new learning goal|untitled(?: plan)?)$/i;
const GENERIC_LEARNING_TOPIC = /^(the goal and concepts described by the learner|learning topic|general topic)$/i;
const LEADING_TOPIC_FRAGMENT = /^(?:[,;:.!?)}\]»]|[-–—]\s)/;

/**
 * A generated topic is persisted as the learning item's long-form context. A
 * leading delimiter means the model returned the tail of a sentence rather
 * than a standalone topic (for example, ", and the effects on cells"). Keep
 * that fragment from becoming the source of truth on the next cloud reload.
 */
export function resolveLearningTopic(candidate: string, fallback: string) {
  const topic = normalize(candidate);
  if (isStandaloneLearningTopic(topic)) return topic;

  const fallbackTopic = normalize(fallback);
  if (isStandaloneLearningTopic(fallbackTopic)) return fallbackTopic.slice(0, 300);

  return "Learning goal";
}

/**
 * Keeps learner-facing titles short and specific, including plans created before
 * stricter title validation was added. The original topic remains the source of
 * truth when the generated title is generic or reads like an unedited prompt.
 */
export function resolveLearningTitle(candidate: string, context: string) {
  const title = normalize(candidate)
    .replace(/\b(.{8,60})[.!?]\s+i\s+(?:have|need|want)\s+(?:a|an|the)?\s*\1.*$/i, "$1")
    .replace(/[.,;:]+$/g, "");
  const source = normalize(context);
  const sentenceLike = /[.!?]\s+\S/.test(title)
    || /\b(?:i|my|we|our)\s+(?:have|need|want|am|are|would|will)\b/i.test(title);
  const repeatedFragment = /\b(.{8,35})\b[\s.,:;-]+\1\b/i.test(title);
  const danglingEnding = endsWithDanglingTitleWord(title);
  const needsDerivation = !title
    || GENERIC_LEARNING_TITLE.test(title)
    || sentenceLike
    || repeatedFragment
    || danglingEnding;

  const resolved = needsDerivation
    ? isStandaloneLearningTopic(source)
      ? deriveLearningTitle(source)
      : title && !GENERIC_LEARNING_TITLE.test(title)
        ? deriveLearningTitle(title)
        : "New learning goal"
    : title;

  return shortenResolvedTitle(resolved);
}

function isStandaloneLearningTopic(value: string) {
  return Boolean(value)
    && !GENERIC_LEARNING_TOPIC.test(value)
    && !LEADING_TOPIC_FRAGMENT.test(value);
}

function inferType(description: string): IntakeItemType {
  if (TEST_PATTERN.test(description)) return "test";
  if (ASSIGNMENT_PATTERN.test(description)) return "assignment";
  if (COURSE_PATTERN.test(description)) return "course";
  if (BOOK_PATTERN.test(description)) return "book";
  if (SKILL_PATTERN.test(description)) return "skill";
  return "topic";
}

function deriveObjective(description: string, itemType: IntakeItemType) {
  if (itemType === "assignment") return `Complete the requested work with a clear sequence, realistic schedule, and support where needed: ${description}`.slice(0, 500);
  if (itemType === "test") return `Become ready to explain, recall, and apply the material described here: ${description}`.slice(0, 500);
  return `Build useful understanding and be able to use what was learned: ${description}`.slice(0, 500);
}

function inferScope(description: string) {
  const scopeMatch = description.match(/(?:on|about|covering|for)\s+([^,.]{3,180})/i);
  return normalize(scopeMatch?.[1] ?? description).slice(0, 400);
}

function inferProgress(description: string) {
  if (/\b(know nothing|ground zero|from the beginning|starting from (?:the )?beginning|haven't learned|have not learned|completely new|beginner)\b/i.test(description)) return "Starting from the beginning";
  if (/\b(know a few basics|some basics|seen it|a little)\b/i.test(description)) return "Some prior exposure";
  if (/\b(mostly review|reviewing|already know|understand the basics)\b/i.test(description)) return "Has a foundation and needs review or practice";
  return "";
}

function inferDueAt(description: string, now: Date, requestedTimeZone: string) {
  const lower = description.toLocaleLowerCase();
  const timeZone = validTimeZone(requestedTimeZone);
  const today = calendarDateInTimeZone(now, timeZone);
  if (/\btoday\b/.test(lower)) return calendarDateEnd(today, timeZone).toISOString();
  if (/\btomorrow\b/.test(lower)) {
    return calendarDateEnd(addCalendarDays(today, 1), timeZone).toISOString();
  }

  const relative = lower.match(/\b(?:in\s+)?(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\d+)\s+(day|days|week|weeks)\b/);
  if (relative) {
    const amount = wordNumber(relative[1]);
    const days = amount * (relative[2].startsWith("week") ? 7 : 1);
    return calendarDateEnd(addCalendarDays(today, days), timeZone).toISOString();
  }

  const weekdayMatch = lower.match(/\b(?:(?:by|due|on|before)\s+(?:next\s+)?|next\s+)(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/);
  if (weekdayMatch) {
    const weekdays = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
    const target = weekdays.indexOf(weekdayMatch[1]);
    const current = new Date(Date.UTC(today.year, today.month - 1, today.day, 12)).getUTCDay();
    let delta = (target - current + 7) % 7;
    if (delta === 0) delta = 7;
    return calendarDateEnd(addCalendarDays(today, delta), timeZone).toISOString();
  }

  const explicit = description.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);
  if (explicit) {
    const calendarDate = validCalendarDate(Number(explicit[1]), Number(explicit[2]), Number(explicit[3]));
    if (calendarDate) return calendarDateEnd(calendarDate, timeZone).toISOString();
  }

  const monthDate = description.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:,\s*(20\d{2}))?\b/i);
  if (monthDate) {
    const month = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"].indexOf(monthDate[1].toLocaleLowerCase());
    let year = monthDate[3] ? Number(monthDate[3]) : today.year;
    let calendarDate = validCalendarDate(year, month + 1, Number(monthDate[2]));
    if (!monthDate[3] && calendarDate && compareCalendarDates(calendarDate, today) < 0) {
      year += 1;
      calendarDate = validCalendarDate(year, month + 1, Number(monthDate[2]));
    }
    if (calendarDate) return calendarDateEnd(calendarDate, timeZone).toISOString();
  }
  return null;
}

type CalendarDate = { year: number; month: number; day: number };

function validTimeZone(value: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return value;
  } catch {
    return "UTC";
  }
}

function calendarDateInTimeZone(date: Date, timeZone: string): CalendarDate {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(date);
  const part = (type: "year" | "month" | "day") => Number(parts.find((entry) => entry.type === type)?.value);
  return { year: part("year"), month: part("month"), day: part("day") };
}

function addCalendarDays(date: CalendarDate, days: number): CalendarDate {
  const next = new Date(Date.UTC(date.year, date.month - 1, date.day + days, 12));
  return { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate() };
}

function calendarDateEnd(date: CalendarDate, timeZone: string) {
  const localAsUtc = Date.UTC(date.year, date.month - 1, date.day, 23, 59, 59, 999);
  const observed = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(new Date(localAsUtc));
  const part = (type: "year" | "month" | "day" | "hour" | "minute" | "second") => (
    Number(observed.find((entry) => entry.type === type)?.value)
  );
  const observedAsUtc = Date.UTC(
    part("year"),
    part("month") - 1,
    part("day"),
    part("hour"),
    part("minute"),
    part("second"),
    999,
  );
  return new Date(localAsUtc - (observedAsUtc - localAsUtc));
}

function validCalendarDate(year: number, month: number, day: number): CalendarDate | null {
  const candidate = new Date(Date.UTC(year, month - 1, day, 12));
  if (
    candidate.getUTCFullYear() !== year
    || candidate.getUTCMonth() + 1 !== month
    || candidate.getUTCDate() !== day
  ) return null;
  return { year, month, day };
}

function compareCalendarDates(left: CalendarDate, right: CalendarDate) {
  return Date.UTC(left.year, left.month - 1, left.day) - Date.UTC(right.year, right.month - 1, right.day);
}

function inferRequestedMinutes(description: string) {
  const match = description.match(/\b(?:in|for|within)\s+(\d{1,3})\s*(?:minutes?|mins?)\b/i);
  if (!match) return null;
  const minutes = Number(match[1]);
  return minutes >= 5 && minutes <= 180 ? minutes : null;
}

function wordNumber(value: string) {
  const numbers: Record<string, number> = {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
    eleven: 11,
    twelve: 12,
  };
  return numbers[value] ?? Number(value);
}

function titleCase(value: string) {
  const small = new Set(["a", "an", "and", "at", "for", "in", "of", "on", "the", "to", "with"]);
  return value.split(/\s+/).map((word, index) => {
    const parts = word.match(/^([^A-Za-z0-9]*)([A-Za-z][A-Za-z0-9]*)(['’]s)?([^A-Za-z0-9]*)$/);
    if (!parts) return `${word.charAt(0).toLocaleUpperCase()}${word.slice(1).toLocaleLowerCase()}`;

    const [, prefix, token, possessive = "", suffix] = parts;
    const lower = token.toLocaleLowerCase();
    const cased = /^[A-Z]{2,}\d*$/.test(token) || token === "pH"
      ? token
      : index > 0 && small.has(lower)
        ? lower
        : `${token.charAt(0).toLocaleUpperCase()}${token.slice(1).toLocaleLowerCase()}`;
    return `${prefix}${cased}${possessive}${suffix}`;
  }).join(" ");
}

function trimToTitlePhrase(value: string, characterLimit = TITLE_CHARACTER_LIMIT) {
  const allWords = value.split(/\s+/).filter(Boolean);
  let titleLength = 0;
  let words: string[] = [];

  for (const word of allWords) {
    const nextLength = titleLength + (words.length ? 1 : 0) + word.length;
    if (nextLength > characterLimit) break;
    words.push(word);
    titleLength = nextLength;
  }

  if (words.length < allWords.length) {
    let phraseBoundary = -1;
    for (let index = words.length - 1; index >= MIN_TITLE_BOUNDARY_WORDS - 1; index -= 1) {
      if (/[.,;:!?]$/.test(words[index])) {
        phraseBoundary = index + 1;
        break;
      }
    }
    if (phraseBoundary < 0) {
      for (let index = words.length - 1; index >= MIN_TITLE_BOUNDARY_WORDS; index -= 1) {
        if (DANGLING_TITLE_WORDS.has(titleWordKey(words[index]))) {
          phraseBoundary = index;
          break;
        }
      }
    }
    if (phraseBoundary >= 0) words = words.slice(0, phraseBoundary);
  }

  while (words.length && DANGLING_TITLE_WORDS.has(titleWordKey(words.at(-1) ?? ""))) {
    words.pop();
  }

  return words.join(" ").replace(/[.,;:!?]+$/g, "").trim();
}

function titleWordKey(value: string) {
  return value.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, "").toLocaleLowerCase();
}

function endsWithDanglingTitleWord(value: string) {
  const lastWord = value.split(/\s+/).filter(Boolean).at(-1) ?? "";
  return DANGLING_TITLE_WORDS.has(titleWordKey(lastWord));
}

function shortenResolvedTitle(value: string) {
  if (value.length <= RESOLVED_TITLE_CHARACTER_LIMIT) return value;

  const shortened = trimToTitlePhrase(value, RESOLVED_TITLE_CHARACTER_LIMIT - 1);
  // Generated titles are phrase-like in normal operation. This last branch is
  // only for a malformed single token longer than the entire display limit.
  const bounded = shortened || value.slice(0, RESOLVED_TITLE_CHARACTER_LIMIT - 1).trimEnd();
  return `${bounded}…`;
}

function normalize(value: string) {
  return value.replace(/\s+/g, " ").trim();
}
