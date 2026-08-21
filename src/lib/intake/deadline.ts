const MONTH_NUMBER: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

const MONTH_NAME = "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";
const DEADLINE_CUE = "(?:due(?:\\s+(?:on|by))?|deadline(?:\\s+(?:is|on))?|by|before)";
// Keep shorthand deliberately narrow. Tests, exams, quizzes and midterms are
// events that naturally occur on a date. A paper, report or project can just
// as naturally be *about* a historical date and therefore needs an explicit
// due/deadline cue.
const ASSESSMENT_CUE = "(?:test|exam|quiz|midterm)";

type CalendarDate = { year: number; month: number; day: number };

export type DeadlineInferenceOptions = {
  now?: Date;
  timeZone?: string;
};

/**
 * Returns the learner's intended calendar deadline without first converting it
 * through the machine's local time zone. A single parser serves both universal
 * intake and the plan creator so the schedule preview cannot disagree with the
 * generated plan about the same words.
 */
export function inferDeadlineDate(
  description: string,
  options: DeadlineInferenceOptions = {},
) {
  const now = options.now ?? new Date();
  const timeZone = validTimeZone(options.timeZone ?? resolvedTimeZone());
  const today = calendarDateInTimeZone(now, timeZone);
  const text = description.replace(/\s+/g, " ").trim();
  const lower = text.toLocaleLowerCase();

  // Relative language is intrinsically scheduling language and must win over
  // an earlier historical date inside the topic, for example "a paper about
  // September 11, 2001 due in two weeks".
  const relative = lower.match(/\b(?:in|within)\s+(a|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\d+)\s+(day|days|week|weeks)\b/)
    ?? lower.match(/\b(a|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\d+)\s+(day|days|week|weeks)\s+from\s+now\b/);
  if (relative) {
    const amount = wordNumber(relative[1]);
    const days = amount * (relative[2].startsWith("week") ? 7 : 1);
    return Number.isFinite(days) && days > 0
      ? calendarDateInput(addCalendarDays(today, days))
      : null;
  }

  if (/\btomorrow\b/.test(lower)) {
    return calendarDateInput(addCalendarDays(today, 1));
  }
  if (/\btoday\b/.test(lower)) return calendarDateInput(today);

  const weekday = matchWeekdayDeadline(lower);
  if (weekday) {
    const weekdays = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
    const target = weekdays.indexOf(weekday);
    const current = new Date(Date.UTC(today.year, today.month - 1, today.day, 12)).getUTCDay();
    let delta = (target - current + 7) % 7;
    if (delta === 0) delta = 7;
    return calendarDateInput(addCalendarDays(today, delta));
  }

  const iso = matchCuedDate(text, "(20\\d{2})-(\\d{1,2})-(\\d{1,2})");
  if (iso) {
    return futureDateInputOrNull(
      Number(iso[1]),
      Number(iso[2]),
      Number(iso[3]),
      today,
    );
  }

  const namedDate = matchNamedDate(text);
  if (namedDate) {
    const month = MONTH_NUMBER[namedDate.month.toLocaleLowerCase().replace(/\.$/, "")];
    const calendarDate = resolveCalendarDate(
      month,
      namedDate.day,
      namedDate.year,
      today,
    );
    return calendarDate && compareCalendarDates(calendarDate, today) >= 0
      ? calendarDateInput(calendarDate)
      : null;
  }

  const numericDate = matchNumericDate(text);
  if (numericDate) {
    const [first, second] = [numericDate.first, numericDate.second];
    // With no locale signal, use the UI's month/day convention for ambiguous
    // values. Still accept an unambiguous day-first value such as 23/09/2026.
    const month = first > 12 && second <= 12 ? second : first;
    const day = first > 12 && second <= 12 ? first : second;
    const calendarDate = resolveCalendarDate(month, day, numericDate.year, today);
    return calendarDate && compareCalendarDates(calendarDate, today) >= 0
      ? calendarDateInput(calendarDate)
      : null;
  }

  return null;
}

export function inferDeadlineDueAt(
  description: string,
  options: DeadlineInferenceOptions = {},
) {
  const timeZone = validTimeZone(options.timeZone ?? resolvedTimeZone());
  const dateInput = inferDeadlineDate(description, { ...options, timeZone });
  return dateInput ? deadlineAtEndOfDay(dateInput, timeZone) : null;
}

export function deadlineAtEndOfDay(dateInput: string, requestedTimeZone: string) {
  const parsed = parseDateInput(dateInput);
  if (!parsed) return null;
  return calendarDateEnd(parsed, validTimeZone(requestedTimeZone))?.toISOString() ?? null;
}

export function deadlineDateInputFromIso(value: string, requestedTimeZone: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return calendarDateInput(calendarDateInTimeZone(date, validTimeZone(requestedTimeZone)));
}

/**
 * Intake seeds can outlive the screen that created them. Apply the same
 * learner-local minimum as the visible date input before prefilling Plan
 * Creator, rather than relying on the browser to reject a stale value.
 */
