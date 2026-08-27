export const STUDY_DAY_WINDOWS = [
  "morning",
  "afternoon",
  "evening",
  "late_night",
] as const;

export type StudyDayWindow = (typeof STUDY_DAY_WINDOWS)[number];

/**
 * Maps one instant into YOVA's existing learner-local planning windows.
 * Invalid timestamps return null. An invalid time-zone identifier falls back
 * to UTC so this pure boundary remains deterministic for legacy callers;
 * request schemas should still reject invalid zones before using it.
 */
export function studyDayWindowForInstant(
  value: string | Date,
  timeZone: string,
): StudyDayWindow | null {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;

  let hour: number;
  try {
    const part = new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      hourCycle: "h23",
      timeZone,
    }).formatToParts(date).find((item) => item.type === "hour")?.value;
    hour = Number(part);
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null;
  } catch {
    hour = date.getUTCHours();
  }

  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 22) return "evening";
  return "late_night";
}
