import type {
  GeneratedPlanDraft,
  PlanGenerationRequest,
} from "@/lib/plan-generation/schema";

const WINDOW_HOUR: Record<string, number> = {
  morning: 9,
  afternoon: 14,
  evening: 19,
  anytime: 17,
  now: 12,
};

export class PlanScheduleCapacityError extends Error {
  constructor() {
    super("The selected study windows do not have enough room for this plan before the deadline.");
    this.name = "PlanScheduleCapacityError";
  }
}

/**
 * Dates are a deterministic product concern, not a language-model judgment.
 * The model decides the instructional sequence; YOVA aligns that sequence to
 * the learner's real availability before the plan reaches the quality gate.
 */
export function alignGeneratedPlanToAvailability(
  draft: GeneratedPlanDraft,
  request: PlanGenerationRequest,
  now = new Date(),
): GeneratedPlanDraft {
  if (request.intent === "study_now") {
    return {
      ...draft,
      sessions: draft.sessions.map((session, index) => ({
        ...session,
        scheduledFor: index === 0 ? now.toISOString() : session.scheduledFor,
      })),
    };
  }

  const candidates = availableSlots(request, now, Math.max(42, draft.sessions.length * 10));
  if (candidates.length === 0) throw new PlanScheduleCapacityError();

  let slotIndex = 0;
  let usedMinutes = 0;
  const sessions = draft.sessions.map((session) => {
    while (
      slotIndex < candidates.length
      && usedMinutes + session.estimatedMinutes > candidates[slotIndex].minutes
    ) {
      slotIndex += 1;
      usedMinutes = 0;
    }
    const slot = candidates[slotIndex];
    if (!slot) throw new PlanScheduleCapacityError();
    const scheduledFor = new Date(slot.date.getTime() + usedMinutes * 60_000).toISOString();
    usedMinutes += session.estimatedMinutes;
    return { ...session, scheduledFor };
  });

  return {
    ...draft,
    sessions,
  };
}

type AvailableSlot = { date: Date; minutes: number };

function availableSlots(
  request: PlanGenerationRequest,
  now: Date,
  searchDays: number,
): AvailableSlot[] {
  const localToday = localCalendarDate(now, request.timeZone);
  const deadline = request.deadline ? new Date(request.deadline).getTime() : null;
  const results: AvailableSlot[] = [];

  for (let offset = 0; offset < searchDays; offset += 1) {
    const calendarDate = addCalendarDays(localToday, offset);
    const weekday = weekdayForCalendarDate(calendarDate);
    const matches = request.availability.filter((slot) => (
      slot.day.toLocaleLowerCase() === weekday.toLocaleLowerCase()
      || slot.day.toLocaleLowerCase() === "every day"
    ));

    for (const slot of matches) {
      const hour = WINDOW_HOUR[slot.window.toLocaleLowerCase()] ?? 17;
      const date = localDateTimeToUtc(calendarDate, hour, request.timeZone);
      if (date.getTime() < now.getTime() - 60_000) continue;
      if (deadline !== null && date.getTime() > deadline) continue;
      const minutesBeforeDeadline = deadline === null
        ? slot.minutes
        : Math.floor((deadline - date.getTime()) / 60_000);
      const minutes = Math.min(slot.minutes, minutesBeforeDeadline);
      if (minutes < 1) continue;
      results.push({ date, minutes });
    }
  }

  return results.sort((left, right) => left.date.getTime() - right.date.getTime());
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
