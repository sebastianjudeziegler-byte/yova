import type { CalendarBlock, PlanSessionCalendarBlock } from "@/lib/calendar/types";

export type NextUpItem = {
  block: PlanSessionCalendarBlock;
  /** "overdue" = scheduled before today and not done; "today"; "upcoming" = a future day. */
  bucket: "overdue" | "today" | "upcoming";
  startsAt: string;
};

function startOfToday(now: Date): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function endOfToday(now: Date): number {
  const d = new Date(now);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

/**
 * Turns the calendar's blocks into an ordered "do these next" queue for the
 * rail: only startable, not-yet-done plan sessions, ordered overdue → today →
 * upcoming, and by scheduled time within each bucket. This is what fills the
 * blank left column on the Calendar tab.
 */
export function buildNextUpQueue(
  blocks: readonly CalendarBlock[],
  now: Date,
  limit = 8,
): NextUpItem[] {
  const todayStart = startOfToday(now);
  const todayEnd = endOfToday(now);

  const items: NextUpItem[] = [];
  for (const block of blocks) {
    if (block.source !== "plan_session") continue;
    if (block.done) continue;
    if (block.session.status !== "ready") continue;
    const startsMs = Date.parse(block.startsAt);
    if (Number.isNaN(startsMs)) continue;

    let bucket: NextUpItem["bucket"];
    if (startsMs < todayStart) bucket = "overdue";
    else if (startsMs <= todayEnd) bucket = "today";
    else bucket = "upcoming";

    items.push({ block, bucket, startsAt: block.startsAt });
  }

  const bucketRank: Record<NextUpItem["bucket"], number> = { overdue: 0, today: 1, upcoming: 2 };
  items.sort((a, b) => {
    if (a.bucket !== b.bucket) return bucketRank[a.bucket] - bucketRank[b.bucket];
    return Date.parse(a.startsAt) - Date.parse(b.startsAt);
  });

  return items.slice(0, limit);
}
