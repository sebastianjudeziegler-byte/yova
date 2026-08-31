import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createStreamedLessonAttempt,
  streamedLessonAttemptHeaders,
  StreamedLessonDeadlineError,
  withinStreamedLessonDeadline,
} from "@/lib/session-generation/lesson-transport";

describe("streamed lesson browser transport", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("mints a fresh operation id for Retry while keeping one attempt header stable", () => {
    const create = vi.fn()
      .mockReturnValueOnce("11111111-1111-4111-8111-111111111111")
      .mockReturnValueOnce("22222222-2222-4222-8222-222222222222");
    const first = createStreamedLessonAttempt({ create });
    const retry = createStreamedLessonAttempt({ create });

    expect(first.operationId).toBe("11111111-1111-4111-8111-111111111111");
    expect(retry.operationId).toBe("22222222-2222-4222-8222-222222222222");
    expect(retry.operationId).not.toBe(first.operationId);
    expect(streamedLessonAttemptHeaders(first)).toEqual({
      "X-Yova-Request-Id": first.operationId,
    });
    expect(streamedLessonAttemptHeaders(first)["X-Yova-Request-Id"]).toBe(first.operationId);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("enforces one absolute deadline even when the transport does not settle after abort", async () => {
    vi.useFakeTimers();
    const observed: { signal?: AbortSignal } = {};
    const request = withinStreamedLessonDeadline({
      timeoutMs: 75,
      run: async (signal) => {
        observed.signal = signal;
        return await new Promise<never>(() => undefined);
      },
    });
    const rejection = expect(request).rejects.toBeInstanceOf(StreamedLessonDeadlineError);

    await vi.advanceTimersByTimeAsync(75);

    await rejection;
    expect(observed.signal?.aborted).toBe(true);
  });

  it("keeps navigation aborts distinct from deadline failures and clears its timer", async () => {
    vi.useFakeTimers();
    const externalController = new AbortController();
    const request = withinStreamedLessonDeadline({
      signal: externalController.signal,
      timeoutMs: 75,
      run: async () => await new Promise<never>(() => undefined),
    });
    const rejection = expect(request).rejects.toMatchObject({ name: "AbortError" });

    externalController.abort();

    await rejection;
    expect(vi.getTimerCount()).toBe(0);
  });
});
