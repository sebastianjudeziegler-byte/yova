import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "src/components/yova-prototype.tsx"),
  "utf8",
);
const earlyStart = source.slice(
  source.indexOf("const startEarlySession = async"),
  source.indexOf("const activateConceptReview = async"),
);
const agenda = source.slice(
  source.indexOf("function AgendaScreen("),
  source.indexOf("function AskScreen("),
);

describe("Agenda transactional scheduling wiring", () => {
  it("moves the early-start batch with one advance-now request", () => {
    expect(earlyStart).toContain("persistPlanSchedule(requestedPlan.id, updates, { operationKind: \"advance_now\" })");
    expect(earlyStart).not.toContain("Promise.all(");
    expect(earlyStart).not.toContain("/api/sessions/schedule");
  });

  it("uses the same client for a manual move and applies its authoritative schedule", () => {
    expect(agenda).toContain("persistPlanSchedule(entry.plan.id, updates)");
    expect(agenda).toContain("onReschedule(entry.plan.id, authoritative.sessions)");
  });

  it("blocks unchanged and past custom times both before click and at save", () => {
    expect(agenda).toContain("customScheduleIssue(movingEntry.session.scheduledFor, customTime)");
    expect(agenda).toContain("customScheduleIssue(movingEntry.session.scheduledFor, scheduledFor)");
    expect(agenda).toContain("disabled={!customTime || saving || Boolean(customMoveIssue)}");
  });
});
