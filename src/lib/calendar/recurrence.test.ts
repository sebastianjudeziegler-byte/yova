import { describe, expect, it } from "vitest";
import { parseCalendarQuickAdd } from "@/lib/calendar/quick-add";
import { hasRecurrenceIntent, readCalendarTimeRange } from "@/lib/calendar/recurrence-parser";
import { changeRecurringOccurrence, expandRecurringEvent, recurrenceDates } from "@/lib/calendar/recurrence";
import { CalendarRecurrenceSchema } from "@/lib/calendar/recurrence-schema";
import { CalendarPrototypeStateSchema, ManualCalendarEventSchema, type ManualCalendarEvent } from "@/lib/calendar/types";
import { emptyCalendarPrototypeState } from "@/lib/calendar/persistence";
import { deriveCalendarModel } from "@/lib/calendar/model";

const now = new Date("2026-09-02T10:00:00.000Z");
const options = { now, timeZone: "Europe/London" };
const description = "I have a class on communications from 11:30 to 12 every Monday and Wednesday";
function master(text = description): ManualCalendarEvent {
  const draft = parseCalendarQuickAdd(text, options)!;
  return ManualCalendarEventSchema.parse({ id: "communications", title: draft.title, eventType: draft.eventType, startsAt: draft.startsAt, endsAt: draft.endsAt, fixed: draft.fixed, recurrence: draft.recurrence, createdAt: now.toISOString(), updatedAt: now.toISOString() });
}

describe("natural-language recurring events", () => {
  it("understands the user's class example, including both weekdays and a half-hour time range", () => {
    expect(parseCalendarQuickAdd(description, options)).toMatchObject({ title: "Communications Class", eventType: "class", durationMinutes: 30, startsAt: "2026-09-02T10:30:00.000Z", endsAt: "2026-09-02T11:00:00.000Z", recurrence: { frequency: "weekly", interval: 1, weekdays: [1, 3], until: null, count: null, timeZone: "Europe/London" } });
  });
  it.each(["every two days", "every 2 days", "each two days"])("understands %s without creating a deadline", (repeat) => {
    expect(parseCalendarQuickAdd(`Review vocabulary ${repeat} starting tomorrow at 6pm for 20 minutes`, options)).toMatchObject({ title: "Review Vocabulary", startsAt: "2026-09-03T17:00:00.000Z", durationMinutes: 20, dueAt: null, recurrence: { frequency: "daily", interval: 2 } });
  });
  it("recognizes weekdays, alternate weeks and optional semester end dates", () => {
    expect(parseCalendarQuickAdd("Communications class every other week on Mon and Wed from 11:30 to 12 until December 18", options)).toMatchObject({ recurrence: { interval: 2, weekdays: [1, 3], until: "2026-12-18" } });
    expect(parseCalendarQuickAdd("Walk daily at 7am", options)?.recurrence?.frequency).toBe("daily");
    expect(parseCalendarQuickAdd("Seminar weekdays at 9am", options)?.recurrence?.weekdays).toEqual([1, 2, 3, 4, 5]);
    expect(parseCalendarQuickAdd("Seminar every Monday through Friday at 9am", options)?.recurrence?.weekdays).toEqual([1, 2, 3, 4, 5]);
  });
  it("requires a time or an explicit correction when the language cannot safely be scheduled", () => {
    expect(parseCalendarQuickAdd("Read notes every two days", options)?.startsAt).toBeNull();
    expect(parseCalendarQuickAdd("Class on the first Monday of every month at 11am", options)).toMatchObject({ recurrence: null, recurrenceNeedsReview: true, startsAt: null });
    expect(hasRecurrenceIntent("I have a biology test in two weeks")).toBe(false);
  });
  it.each([
    "Class every two days at 11am for 999999999999999999999 weeks",
    "Class every zero days at 11am", "Class every 0 days at 11am",
    "Class recurring at 11am", "Class every semester at 11am",
    "Class daily at 11am except holidays", "Class weekly at 11am starting next semester",
    "Class monthly at 11am", "Class yearly at 11am", "Class quarterly at 11am",
    "Class weekly at 11am starting next semester until December 18",
    "Class quarterly on Monday at 11am", "Class annually on Monday at 11am",
  ])("leaves unsupported or invalid language for review: %s", (text) => {
    expect(parseCalendarQuickAdd(text, options)).toMatchObject({ recurrence: null, recurrenceNeedsReview: true, startsAt: null });
  });
  it("does not mistake dates for clock ranges or miss the range after a date", () => {
    expect(readCalendarTimeRange("Class starting 2026-11-12 every Monday")).toBeNull();
    expect(parseCalendarQuickAdd("Class starting 2026-11-12 from 11:30 to 12 every Monday", options)).toMatchObject({ startsAt: "2026-11-16T11:30:00.000Z", durationMinutes: 30 });
  });
  it.each([
    ["from 11:30 to 12", 11, 30, 30], ["6 to 7pm", 18, 0, 60],
    ["11:30 to 12pm", 11, 30, 30], ["11pm to 1am", 23, 0, 120],
    ["14:00–15:30", 14, 0, 90],
  ])("interprets %s without confusing the two ends", (text, hour, minute, durationMinutes) => {
    expect(readCalendarTimeRange(text as string)).toMatchObject({ hour, minute, durationMinutes });
  });
});

