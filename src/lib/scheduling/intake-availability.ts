import type { PlanCreatorScheduleState } from "@/lib/scheduling/plan-creator-schedule";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/** Only a study-availability clause supplies days; an exam date is not availability. */
export function scheduleFromIntake(
  fallback: PlanCreatorScheduleState,
  description: string,
  requestedMinutes?: number | null,
): PlanCreatorScheduleState {
  const match = description.match(/\b(?:can\s+(?:study|practice|work)|(?:am\s+)?available|study\s+(?:on|every|for)|practice\s+on|(?:I\s+)?have\s+\d{1,2}\s*(?:minutes?|mins?)\s+(?:each|every))\b([^.!?;]*)/i);
  const prefix = description.slice(0, match?.index ?? 0);
  const clause = /\b(?:not|never|cannot|can't)\s+(?:\w+\s+){0,2}$/i.test(prefix) ? null : match?.[0];
  if (!clause) return fallback;
  const explicitDays = DAYS.filter((day) => new RegExp(`\\b${day}s?\\b`, "i").test(clause));
  const range = clause.match(/\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s*(?:to|through|[-–])\s*(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/i);
  if (range) {
    const start = DAYS.findIndex((day) => day.toLowerCase() === range[1]!.toLowerCase());
    const end = DAYS.findIndex((day) => day.toLowerCase() === range[2]!.toLowerCase());
    for (let offset = 0; offset <= (end - start + 7) % 7; offset += 1) explicitDays.push(DAYS[(start + offset) % 7]!);
  }
  if (/\bweekdays?\b/i.test(clause)) explicitDays.push(...DAYS.slice(0, 5));
  if (/\bweekends?\b/i.test(clause)) explicitDays.push(...DAYS.slice(5));
  if (/\bevery\s+day|\bdaily\b/i.test(clause)) explicitDays.push(...DAYS);
  const excludedClause = clause.match(/\b(?:except|but not|not on|excluding)\b(.*)/i)?.[1] ?? "";
  const selectedDays = new Set(explicitDays.filter((day) => !new RegExp(`\\b${day}s?\\b`, "i").test(excludedClause)));
  const windowMatch = clause.match(/\b(morning|afternoon|evening)s?\b/i)?.[1];
  const window = windowMatch ? `${windowMatch[0]!.toUpperCase()}${windowMatch.slice(1).toLowerCase()}` as "Morning" | "Afternoon" | "Evening" : null;
  const minutesMatch = clause.match(/\b(\d{1,2})\s*(?:minutes?|mins?)\b/i)?.[1];
  const parsedMinutes = minutesMatch ? Number(minutesMatch) : requestedMinutes;
  const minutes = parsedMinutes && parsedMinutes >= 1 && parsedMinutes <= 90 ? parsedMinutes : fallback.sessionLength;
  if (!selectedDays.size && !window && minutes === fallback.sessionLength) return fallback;
  return {
    ...fallback,
    ...(selectedDays.size ? { studyFrequency: selectedDays.size === 7 ? "every_day" : selectedDays.size >= 5 ? "most_days" : selectedDays.size >= 3 ? "three_four" : "one_two" } : {}),
    preferredWindows: window ? [window] : fallback.preferredWindows,
    sessionLength: minutes,
    customScheduleOpen: true,
    availabilityChoices: fallback.availabilityChoices.map((choice) => ({
      ...choice,
      enabled: selectedDays.size ? selectedDays.has(choice.day) : choice.enabled,
      window: window ?? choice.window,
      minutes,
    })),
  };
}
