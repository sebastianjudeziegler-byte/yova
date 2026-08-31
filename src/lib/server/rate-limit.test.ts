import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  checkStudyProfileWaitlistRateLimit,
  rateLimitRecordCountForTesting,
  resetRateLimitStateForTesting,
} from "@/lib/server/rate-limit";

describe("in-memory rate-limit lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-31T12:00:00.000Z"));
    resetRateLimitStateForTesting();
  });

  afterEach(() => {
    resetRateLimitStateForTesting();
    vi.useRealTimers();
  });

  it("opportunistically prunes expired varied keys", () => {
    for (let index = 0; index < 127; index += 1) {
      checkStudyProfileWaitlistRateLimit(`expired-${index}`);
    }
    expect(rateLimitRecordCountForTesting()).toBe(127);

    vi.advanceTimersByTime(60_001);
    checkStudyProfileWaitlistRateLimit("current");

    expect(rateLimitRecordCountForTesting()).toBe(1);
  });
});
