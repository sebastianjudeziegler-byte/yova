import { afterEach, beforeEach, expect, vi } from "vitest";
// This existing route fixture asserts an entire future availability window.
// Keep the audit independent of the wall-clock hour without changing its assertions.
const isPlanRoute = () => expect.getState().testPath?.endsWith("/api/plans/generate/route.test.ts");
beforeEach(() => {
  if (isPlanRoute()) {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-07T08:00:00.000Z"));
  }
});
afterEach(() => { if (isPlanRoute()) vi.useRealTimers(); });