describe("series storage and calendar projection", () => {
  it("stores one series and expands the correct dates far beyond an initial preview", () => {
    const event = master();
    const state = CalendarPrototypeStateSchema.parse({ ...emptyCalendarPrototypeState("learner"), manualEvents: [event] });
    expect(state.manualEvents).toHaveLength(1);
    const blocks = expandRecurringEvent(state.manualEvents[0], new Date("2028-09-04T00:00:00Z"), new Date("2028-09-11T00:00:00Z"));
    expect(blocks.map((b) => b.series?.dateKey)).toEqual(["2028-09-04", "2028-09-06"]);
    expect(new Set(blocks.map((b) => b.id)).size).toBe(2);
  });
  it("keeps the same local time across the autumn clock change", () => {
    const blocks = expandRecurringEvent(master(), new Date("2026-10-19T00:00:00Z"), new Date("2026-11-01T00:00:00Z"));
    expect(blocks.find((b) => b.series?.dateKey === "2026-10-21")?.startsAt).toBe("2026-10-21T10:30:00.000Z");
    expect(blocks.find((b) => b.series?.dateKey === "2026-10-26")?.startsAt).toBe("2026-10-26T11:30:00.000Z");
  });
  it("applies inclusive end dates, counts and alternating weeks", () => {
    const rule = master().recurrence!;
    expect(recurrenceDates({ ...rule, until: "2026-09-09" }, "2026-09-02", "2026-09-01", "2026-10-01")).toEqual(["2026-09-02", "2026-09-07", "2026-09-09"]);
    expect(recurrenceDates({ ...rule, count: 2 }, "2026-09-02", "2026-09-01", "2026-10-01")).toEqual(["2026-09-02", "2026-09-07"]);
    expect(recurrenceDates({ ...rule, interval: 2, count: 3 }, "2026-09-02", "2026-09-01", "2026-10-01")).toEqual(["2026-09-02", "2026-09-14", "2026-09-16"]);
  });
  it("moves, completes and deletes one occurrence without changing its neighbours", () => {
    const original = master();
    const from = new Date("2026-09-01T00:00:00Z"), to = new Date("2026-09-10T00:00:00Z");
    const blocks = expandRecurringEvent(original, from, to);
    const moved = changeRecurringOccurrence(blocks[0], { ...blocks[0].event, startsAt: "2026-09-20T13:00:00Z", endsAt: "2026-09-20T13:30:00Z", done: true });
    expect(ManualCalendarEventSchema.safeParse(moved).success).toBe(true);
    expect(expandRecurringEvent(moved, from, to).map((b) => b.series?.dateKey)).toEqual(["2026-09-07", "2026-09-09"]);
    const later = expandRecurringEvent(moved, new Date("2026-09-20T00:00:00Z"), new Date("2026-09-21T00:00:00Z"));
    expect(later).toHaveLength(1);
    expect(later[0]).toMatchObject({ id: blocks[0].id, done: true });
    const deleted = changeRecurringOccurrence(blocks[1], null);
    expect(expandRecurringEvent(deleted, from, to).map((b) => b.series?.dateKey)).toEqual(["2026-09-02", "2026-09-09"]);
    expect(expandRecurringEvent(original, from, to)).toHaveLength(3);
  });
  it("includes recurring commitments in the same workload and collision model as other events", () => {
    const event = master();
    const personal = { ...event, id: "meeting", recurrence: undefined, title: "Study group", eventType: "personal" as const };
    const localState = { ...emptyCalendarPrototypeState("learner"), manualEvents: [event, personal] };
    const model = deriveCalendarModel({ plans: [], milestones: [], localState, now, timeZone: "Europe/London", visibleRange: { start: new Date("2028-09-04T00:00:00Z"), end: new Date("2028-09-11T00:00:00Z") } });
    expect(model.issues.some((issue) => issue.title.includes("Communications Class conflicts with Study group"))).toBe(true);
    expect(model.dayLoads.find((day) => day.dateKey === "2028-09-04")?.fixedMinutes).toBe(30);
  });
  it("rejects duplicate repeat days and invalid time zones", () => {
    expect(CalendarRecurrenceSchema.safeParse({ ...master().recurrence, weekdays: [1, 1] }).success).toBe(false);
    expect(CalendarRecurrenceSchema.safeParse({ ...master().recurrence, timeZone: "invalid" }).success).toBe(false);
    expect(CalendarRecurrenceSchema.safeParse({ ...master().recurrence, until: "2026-02-30" }).success).toBe(false);
    expect(ManualCalendarEventSchema.safeParse({ ...master(), recurrence: { ...master().recurrence, until: "2026-09-01" } }).success).toBe(false);
    expect(recurrenceDates({ ...master().recurrence!, interval: 0 }, "2026-09-02", "2026-09-02", "2026-10-01")).toEqual([]);
  });
});
