import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { AIUsageGateError, readAIUsageStatus } from "@/lib/server/ai-usage";

describe("readAIUsageStatus", () => {
  const rpc = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("AUTH_PASSWORD_ACCOUNTS", "true");
    vi.stubEnv("AUTH_INVITE_ONLY", "false");
  });

  it("uses the current server policy and does not call the claiming RPC", async () => {
    rpc.mockResolvedValue({
      data: {
        allowed: false,
        limitedBy: "day",
        remainingToday: 0,
        retryAfterSeconds: 7_200,
        resetAt: "2026-08-20T00:00:00+00:00",
      },
      error: null,
    });

    await expect(readAIUsageStatus({ rpc } as never, "session_generation")).resolves.toEqual({
      allowed: false,
      limitedBy: "day",
      remainingToday: 0,
      retryAfterSeconds: 7_200,
      resetAt: "2026-08-20T00:00:00.000Z",
    });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("read_ai_usage_status", {
      request_action: "session_generation",
      minute_limit: 5,
      day_limit: 10,
    });
    expect(rpc).not.toHaveBeenCalledWith("claim_ai_request", expect.anything());
  });

  it("fails closed on an invalid or unavailable database response", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "unavailable" } });
    await expect(readAIUsageStatus({ rpc } as never, "session_generation")).rejects.toBeInstanceOf(AIUsageGateError);

    rpc.mockResolvedValueOnce({
      data: {
        allowed: false,
        limitedBy: "day",
        remainingToday: 4,
        retryAfterSeconds: 60,
        resetAt: "not-a-date",
      },
      error: null,
    });
    await expect(readAIUsageStatus({ rpc } as never, "session_generation")).rejects.toBeInstanceOf(AIUsageGateError);
  });
});
