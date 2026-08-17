import { describe, expect, it } from "vitest";
import {
  createActiveSessionClock,
  pauseActiveSessionClock,
  readActiveSessionSeconds,
  resumeActiveSessionClock,
} from "@/lib/learning/active-session-clock";

describe("active session clock", () => {
  it("starts visible sessions immediately and keeps restored elapsed time", () => {
    const clock = createActiveSessionClock(12.9, 1_000.8, true);

    expect(clock).toEqual({
      accumulatedSeconds: 12,
      activeSince: 1_000,
    });
    expect(readActiveSessionSeconds(clock, 4_900)).toBe(15);
  });

  it("starts hidden sessions paused", () => {
    const clock = createActiveSessionClock(12, 1_000, false);

    expect(clock).toEqual({
      accumulatedSeconds: 12,
      activeSince: null,
    });
    expect(readActiveSessionSeconds(clock, 50_000)).toBe(12);
  });

  it("pauses on hidden and excludes time spent in the background", () => {
    const started = createActiveSessionClock(0, 1_000, true);
    const hidden = pauseActiveSessionClock(started, 4_900);
    const visible = resumeActiveSessionClock(hidden, 104_900);

    expect(hidden).toEqual({ accumulatedSeconds: 3, activeSince: null });
    expect(readActiveSessionSeconds(hidden, 104_900)).toBe(3);
    expect(readActiveSessionSeconds(visible, 107_800)).toBe(5);
  });

  it("does not reset an already active clock on duplicate visible events", () => {
    const started = createActiveSessionClock(7, 1_000, true);
    const resumedAgain = resumeActiveSessionClock(started, 50_000);

    expect(resumedAgain).toEqual(started);
    expect(readActiveSessionSeconds(resumedAgain, 51_000)).toBe(57);
  });

  it("is idempotent when an already paused clock is paused again", () => {
    const paused = createActiveSessionClock(18, 1_000, false);

    expect(pauseActiveSessionClock(paused, 50_000)).toEqual(paused);
  });

  it("never subtracts time if the wall clock moves backward", () => {
    const started = createActiveSessionClock(18, 5_000, true);

    expect(readActiveSessionSeconds(started, 4_000)).toBe(18);
    expect(pauseActiveSessionClock(started, 4_000)).toEqual({
      accumulatedSeconds: 18,
      activeSince: null,
    });
  });

  it("normalizes invalid values and keeps every public result bounded to integers", () => {
    expect(createActiveSessionClock(-10, Number.NaN, true)).toEqual({
      accumulatedSeconds: 0,
      activeSince: null,
    });
    expect(createActiveSessionClock(Number.POSITIVE_INFINITY, 1_000, false)).toEqual({
      accumulatedSeconds: 21_600,
      activeSince: null,
    });

    const resumed = resumeActiveSessionClock({
      accumulatedSeconds: 2.9,
      activeSince: Number.NaN,
    }, 10_000.9);
    expect(resumed).toEqual({ accumulatedSeconds: 2, activeSince: 10_000 });
  });

  it("caps a runaway active interval at the persisted six-hour limit", () => {
    const clock = createActiveSessionClock(21_599, 1_000, true);

    expect(readActiveSessionSeconds(clock, 5_000)).toBe(21_600);
    expect(pauseActiveSessionClock(clock, Number.POSITIVE_INFINITY)).toEqual({
      accumulatedSeconds: 21_599,
      activeSince: null,
    });
  });
});
