import { describe, expect, it } from "vitest";
import { emptyCalendarPrototypeState, mergeCalendarChanges } from "@/lib/calendar/persistence";
import { parseCalendarQuickAdd } from "@/lib/calendar/quick-add";
import { calendarDateAtTime, inferDeadlineDueAt } from "@/lib/intake/deadline";
import { layoutCalendarDay } from "@/lib/calendar/layout";
import { deriveCalendarModel } from "@/lib/calendar/model";
import { buildDailyCapacityPlan } from "@/lib/scheduling/agenda-insights";
import type { ManualCalendarEvent, CalendarBlock } from "@/lib/calendar/types";
import type { LearningPlan } from "@/lib/domain";

const now = new Date("2026-09-02T10:00:00Z");
function event(id: string, overrides: Partial<ManualCalendarEvent> = {}): ManualCalendarEvent {
  return { id, title: id, eventType: "personal", startsAt: "2026-09-03T14:00:00Z", endsAt: "2026-09-03T15:00:00Z", fixed: false, dueAt: null, done: false, courseId: null, courseLabel: null, outcomeId: null, createdAt: now.toISOString(), updatedAt: now.toISOString(), ...overrides };
}
function model(events: ManualCalendarEvent[], plans: LearningPlan[] = []) {
  const localState = { ...emptyCalendarPrototypeState("learner", now), manualEvents: events };
  return deriveCalendarModel({ localState, plans, milestones: [], completions: [], interruptions: [], now, timeZone: "UTC" });
}

describe("calendar edit concurrency", () => {
  it("merges unrelated additions, deletions and UI changes without resurrecting events", () => {
    const base = { ...emptyCalendarPrototypeState("learner", now), manualEvents: [event("old")] };
    const first = { ...base, manualEvents: [event("first")] };
    const other = { ...base, manualEvents: [...base.manualEvents, event("second")] };
    const merged = mergeCalendarChanges(base, other, first);
    expect(merged.manualEvents.map((item) => item.id)).toEqual(["first", "second"]);
    const uiEdit = { ...base, ui: { ...base.ui, view: "list" as const } };
    expect(mergeCalendarChanges(base, uiEdit, merged).manualEvents).toEqual(merged.manualEvents);
  });
  it("rejects stale edits and stale deletes on the same event", () => {
    const base = { ...emptyCalendarPrototypeState("learner", now), manualEvents: [event("one")] };
    const first = { ...base, manualEvents: [event("one", { title: "First edit" })] };
    const second = { ...base, manualEvents: [event("one", { title: "Second edit" })] };
    expect(() => mergeCalendarChanges(base, second, first)).toThrow("changed in another tab");
    expect(() => mergeCalendarChanges(base, { ...base, manualEvents: [] }, first)).toThrow("changed in another tab");
    expect(() => mergeCalendarChanges(base, second, { ...first, accountId: "different" })).toThrow("account changed");
  });
});

describe("shared calendar date interpretation", () => {
  const options = { now, timeZone: "Europe/London" };
  it.each([
    ["Chemistry class Friday at 2pm for 60 minutes", "2026-09-04T13:00:00.000Z"],
    ["Meet tutor next Monday at 10am", "2026-09-07T09:00:00.000Z"],
    ["Review biology September 10 at 6pm for 45 minutes", "2026-09-10T17:00:00.000Z"],
    ["Review biology 2026-10-26 at 6pm", "2026-10-26T18:00:00.000Z"],
  ])("keeps %s on its intended date", (text, expected) => {
    expect(parseCalendarQuickAdd(text, options)?.startsAt).toBe(expected);
  });
  it("keeps the deadline clock separate from a later preparation clock", () => {
    const text = "Biology exam due Friday at 2pm, study tomorrow at 6pm for 45 minutes";
    expect(inferDeadlineDueAt(text, options)).toBe("2026-09-04T13:00:00.000Z");
    expect(parseCalendarQuickAdd(text, options)?.startsAt).toBe("2026-09-03T17:00:00.000Z");
    expect(parseCalendarQuickAdd("History essay due Friday", options)?.startsAt).toBeNull();
  });
  it("does not turn unsupported dates, past clock times or DST gaps into another time", () => {
    expect(parseCalendarQuickAdd("Meet tutor next week at 2pm", options)?.startsAt).toBeNull();
    expect(parseCalendarQuickAdd("Class today at 9am", options)?.startsAt).toBeNull();
    expect(calendarDateAtTime("2026-03-29", 1, 30, "Europe/London")).toBeNull();
    expect(calendarDateAtTime("2026-10-25", 2, 30, "Europe/London")).toBe("2026-10-25T02:30:00.000Z");
  });
});

