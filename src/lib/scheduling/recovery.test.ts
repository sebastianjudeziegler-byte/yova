import { describe, expect, it } from "vitest";
import {
  isSessionOverdue,
  recoverySessionMinutes,
  tomorrowAtSessionTime,
} from "@/lib/scheduling/recovery";

describe("missed-session recovery", () => {
  const now = new Date("2026-08-05T20:00:00.000Z");

  it("waits through a short grace period before calling a session overdue", () => {
    expect(isSessionOverdue("2026-08-05T19:20:00.000Z", now)).toBe(true);
    expect(isSessionOverdue("2026-08-05T19:45:00.000Z", now)).toBe(false);
    expect(isSessionOverdue("not-a-date", now)).toBe(false);
  });

  it("turns longer work into a bounded recovery session", () => {
    expect(recoverySessionMinutes(60)).toBe(20);
    expect(recoverySessionMinutes(30)).toBe(15);
    expect(recoverySessionMinutes(15)).toBe(10);
  });

  it("moves an old session to tomorrow while keeping its local clock time", () => {
    const moved = new Date(tomorrowAtSessionTime("2026-08-02T16:30:00.000Z", now));
    expect(moved.getUTCDate()).toBe(6);
    expect(moved.getUTCHours()).toBe(16);
    expect(moved.getUTCMinutes()).toBe(30);
  });
});
