const OVERDUE_GRACE_MINUTES = 30;

export function isSessionOverdue(
  scheduledFor: string,
  now = new Date(),
  graceMinutes = OVERDUE_GRACE_MINUTES,
) {
  const scheduledAt = new Date(scheduledFor).getTime();
  if (!Number.isFinite(scheduledAt)) return false;
  return scheduledAt < now.getTime() - Math.max(0, graceMinutes) * 60_000;
}

export function recoverySessionMinutes(currentMinutes: number) {
  if (!Number.isFinite(currentMinutes)) return 15;
  const halvedToFive = Math.round((currentMinutes / 2) / 5) * 5;
  return Math.max(10, Math.min(20, halvedToFive));
}

export function tomorrowAtSessionTime(scheduledFor: string, now = new Date()) {
  const original = new Date(scheduledFor);
  const next = new Date(now);
  next.setDate(next.getDate() + 1);
  if (!Number.isNaN(original.getTime())) {
    next.setHours(original.getHours(), original.getMinutes(), 0, 0);
  } else {
    next.setHours(17, 0, 0, 0);
  }
  return next.toISOString();
}
