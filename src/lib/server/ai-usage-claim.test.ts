import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  AIUsageGateError,
  claimAIRequest,
  releaseAIRequestClaim,
} from "@/lib/server/ai-usage";

describe("refundable AI usage claims", () => {
  const rpc = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("AUTH_PASSWORD_ACCOUNTS", "true");
    vi.stubEnv("AUTH_INVITE_ONLY", "false");
  });

  it("returns the private claim id for an allowed reservation", async () => {
    rpc.mockResolvedValue({
      data: {
        allowed: true,
        claimId: "11111111-1111-4111-8111-111111111111",
        retryAfterSeconds: 0,
        remainingToday: 9,
      },
      error: null,
    });

    await expect(claimAIRequest({ rpc } as never, "session_generation")).resolves.toEqual({
      allowed: true,
      claimId: "11111111-1111-4111-8111-111111111111",
      retryAfterSeconds: 0,
      remainingToday: 9,
    });
  });

  it("keeps generation available while the refundable-claim migration rolls out", async () => {
    rpc.mockResolvedValue({
      data: {
        allowed: true,
        retryAfterSeconds: 0,
        remainingToday: 9,
      },
      error: null,
    });

    await expect(claimAIRequest({ rpc } as never, "session_generation")).resolves.toEqual({
      allowed: true,
      retryAfterSeconds: 0,
      remainingToday: 9,
    });
  });

  it("does not invent a claim when the allowance is exhausted", async () => {
    rpc.mockResolvedValue({
      data: {
        allowed: false,
        claimId: null,
        retryAfterSeconds: 3_600,
        remainingToday: 0,
      },
      error: null,
    });

    await expect(claimAIRequest({ rpc } as never, "session_generation")).resolves.toMatchObject({
      allowed: false,
      claimId: null,
    });
  });

  it("releases only the exact validated claim", async () => {
    rpc.mockResolvedValue({ data: true, error: null });

    await expect(releaseAIRequestClaim(
      { rpc } as never,
      "11111111-1111-4111-8111-111111111111",
    )).resolves.toBe(true);
    expect(rpc).toHaveBeenCalledWith("release_ai_request_claim", {
      usage_claim_id: "11111111-1111-4111-8111-111111111111",
    });
  });

  it("fails closed on malformed ids or database responses", async () => {
    await expect(releaseAIRequestClaim({ rpc } as never, "not-a-uuid"))
      .rejects.toBeInstanceOf(AIUsageGateError);
    expect(rpc).not.toHaveBeenCalled();

    rpc.mockResolvedValue({ data: null, error: null });
    await expect(releaseAIRequestClaim(
      { rpc } as never,
      "11111111-1111-4111-8111-111111111111",
    )).rejects.toBeInstanceOf(AIUsageGateError);
  });
});