describe("calendar occupancy and display", () => {
  it("assigns distinct lanes to overlapping events and reuses lanes after the group ends", () => {
    const blocks = model([event("a"), event("b"), event("c", { startsAt: "2026-09-03T16:00:00Z", endsAt: "2026-09-03T17:00:00Z" })]).blocks;
    const day = new Date(blocks[0].startsAt);
    const segments = layoutCalendarDay(blocks, day);
    expect(segments.slice(0, 2).map((part) => [part.lane, part.laneCount])).toEqual([[0, 2], [1, 2]]);
    expect(segments[2].laneCount).toBe(1);
  });
  it("excludes deadlines, free time and completed work from collisions and flexible load", () => {
    const derived = model([
      event("deadline", { eventType: "deadline", dueAt: "2026-09-03T14:00:00Z", deadlineOnly: true }),
      event("free", { eventType: "free_block" }), event("finished", { done: true }), event("work"),
    ]);
    expect(derived.issues.filter((issue) => issue.kind === "fixed_event_conflict")).toEqual([]);
    expect(derived.dayLoads.find((day) => day.dateKey === "2026-09-03")?.plannedMinutes).toBe(60);
  });
  it("clips an overnight event on both sides of local midnight", () => {
    const start = new Date(2026, 8, 3, 23, 30); const end = new Date(2026, 8, 4, 1, 30);
    const blocks = model([event("night", { startsAt: start.toISOString(), endsAt: end.toISOString() })]).blocks;
    expect(layoutCalendarDay(blocks, start)[0]).toMatchObject({ startMinute: 1410, endMinute: 1440, continuesAfter: true });
    expect(layoutCalendarDay(blocks, end)[0]).toMatchObject({ startMinute: 0, endMinute: 90, continuesBefore: true });
  });
  it("counts overnight workload on each actual day, including a daylight-saving change", () => {
    const localState = { ...emptyCalendarPrototypeState("learner", now), manualEvents: [event("overnight", { startsAt: "2026-10-24T22:30:00Z", endsAt: "2026-10-25T02:30:00Z" })] };
    const derived = deriveCalendarModel({ localState, plans: [], milestones: [], completions: [], interruptions: [], now, timeZone: "Europe/London" });
    expect(derived.dayLoads.map((day) => [day.dateKey, day.plannedMinutes])).toEqual([["2026-10-24", 30], ["2026-10-25", 210]]);
  });
});

describe("calendar-aware adjustment planning", () => {
  const source = new Date(2026, 8, 2, 18).toISOString();
  const reference = new Date(2026, 8, 2, 11);
  const plan: LearningPlan = { id: "plan", learningItemId: "goal", title: "History", topic: "History", status: "active", kind: "test", deadline: new Date(2026, 8, 8, 18).toISOString(), sourceMode: "yova_generated", studyMode: "inside_yova", learningIntent: "study", rationale: "Preparation", createdAt: now.toISOString(), sessions: [{ id: "session", sequence: 1, title: "Review", objective: "Recall", method: "Retrieval", methodReason: "Practice", scheduledFor: source, estimatedMinutes: 40, amountLabel: "40 minutes", learningMode: "study", status: "ready" }] };
  it("preserves zero capacity and avoids both unavailable days and fixed commitments", () => {
    const blocks = model([event("class", { eventType: "class", fixed: true, startsAt: new Date(2026, 8, 4, 18).toISOString(), endsAt: new Date(2026, 8, 4, 19).toISOString() })], [plan]).blocks;
    const result = buildDailyCapacityPlan([{ plan, session: plan.sessions[0] }], 0, reference, new Set(), "today", { blocks, availabilityOverrides: [{ dateKey: "2026-09-03", availableMinutes: 0, reason: "No study time", updatedAt: now.toISOString() }], timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone });
    expect(result).toMatchObject({ status: "move", capacityMinutes: 0, projectedMinutes: 0, toDateKey: "2026-09-05" });
  });
  it("counts manual work and never describes it as an empty day", () => {
    const blocks: CalendarBlock[] = model([event("essay", { startsAt: source, endsAt: new Date(Date.parse(source) + 90 * 60_000).toISOString() })]).blocks;
    const result = buildDailyCapacityPlan([], 30, reference, new Set(), "today", { blocks, availabilityOverrides: [], timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone });
    expect(result).toMatchObject({ status: "blocked", todayMinutes: 90, projectedMinutes: 90 });
    expect(result.reason).toContain("manual commitments");
  });
});
