import { describe, expect, it } from "vitest";
import { customScheduleIssue } from "@/lib/scheduling/custom-time";

const now = new Date("2026-08-21T12:00:30.000Z");

describe("custom agenda time validation", () => {
  it("rejects a past time", () => {
    expect(customScheduleIssue(
      "2026-08-22T12:00:00.000Z",
      "2026-08-21T11:59:00.000Z",
      now,
    )).toBe("Choose a future date and time.");
  });

  it("rejects an unchanged minute even if seconds differ", () => {
    expect(customScheduleIssue(
      "2026-08-22T12:00:45.000Z",
      "2026-08-22T12:00:00.000Z",
      now,
    )).toBe("Choose a different date or time before saving.");
  });

  it("allows a distinct future minute", () => {
    expect(customScheduleIssue(
      "2026-08-22T12:00:00.000Z",
      "2026-08-22T12:01:00.000Z",
      now,
    )).toBeNull();
  });
});