export function futureDeadlineDateInputFromIso(
  value: string,
  requestedTimeZone: string,
  now = new Date(),
) {
  const timeZone = validTimeZone(requestedTimeZone);
  const deadline = deadlineDateInputFromIso(value, timeZone);
  if (!deadline || Number.isNaN(now.getTime())) return "";
  const today = calendarDateInput(calendarDateInTimeZone(now, timeZone));
  return deadline >= today ? deadline : "";
}

function matchNamedDate(text: string) {
  const valuePattern = `(${MONTH_NAME})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(20\\d{2}))?`;
  const match = matchCuedDate(text, valuePattern);
  if (!match) return null;
  return {
    month: match[1],
    day: Number(match[2]),
    year: match[3] ? Number(match[3]) : null,
  };
}

function matchNumericDate(text: string) {
  const valuePattern = "(\\d{1,2})[/-](\\d{1,2})(?:[/-](20\\d{2}))?";
  const match = matchCuedDate(text, valuePattern);
  if (!match) return null;
  return {
    first: Number(match[1]),
    second: Number(match[2]),
    year: match[3] ? Number(match[3]) : null,
  };
}

function matchCuedDate(text: string, valuePattern: string) {
  const explicit = text.match(new RegExp(`\\b${DEADLINE_CUE}\\s+${valuePattern}\\b`, "i"));
  if (explicit) return explicit;
  // Greedy bounded context intentionally chooses the final "on" in wording
  // such as "chemistry quiz on equilibrium on September 4". Papers, reports,
  // projects and presentations do not get this shorthand.
  return text.match(new RegExp(
    `\\b${ASSESSMENT_CUE}\\b[^.,;]{0,64}\\bon\\s+${valuePattern}\\b`,
    "i",
  ));
}

function matchWeekdayDeadline(text: string) {
  const weekday = "(monday|tuesday|wednesday|thursday|friday|saturday|sunday)";
  const explicit = text.match(new RegExp(
    `\\b${DEADLINE_CUE}\\s+(?:next\\s+)?${weekday}\\b`,
    "i",
  ));
  if (explicit) return explicit[1];
  const assessment = text.match(new RegExp(
    `\\b${ASSESSMENT_CUE}\\b[^.,;]{0,64}\\bon\\s+(?:next\\s+)?${weekday}\\b`,
    "i",
  ));
  if (assessment) return assessment[1];
  return text.match(new RegExp(`\\bnext\\s+${weekday}\\b`, "i"))?.[1] ?? null;
}

function resolveCalendarDate(
  month: number | undefined,
  day: number,
  explicitYear: number | null,
  today: CalendarDate,
) {
  if (!month) return null;
  let year = explicitYear ?? today.year;
  let calendarDate = validCalendarDate(year, month, day);
  if (!calendarDate) return null;
  if (explicitYear === null && compareCalendarDates(calendarDate, today) < 0) {
    year += 1;
    calendarDate = validCalendarDate(year, month, day);
  }
  return calendarDate;
}

function parseDateInput(value: string) {
  const match = value.match(/^(20\d{2})-(\d{2})-(\d{2})$/);
  return match
    ? validCalendarDate(Number(match[1]), Number(match[2]), Number(match[3]))
    : null;
}

function futureDateInputOrNull(
  year: number,
  month: number,
  day: number,
  today: CalendarDate,
) {
  const date = validCalendarDate(year, month, day);
  return date && compareCalendarDates(date, today) >= 0
    ? calendarDateInput(date)
    : null;
}

function resolvedTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

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
  const requestedAsUtc = Date.UTC(date.year, date.month - 1, date.day, 23, 59, 59);
  let candidate = requestedAsUtc;

  // The first observed offset can belong to the neighboring day after a DST
  // transition. Re-evaluate from the corrected instant until its formatted
  // local fields match the requested wall clock exactly.
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const observed = calendarDateTimeInTimeZone(new Date(candidate), timeZone);
    const observedAsUtc = Date.UTC(
      observed.year,
      observed.month - 1,
      observed.day,
      observed.hour,
      observed.minute,
      observed.second,
    );
    const correction = requestedAsUtc - observedAsUtc;
    if (correction === 0) return new Date(candidate + 999);
    candidate += correction;
  }

  return null;
}

function calendarDateTimeInTimeZone(date: Date, timeZone: string) {
  const observed = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(date);
  const part = (type: "year" | "month" | "day" | "hour" | "minute" | "second") => (
    Number(observed.find((entry) => entry.type === type)?.value)
  );
  return {
    year: part("year"),
    month: part("month"),
    day: part("day"),
    hour: part("hour"),
    minute: part("minute"),
    second: part("second"),
  };
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

function calendarDateInput(date: CalendarDate) {
  return `${date.year}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`;
}

function wordNumber(value: string) {
  const numbers: Record<string, number> = {
    a: 1,
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
