import { describe, expect, it } from "vitest";
import { studyDayWindowForInstant } from "@/lib/scheduling/study-window";

describe("learner-local study windows", () => {
  it.each([
    ["2026-08-23T05:00:00.000Z", "morning"],
    ["2026-08-23T11:59:00.000Z", "morning"],
    ["2026-08-23T12:00:00.000Z", "afternoon"],
    ["2026-08-23T16:59:00.000Z", "afternoon"],
    ["2026-08-23T17:00:00.000Z", "evening"],
    ["2026-08-23T21:59:00.000Z", "evening"],
    ["2026-08-23T22:00:00.000Z", "late_night"],
    ["2026-08-23T04:59:00.000Z", "late_night"],
  ] as const)("maps %s to %s at UTC", (instant, expected) => {
    expect(studyDayWindowForInstant(instant, "UTC")).toBe(expected);
  });

  it("uses the learner's time zone instead of server-local time", () => {
    const instant = "2026-08-23T15:00:00.000Z";
    expect(studyDayWindowForInstant(instant, "America/Los_Angeles")).toBe("morning");
    expect(studyDayWindowForInstant(instant, "Europe/London")).toBe("afternoon");
  });

  it("rejects invalid instants and deterministically falls back to UTC for an invalid zone", () => {
    expect(studyDayWindowForInstant("not-a-date", "UTC")).toBeNull();
    expect(studyDayWindowForInstant("2026-08-23T15:00:00.000Z", "Not/AZone"))
      .toBe("afternoon");
  });
});
