import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { retrySupabaseRpc } from "@/lib/supabase/retry-rpc";

describe("retrySupabaseRpc", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("returns immediately after a successful RPC", async () => {
    const operation = vi.fn().mockResolvedValue({ data: ["claim"], error: null, status: 200 });

    await expect(retrySupabaseRpc("claim_jobs", operation)).resolves.toEqual({
      data: ["claim"],
      error: null,
      status: 200,
    });
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("recovers from one transient API-gateway rejection", async () => {
    const operation = vi.fn()
      .mockResolvedValueOnce({ data: null, error: { code: "PGRST301" }, status: 401 })
      .mockResolvedValueOnce({ data: [], error: null, status: 200 });

    const pending = retrySupabaseRpc("claim_jobs", operation);
    await vi.runAllTimersAsync();

    await expect(pending).resolves.toEqual({ data: [], error: null, status: 200 });
    expect(operation).toHaveBeenCalledTimes(2);
    expect(console.warn).toHaveBeenCalledWith("Supabase maintenance RPC failed", {
      operation: "claim_jobs",
      attempt: 1,
      status: 401,
      code: "PGRST301",
      willRetry: true,
    });
  });

  it("fails closed after two failures without logging private messages", async () => {
    const operation = vi.fn()
      .mockRejectedValueOnce(new Error("private upstream detail"))
      .mockResolvedValueOnce({
        data: null,
        error: { code: "invalid code with spaces", message: "private response" },
        status: 503,
      });

    const pending = retrySupabaseRpc("claim_jobs", operation);
    await vi.runAllTimersAsync();
    const result = await pending;

    expect(result.data).toBeNull();
    expect(result.error).toBeTruthy();
    expect(operation).toHaveBeenCalledTimes(2);
    const serializedLogs = JSON.stringify(vi.mocked(console.warn).mock.calls);
    expect(serializedLogs).not.toContain("private upstream detail");
    expect(serializedLogs).not.toContain("private response");
    expect(serializedLogs).not.toContain("invalid code with spaces");
  });
});
