import { describe, expect, it } from "vitest";
import { buildNextUpQueue } from "./next-up-queue";
import type { CalendarBlock } from "@/lib/calendar/types";

const now = new Date("2026-09-03T12:00:00.000Z");

function planBlock(
  id: string,
  startsAt: string,
  done = false,
  status: "ready" | "upcoming" = "ready",
): CalendarBlock {
  return {
    id,
    title: `Session ${id}`,
    startsAt,
    endsAt: startsAt,
    done,
    fixed: false,
    courseId: null,
    courseLabel: null,
    outcomeId: null,
    source: "plan_session",
    blockType: "yova",
    // Only the fields buildNextUpQueue reads matter for ordering.
    plan: { id: `plan-${id}` } as never,
    session: { id: `sess-${id}`, status } as never,
    learningMode: "learn",
    methodName: "Feynman",
    methodReason: "",
    placementReason: { source: "task", text: "" } as never,
    flexibility: "movable",
  } as CalendarBlock;
}

function milestoneBlock(id: string, startsAt: string): CalendarBlock {
  return {
    id, title: `Exam ${id}`, startsAt, endsAt: startsAt, done: false, fixed: true,
    courseId: null, courseLabel: null, outcomeId: null,
    source: "milestone", blockType: "exam", milestone: { id } as never,
  } as CalendarBlock;
}

describe("buildNextUpQueue", () => {
  it("orders overdue first, then today, then upcoming, by time within each", () => {
    const blocks = [
      planBlock("today-late", "2026-09-03T18:00:00.000Z"),
      planBlock("upcoming", "2026-09-05T09:00:00.000Z"),
      planBlock("overdue-old", "2026-08-19T17:00:00.000Z"),
      planBlock("today-early", "2026-09-03T08:00:00.000Z"),
      planBlock("overdue-recent", "2026-09-01T10:00:00.000Z"),
    ];
    const order = buildNextUpQueue(blocks, now).map((item) => item.block.id);
    expect(order).toEqual([
      "overdue-old",
      "overdue-recent",
      "today-early",
      "today-late",
      "upcoming",
    ]);
  });

  it("labels buckets correctly", () => {
    const queue = buildNextUpQueue([
      planBlock("a", "2026-08-19T17:00:00.000Z"),
      planBlock("b", "2026-09-03T20:00:00.000Z"),
      planBlock("c", "2026-09-06T09:00:00.000Z"),
    ], now);
    expect(queue.map((i) => i.bucket)).toEqual(["overdue", "today", "upcoming"]);
  });

  it("excludes done, upcoming, milestone, and manual blocks", () => {
    const queue = buildNextUpQueue([
      planBlock("done", "2026-09-01T10:00:00.000Z", true),
      planBlock("locked", "2026-09-03T14:00:00.000Z", false, "upcoming"),
      milestoneBlock("exam", "2026-09-04T10:00:00.000Z"),
      planBlock("live", "2026-09-02T10:00:00.000Z"),
    ], now);
    expect(queue.map((i) => i.block.id)).toEqual(["live"]);
  });

  it("respects the limit", () => {
    const blocks = Array.from({ length: 12 }, (_, i) =>
      planBlock(`s${i}`, `2026-09-0${(i % 5) + 4}T09:00:00.000Z`));
    expect(buildNextUpQueue(blocks, now, 8)).toHaveLength(8);
  });

  it("returns empty when nothing is startable", () => {
    expect(buildNextUpQueue([milestoneBlock("m", "2026-09-04T10:00:00.000Z")], now)).toEqual([]);
  });
});
