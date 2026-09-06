import type { CalendarBlock } from "@/lib/calendar/types";

export function isTimedCalendarBlock(block: CalendarBlock) {
  return block.source !== "milestone" && !(block.source === "manual" && block.event.deadlineOnly);
}

export function occupiesCalendarTime(block: CalendarBlock) {
  return isTimedCalendarBlock(block) && !block.done && block.blockType !== "free_block";
}

export type CalendarDaySegment = {
  block: CalendarBlock;
  startMinute: number;
  endMinute: number;
  continuesBefore: boolean;
  continuesAfter: boolean;
  lane: number;
  laneCount: number;
};

/** Clip overnight events to each local day, then allocate non-overlapping lanes. */
export function layoutCalendarDay(blocks: readonly CalendarBlock[], day: Date): CalendarDaySegment[] {
  const start = new Date(day.getFullYear(), day.getMonth(), day.getDate());
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  const segments = blocks.filter(isTimedCalendarBlock).flatMap<CalendarDaySegment>((block) => {
    const from = new Date(block.startsAt);
    const to = new Date(block.endsAt);
    if (from >= end || to <= start) return [];
    return [{
      block,
      startMinute: from < start ? 0 : from.getHours() * 60 + from.getMinutes(),
      endMinute: to >= end ? 1440 : to.getHours() * 60 + to.getMinutes(),
      continuesBefore: from < start,
      continuesAfter: to > end,
      lane: 0,
      laneCount: 1,
    }];
  }).sort((a, b) => a.startMinute - b.startMinute || b.endMinute - a.endMinute || a.block.id.localeCompare(b.block.id));
  let group: CalendarDaySegment[] = [];
  let groupEnd = -1;
  let laneEnds: number[] = [];
  const flush = () => { for (const item of group) item.laneCount = laneEnds.length; };
  for (const segment of segments) {
    if (segment.startMinute >= groupEnd) {
      flush(); group = []; laneEnds = []; groupEnd = -1;
    }
    // Minimum display height is 26px (29 calendar minutes at 54px/hour).
    const visualEnd = Math.max(segment.endMinute, segment.startMinute + 29);
    let lane = laneEnds.findIndex((value) => value <= segment.startMinute);
    if (lane < 0) lane = laneEnds.length;
    laneEnds[lane] = visualEnd;
    segment.lane = lane;
    group.push(segment);
    groupEnd = Math.max(groupEnd, visualEnd);
  }
  flush();
  return segments;
}
