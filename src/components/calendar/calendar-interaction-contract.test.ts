import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "src/components/calendar/calendar-screen.tsx"),
  "utf8",
);
const styles = readFileSync(
  resolve(process.cwd(), "src/app/calendar.css"),
  "utf8",
);
const prototype = readFileSync(
  resolve(process.cwd(), "src/components/yova-prototype.tsx"),
  "utf8",
);

describe("Calendar outcome inspection and session-order controls", () => {
  it("keeps milestones out of the timed grid while making due outcomes inspectable", () => {
    const start = source.indexOf("function WeekCalendar(");
    const end = source.indexOf("function CalendarViewStub(", start);
    const week = source.slice(start, end);
    const helperStart = source.indexOf("function outcomeInspectionBlockId(");
    const helperEnd = source.indexOf("function blockMinutes(", helperStart);
    const helper = source.slice(helperStart, helperEnd);

    expect(week).toContain('block.source !== "milestone"');
    expect(week).toContain("const visibleOutcomes = calendarOutcomesWithMilestones(outcomes, blocks);");
    expect(week).toContain("const outcomeBlockId = outcomeInspectionBlockId(outcome, blocks);");
    expect(week).toContain('className={`calendar-due-chip ${outcome.status} ${selected ? "selected" : ""}`}');
    expect(week).toContain("aria-pressed={selected}");
    expect(week).toContain("outcomeBlockId ? onSelect(outcomeBlockId) : outcome.planId ? onOpenPlan(outcome.planId)");
    expect(helper).toContain('candidate.source === "milestone"');
    expect(helper).toContain("candidate.milestone.id === outcome.milestoneId");
    expect(helper).toContain('candidate.source === "manual"');
    expect(helper).toContain("candidate.event.id === outcome.manualEventId");
    expect(source).toContain('if (block.source !== "milestone" || representedMilestoneIds.has(block.milestone.id)) return [];');
    expect(source).toContain('milestoneId: block.milestone.id');
  });

  it("opens an existing linked plan from milestone details instead of offering a duplicate conversion", () => {
    const detailStart = source.indexOf("function SelectedBlockDetail(");
    const detailEnd = source.indexOf("function YourDayCard(", detailStart);
    const detail = source.slice(detailStart, detailEnd);
    const selectedStart = source.indexOf("{selectedBlock ? <SelectedBlockDetail");
    const selectedEnd = source.indexOf("/> : <YourDayCard", selectedStart);
    const selected = source.slice(selectedStart, selectedEnd);

    expect(detail).toContain('const milestoneHasLinkedPlan = block.source === "milestone" && Boolean(outcome?.planId);');
    expect(detail).toContain("{milestoneHasLinkedPlan");
    expect(detail).toContain('onClick={onOpenPlan}>Open plan</button>');
    expect(detail).toContain(': <><button type="button" className="button primary" disabled={completingMilestone || deletingMilestone} onClick={onBuildPlan}>Build plan</button>');
    expect(selected).toContain('if (selectedBlock.source === "milestone" && selectedOutcome?.planId)');
    expect(selected).toContain('if (selectedBlock.source === "milestone" && !selectedOutcome?.planId)');
  });

  it("never skips a newer non-undoable change to undo older history", () => {
    const handlerStart = source.indexOf("const undoLatestChange = async");
    const handlerEnd = source.indexOf("const handleDrop = async", handlerStart);
    const handler = source.slice(handlerStart, handlerEnd);
    const selectionStart = source.indexOf("const latestActiveChange =");
    const selectionEnd = source.indexOf("return <div", selectionStart);
    const selection = source.slice(selectionStart, selectionEnd);

    expect(handler).toContain(".find((item) => item.undoneAt === null)");
    expect(handler).not.toContain("item.undoable && item.undoneAt === null");
    expect(selection).toContain("const latestActiveChange =");
    expect(selection).toContain("entry.undoneAt === null");
    expect(selection).not.toContain("entry.undoable && entry.undoneAt === null");
    expect(source).toContain("Undo unavailable: {latestUndoEligibility.reason}");
  });

  it("contains milestone completion and deletion failures inside the Calendar action boundary", () => {
    const completeStart = source.indexOf("const completeMilestone = async");
    const completeEnd = source.indexOf("const deleteMilestone = async", completeStart);
    const complete = source.slice(completeStart, completeEnd);
    const deleteStart = completeEnd;
    const deleteEnd = source.indexOf("const undoLatestChange = async", deleteStart);
    const deletion = source.slice(deleteStart, deleteEnd);

    expect(complete).toContain("await onUpdateMilestone");
    expect(complete).toContain("catch (error)");
    expect(complete).toContain("YOVA could not mark that outcome complete.");
    expect(complete).toContain("finally");
    expect(deletion).toContain("await onDeleteMilestone");
    expect(deletion).toContain("catch (error)");
    expect(deletion).toContain("YOVA could not delete that outcome.");
    expect(deletion).toContain("finally");
    expect(source).toContain('pending === `milestone-complete:${block.milestone.id}`');
    expect(source).toContain('pending === `milestone-delete:${block.milestone.id}`');
    expect(source).not.toContain('if (selectedBlock.source === "milestone") void onDeleteMilestone');
    expect(source).not.toContain('if (selectedBlock.source === "milestone") void onUpdateMilestone');
  });

  it("renders Start only for the exact ready plan-session block", () => {
    const detailStart = source.indexOf("function SelectedBlockDetail(");
    const detailEnd = source.indexOf("function YourDayCard(", detailStart);
    const detail = source.slice(detailStart, detailEnd);
    const dayStart = detailEnd;
    const dayEnd = source.indexOf("function NearestOutcomeCard(", dayStart);
    const day = source.slice(dayStart, dayEnd);

    expect(detail).toContain('const readyToStart = block.source === "plan_session" && block.session.status === "ready";');
    expect(detail).toContain('{readyToStart && <button type="button" className="button primary"');
    expect(detail).toContain("This is upcoming work. It stays visible on your calendar, but follows the earlier unfinished sessions in this plan.");
    expect(day).toContain('const readyToStart = block.source === "plan_session" && block.session.status === "ready";');
    expect(day).toContain('{upNext && readyToStart && <button type="button" className="button primary"');
    expect(day).toContain("Upcoming work follows the earlier sessions in this plan and cannot be started from this block yet.");

    const startBlockStart = source.indexOf("const startBlock = (");
    const startBlockEnd = source.indexOf("const beginReview =", startBlockStart);
    const startBlock = source.slice(startBlockStart, startBlockEnd);
    expect(startBlock).toContain("onStart({ planId: block.plan.id, planSessionId: block.session.id })");

    const requestStart = prototype.slice(
      prototype.indexOf("const requestSessionStart = ("),
      prototype.indexOf("const startEarlySession = async", prototype.indexOf("const requestSessionStart = (")),
    );
    expect(requestStart).toContain("activePlans.find((plan) => plan.id === planId) ?? null");
    expect(requestStart).toContain("session.id === planSessionId");
    expect(requestStart).toContain("if (planSessionId && readySessions.length !== 1) return false;");
    expect(requestStart).toContain("startSession(requestedPlan.id, undefined, undefined, requestedSession.id)");
  });

  it("does not offer a drag resize handle for plan-wide learning adjustments", () => {
    const start = source.indexOf("function WeekCalendar(");
    const end = source.indexOf("function CalendarViewStub(", start);
    const week = source.slice(start, end);
    const detailStart = source.indexOf("function SelectedBlockDetail(");
    const detailEnd = source.indexOf("function YourDayCard(", detailStart);
    const detail = source.slice(detailStart, detailEnd);

    expect(week).toContain('const resizable = draggable && block.source !== "plan_session";');
    expect(week).toContain("{resizable && <span");
    expect(detail).toContain("Shorten safely rebuilds every unfinished ordinary session in this plan");
    expect(detail).toContain("It does not merely resize this one calendar event.");
  });

  it("contains selectable due chips inside narrow day columns", () => {
    const chipStart = styles.indexOf(".calendar-due-chip {");
    const chipEnd = styles.indexOf(".calendar-time-grid {", chipStart);
    const chipStyles = styles.slice(chipStart, chipEnd);

    expect(chipStyles).toContain("width: 100%;");
    expect(chipStyles).toContain("min-width: 0;");
    expect(chipStyles).toContain("text-overflow: ellipsis;");
    expect(chipStyles).toContain('.calendar-due-chip[aria-pressed="true"]');
    expect(chipStyles).toContain(".calendar-due-chip:focus-visible");
  });
});
