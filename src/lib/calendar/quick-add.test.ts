import { describe, expect, it } from "vitest";
import { parseCalendarQuickAdd } from "@/lib/calendar/quick-add";

describe("calendar quick add", () => {
  it("parses a deadline, duration, and tonight block into a confirmable draft", () => {
    const draft = parseCalendarQuickAdd(
      "stats pset due friday, 90 min tonight",
      { now: new Date("2026-09-02T10:00:00.000Z"), timeZone: "UTC" },
    );

    expect(draft).toMatchObject({
      title: "Stats Pset",
      eventType: "deadline",
      durationMinutes: 90,
      startsAt: "2026-09-02T19:00:00.000Z",
      endsAt: "2026-09-02T20:30:00.000Z",
      courseLabel: "Stats",
      fixed: false,
      needsConfirmation: true,
    });
    expect(draft?.dueAt).toBe("2026-09-04T23:59:59.999Z");
  });

  it("treats a duration tomorrow as a work block without inventing a deadline", () => {
    const draft = parseCalendarQuickAdd(
      "Review IR cases tomorrow for 45 minutes",
      { now: new Date("2026-09-02T10:00:00.000Z"), timeZone: "UTC" },
    );

    expect(draft).toMatchObject({
      title: "Review IR Cases",
      dueAt: null,
      durationMinutes: 45,
      startsAt: "2026-09-03T17:00:00.000Z",
      endsAt: "2026-09-03T17:45:00.000Z",
    });
  });

  it("keeps classes fixed and honors an explicit local clock", () => {
    const draft = parseCalendarQuickAdd(
      "Chem seminar tomorrow at 2pm for 1 hour",
      { now: new Date("2026-09-02T10:00:00.000Z"), timeZone: "UTC" },
    );

    expect(draft).toMatchObject({
      eventType: "class",
      fixed: true,
      durationMinutes: 60,
      startsAt: "2026-09-03T14:00:00.000Z",
      endsAt: "2026-09-03T15:00:00.000Z",
    });
  });

  it("returns null for empty input and falls back safely from an invalid time zone", () => {
    expect(parseCalendarQuickAdd("   ")).toBeNull();
    expect(parseCalendarQuickAdd("Study tonight", {
      now: new Date("2026-09-02T10:00:00.000Z"),
      timeZone: "not/a-zone",
    })?.startsAt).toBe("2026-09-02T19:00:00.000Z");
  });
});
