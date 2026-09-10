import type { PlanAvailabilitySlot } from "@/lib/plan-generation/availability-slots";

export type ReservedTime = Readonly<{ startsAt: string; endsAt: string }>;

/** Subtract occupied time after canonicalizing availability. Each returned
 * fragment retains the original declaration indexes, with exact boundaries.
 * Creation, revision composition and final validation must use this same
 * function; a revision may not move a materialized session after validation. */
export function subtractReservedAvailability(
  slots: readonly PlanAvailabilitySlot[],
  reservations: readonly ReservedTime[] = [],
): readonly PlanAvailabilitySlot[] {
  const intervals = reservations.map(({ startsAt, endsAt }) => {
    const start = Date.parse(startsAt);
    const end = Date.parse(endsAt);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      throw new Error("Calendar reservations need valid increasing start and end times.");
    }
    return { start, end };
  }).sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: Array<{ start: number; end: number }> = [];
  for (const interval of intervals) {
    const previous = merged.at(-1);
    if (previous && interval.start <= previous.end) previous.end = Math.max(previous.end, interval.end);
    else merged.push({ ...interval });
  }
  return slots.flatMap(slot => {
    let cursor = Date.parse(slot.startsAt);
    const end = Date.parse(slot.endsAt);
    const pieces: PlanAvailabilitySlot[] = [];
    const append = (start: number, finish: number) => {
      const minutes = Math.floor((finish - start) / 60_000);
      if (minutes > 0) pieces.push(Object.freeze({ ...slot, startsAt: new Date(start).toISOString(), endsAt: new Date(finish).toISOString(), minutes }));
    };
    for (const interval of merged) {
      if (interval.end <= cursor) continue;
      if (interval.start >= end) break;
      append(cursor, Math.min(interval.start, end));
      cursor = Math.max(cursor, interval.end);
      if (cursor >= end) break;
    }
    if (cursor < end) append(cursor, end);
    return pieces;
  });
}
