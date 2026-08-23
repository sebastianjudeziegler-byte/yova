import { afterEach, describe, expect, it, vi } from "vitest";

const scheduleAfterResponse = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({
  after: (callback: () => Promise<void>) => scheduleAfterResponse(callback),
}));

import { recordGenerationObservationAfterResponse } from "@/lib/analytics/generation-observation-server";

const observation = {
  generationType: "session" as const,
  environment: "production" as const,
  finalOutcome: "failure" as const,
  firstAttemptPassed: false,
  failedValidator: "session_practice_variation" as const,
  repairAttempted: true,
  repairSucceeded: false,
  elapsedMs: 21_400,
  attempts: 2,
  inputTokens: 100,
  cachedInputTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: 100,
  model: "gpt-yova-test",
};

describe("after-response generation observations", () => {
  afterEach(() => {
    vi.useRealTimers();
    scheduleAfterResponse.mockReset();
  });

  it("registers the durable insert with the serverless after-response boundary", async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const supabase = { from: vi.fn(() => ({ insert })) };

    recordGenerationObservationAfterResponse(supabase as never, crypto.randomUUID(), observation);

    expect(scheduleAfterResponse).toHaveBeenCalledTimes(1);
    await scheduleAfterResponse.mock.calls[0]![0]();
    expect(supabase.from).toHaveBeenCalledWith("product_events");
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      event_name: "generation_observed",
      event_data: observation,
    }));
  });

  it("bounds a lost database receipt without delaying the learner response", async () => {
    vi.useFakeTimers();
    const supabase = {
      from: vi.fn(() => ({ insert: vi.fn(() => new Promise(() => undefined)) })),
    };

    recordGenerationObservationAfterResponse(supabase as never, crypto.randomUUID(), observation);
    const delivery = scheduleAfterResponse.mock.calls[0]![0]();
    await vi.advanceTimersByTimeAsync(2_000);

    await expect(delivery).resolves.toBeUndefined();
  });

  it("never lets an unavailable request context replace the route response", () => {
    scheduleAfterResponse.mockImplementationOnce(() => {
      throw new Error("no request context");
    });

    expect(() => recordGenerationObservationAfterResponse(
      null,
      crypto.randomUUID(),
      observation,
    )).not.toThrow();
  });
});
