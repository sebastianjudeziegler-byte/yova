import { describe, expect, it } from "vitest";
import type { LearningPlan } from "@/lib/domain";
import { emptyCalendarPrototypeState } from "@/lib/calendar/persistence";
import {
  calendarChangeUndoEligibility,
  calendarUndoCommand,
  markCalendarChangeUndone,
} from "@/lib/calendar/insights";
import type { CalendarChangeLogEntry, ManualCalendarEvent } from "@/lib/calendar/types";

const NOW = new Date("2026-09-02T12:00:00.000Z");

function schedulePlan(scheduledFor = "2026-09-04T17:00:00.000Z"): LearningPlan {
  return {
    id: "plan",
    learningItemId: "item",
    title: "History",
    topic: "History",
    kind: "test",
    deadline: "2026-09-10T23:59:59.000Z",
    status: "active",
    sourceMode: "yova_generated",
    studyMode: "inside_yova",
    learningIntent: "study",
    rationale: "Prepare before the deadline.",
    createdAt: "2026-09-01T10:00:00.000Z",
    sessions: [{
      id: "session",
      sequence: 1,
      title: "Retrieve causes",
      objective: "Retrieve the causes accurately.",
      method: "Retrieval",
      methodReason: "The task needs recall.",
      scheduledFor,
      estimatedMinutes: 25,
      amountLabel: "25 minutes",
      learningMode: "study",
      status: "ready",
    }],
  };
}

function scheduleChange(): CalendarChangeLogEntry {
  return {
    id: "change",
    at: "2026-09-02T11:00:00.000Z",
    summary: "Moved retrieval Thu to Fri",
    reason: "You approved this move to avoid a crowded Thursday.",
    origin: "automatic",
    undoable: true,
    undoneAt: null,
    undo: {
      kind: "session_schedule",
      planId: "plan",
      planSessionId: "session",
      from: "2026-09-03T17:00:00.000Z",
      to: "2026-09-04T17:00:00.000Z",
    },
  };
}

describe("calendar change undo metadata", () => {
  it("offers a schedule undo only while the authoritative session still matches", () => {
    const entry = scheduleChange();
    const state = emptyCalendarPrototypeState("account", NOW);
    expect(calendarChangeUndoEligibility(entry, { state, plans: [schedulePlan()], now: NOW }).canUndo).toBe(true);
    expect(calendarUndoCommand(entry, { state, plans: [schedulePlan()], now: NOW })).toEqual({
      kind: "reschedule_session",
      planId: "plan",
      planSessionId: "session",
      scheduledFor: "2026-09-03T17:00:00.000Z",
    });
    expect(calendarChangeUndoEligibility(entry, {
      state,
      plans: [schedulePlan("2026-09-05T17:00:00.000Z")],
      now: NOW,
    }).canUndo).toBe(false);
  });

  it("will not restore a schedule to a time that has passed", () => {
    const entry = scheduleChange();
    expect(calendarChangeUndoEligibility(entry, {
      state: emptyCalendarPrototypeState("account", NOW),
      plans: [schedulePlan()],
      now: new Date("2026-09-03T18:00:00.000Z"),
    })).toMatchObject({ canUndo: false, reason: "The previous time has already passed." });
  });

  it("builds a local restore only when a manual event has not changed again", () => {
    const event: ManualCalendarEvent = {
      id: "manual",
      title: "Speech rehearsal",
      eventType: "personal",
      startsAt: "2026-09-04T15:00:00.000Z",
      endsAt: "2026-09-04T16:00:00.000Z",
      dueAt: null,
      fixed: false,
      done: false,
      courseId: null,
      courseLabel: "Public Speaking",
      outcomeId: null,
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    };
    const state = { ...emptyCalendarPrototypeState("account", NOW), manualEvents: [event] };
    const entry: CalendarChangeLogEntry = {
      id: "manual-change",
      at: NOW.toISOString(),
      summary: "Added speech rehearsal",
      reason: "You added this rehearsal to your calendar.",
      origin: "manual",
      undoable: true,
      undoneAt: null,
      undo: { kind: "manual_event", eventId: event.id, before: null, after: event },
    };

    expect(calendarUndoCommand(entry, { state, plans: [], now: NOW })).toEqual({
      kind: "restore_manual_event",
      eventId: "manual",
      value: null,
    });
    expect(markCalendarChangeUndone({ ...state, changeLog: [entry] }, entry.id, NOW).changeLog[0]?.undoneAt).toBe(NOW.toISOString());
  });
});
