import { afterEach, describe, expect, it, vi } from "vitest";
import { requestComparison, SHAPE_SLOT_CLIENT_TIMEOUT_MS } from "./slots-client";
import type { CompareRequest } from "./slots-schema";

const request = { action: "compare", produced: "A saved answer." } as CompareRequest;
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("comparison transport recovery", () => {
  it("turns a stalled transport into a retryable error instead of a permanent spinner", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((_url: string, options: RequestInit) => new Promise((_resolve, reject) => options.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError"))))));
    const response = requestComparison(request);
    const assertion = expect(response).rejects.toMatchObject({ code: "timeout", status: 408, message: expect.stringContaining("Your work remains on screen") });
    await vi.advanceTimersByTimeAsync(SHAPE_SLOT_CLIENT_TIMEOUT_MS);
    await assertion;
    expect(vi.getTimerCount()).toBe(0);
  });
  it("preserves cancellation on exit and clears the request deadline", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((_url: string, options: RequestInit) => new Promise((_resolve, reject) => options.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError"))))));
    const controller = new AbortController();
    const response = requestComparison(request, controller.signal);
    const assertion = expect(response).rejects.toMatchObject({ name: "AbortError" });
    controller.abort(); await assertion;
    expect(vi.getTimerCount()).toBe(0);
  });
});
