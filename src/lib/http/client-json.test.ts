import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchClientJson, readClientStateBeforeDeadline } from "@/lib/http/client-json";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("fetchClientJson", () => {
  it("returns parsed JSON with the original response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ ok: true })));

    const result = await fetchClientJson("/api/example", {}, requestOptions());

    expect(result.response.ok).toBe(true);
    expect(result.body).toEqual({ ok: true });
  });

  it("keeps an invalid error response nullable so callers use safe fallback copy", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("gateway timeout", {
      status: 504,
      headers: { "Content-Type": "text/html" },
    })));

    const result = await fetchClientJson("/api/example", {}, requestOptions());

    expect(result.response.status).toBe(504);
    expect(result.body).toBeNull();
  });

  it("rejects a successful response that is not valid JSON", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not json", { status: 200 })));

    await expect(fetchClientJson("/api/example", {}, requestOptions())).rejects.toThrow(
      "YOVA received an invalid response.",
    );
  });

  it("aborts a request that exceeds its client deadline", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((_input: RequestInfo | URL, init?: RequestInit) => (
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      })
    )));

    const pending = fetchClientJson("/api/example", {}, requestOptions({ timeoutMs: 100 }));
    const assertion = expect(pending).rejects.toThrow("YOVA took too long to respond.");
    await vi.advanceTimersByTimeAsync(100);
    await assertion;
  });
});

function requestOptions(overrides: Partial<Parameters<typeof fetchClientJson>[2]> = {}) {
  return {
    timeoutMs: 1_000,
    timeoutMessage: "YOVA took too long to respond.",
    invalidResponseMessage: "YOVA received an invalid response.",
    ...overrides,
  };
}

describe("bounded mutation recovery reads", () => {
  it("returns a timely snapshot and clears the deadline", async () => {
    vi.useFakeTimers();
    await expect(readClientStateBeforeDeadline(async () => ({ id: "saved-plan" }), 100))
      .resolves.toEqual({ id: "saved-plan" });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("releases the caller when recovery stalls and ignores a late snapshot", async () => {
    vi.useFakeTimers();
    let finishRead!: (value: string) => void;
    const read = new Promise<string>((resolve) => { finishRead = resolve; });
    const applied: Array<string | null> = [];
    const pending = readClientStateBeforeDeadline(() => read, 100)
      .then((value) => { applied.push(value); });
    await vi.advanceTimersByTimeAsync(100);
    await pending;
    expect(applied).toEqual([null]);
    finishRead("late-plan");
    await vi.advanceTimersByTimeAsync(1);
    expect(applied).toEqual([null]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("preserves a read error and clears the deadline", async () => {
    vi.useFakeTimers();
    await expect(readClientStateBeforeDeadline(async () => {
      throw new Error("Offline");
    }, 100)).rejects.toThrow("Offline");
    expect(vi.getTimerCount()).toBe(0);
  });
});
