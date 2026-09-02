import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "src/components/yova-prototype.tsx"),
  "utf8",
);
const calendarSource = readFileSync(
  resolve(process.cwd(), "src/components/calendar/calendar-screen.tsx"),
  "utf8",
);
const earlyStart = source.slice(
  source.indexOf("const startEarlySession = async"),
  source.indexOf("const activateConceptReview = async"),
);
const calendarMove = calendarSource.slice(
  calendarSource.indexOf("const reschedulePlanBlock = async"),
  calendarSource.indexOf("const moveBlock = async"),
);

describe("Calendar transactional scheduling wiring", () => {
  it("moves the early-start batch with one advance-now request", () => {
    expect(earlyStart).toContain("persistPlanSchedule(requestedPlan.id, updates, { operationKind: \"advance_now\" })");
    expect(earlyStart).not.toContain("Promise.all(");
    expect(earlyStart).not.toContain("/api/sessions/schedule");
  });

  it("uses the same client for a manual move and applies its authoritative schedule", () => {
    expect(calendarMove).toContain("persistPlanSchedule(block.plan.id, updates)");
    expect(calendarMove).toContain("onReschedule(block.plan.id, result.sessions)");
    expect(calendarMove.indexOf("persistPlanSchedule(block.plan.id, updates)"))
      .toBeLessThan(calendarMove.indexOf("onReschedule(block.plan.id, result.sessions)"));
  });

  it("rejects unchanged and past custom times before any schedule persistence", () => {
    expect(calendarMove).toContain("customScheduleIssue(block.session.scheduledFor, scheduledFor)");
    expect(calendarMove.indexOf("customScheduleIssue(block.session.scheduledFor, scheduledFor)"))
      .toBeLessThan(calendarMove.indexOf("persistPlanSchedule(block.plan.id, updates)"));
  });
});
