export function customScheduleIssue(
  currentScheduledFor: string,
  nextScheduledFor: string,
  now = new Date(),
) {
  const currentTime = new Date(currentScheduledFor).getTime();
  const nextTime = new Date(nextScheduledFor).getTime();
  if (!Number.isFinite(nextTime)) return "Choose a valid date and time.";
  if (nextTime <= now.getTime()) return "Choose a future date and time.";
  if (Number.isFinite(currentTime) && minuteKey(currentTime) === minuteKey(nextTime)) {
    return "Choose a different date or time before saving.";
  }
  return null;
}

function minuteKey(timestamp: number) {
  return Math.floor(timestamp / 60_000);
}
