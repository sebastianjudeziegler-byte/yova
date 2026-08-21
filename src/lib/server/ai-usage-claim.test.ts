import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  AIUsageGateError,
  aiUsageReservationConflict,
  claimAIRequest,
  releaseAIRequestClaim,
  releaseAIRequestReservation,
  reserveAIRequest,
  settleAIRequestClaim,
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

  it("uses the strict leased reservation RPC with a mandatory claim id", async () => {
    const operationKey = "22222222-2222-4222-8222-222222222222";
    const recoveryKey = "33333333-3333-4333-8333-333333333333";
    rpc.mockResolvedValue({
      data: {
        allowed: true,
        claimId: "11111111-1111-4111-8111-111111111111",
        operationKey,
        reservationState: "reserved",
        replayed: false,
        retryAfterSeconds: 0,
        remainingToday: 9,
      },
      error: null,
    });

    await expect(reserveAIRequest(
      { rpc } as never,
      "session_generation",
      operationKey,
      recoveryKey,
    )).resolves.toMatchObject({
      allowed: true,
      claimId: "11111111-1111-4111-8111-111111111111",
      operationKey,
    });
    expect(rpc).toHaveBeenCalledWith("reserve_ai_request", {
      request_action: "session_generation",
      minute_limit: expect.any(Number),
      day_limit: expect.any(Number),
      request_operation_key: operationKey,
      request_recovery_key: recoveryKey,
      lease_seconds: 180,
    });
  });

  it("rejects an allowed strict reservation without an exact claim id", async () => {
    rpc.mockResolvedValue({
      data: {
        allowed: true,
        operationKey: "22222222-2222-4222-8222-222222222222",
        reservationState: "reserved",
        replayed: false,
        retryAfterSeconds: 0,
        remainingToday: 9,
      },
      error: null,
    });

    await expect(reserveAIRequest(
      { rpc } as never,
      "session_generation",
      "22222222-2222-4222-8222-222222222222",
      "33333333-3333-4333-8333-333333333333",
    )).rejects.toBeInstanceOf(AIUsageGateError);
  });

  it("does not allow the browser-visible operation key to double as the recovery secret", async () => {
    const publicOperationKey = "22222222-2222-4222-8222-222222222222";

    await expect(reserveAIRequest(
      { rpc } as never,
      "session_generation",
      publicOperationKey,
      publicOperationKey,
    )).rejects.toBeInstanceOf(AIUsageGateError);
    await expect(releaseAIRequestReservation(
      { rpc } as never,
      "session_generation",
      publicOperationKey,
      publicOperationKey,
    )).rejects.toBeInstanceOf(AIUsageGateError);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("treats a live operation-key replay as retryable contention, not quota exhaustion", async () => {
    const operationKey = "22222222-2222-4222-8222-222222222222";
    const recoveryKey = "33333333-3333-4333-8333-333333333333";
    rpc.mockResolvedValue({
      data: {
        allowed: false,
        claimId: null,
        operationKey,
        denialReason: "operation_in_progress",
        retryAfterSeconds: 37,
        remainingToday: 9,
      },
      error: null,
    });

    const reservation = await reserveAIRequest(
      { rpc } as never,
      "session_generation",
      operationKey,
      recoveryKey,
    );
    expect(reservation.allowed).toBe(false);
    if (reservation.allowed) throw new Error("Expected a denied reservation.");
    expect(aiUsageReservationConflict(reservation)).toEqual({
      code: "ai_operation_in_progress",
      error: "This AI request is already being prepared.",
      retryable: true,
      retryAfterSeconds: 37,
    });
  });

  it("keeps terminal operation-key replays distinct from usage limits", () => {
    expect(aiUsageReservationConflict({
      allowed: false,
      denialReason: "operation_already_consumed",
      retryAfterSeconds: 0,
    })).toMatchObject({
      code: "ai_operation_already_consumed",
      retryable: false,
      retryAfterSeconds: null,
    });
  });

  it("settles one exact successful claim", async () => {
    rpc.mockResolvedValue({ data: true, error: null });

    await expect(settleAIRequestClaim(
      { rpc } as never,
      "11111111-1111-4111-8111-111111111111",
    )).resolves.toBe(true);
    expect(rpc).toHaveBeenCalledWith("consume_ai_request_claim", {
      usage_claim_id: "11111111-1111-4111-8111-111111111111",
    });
  });

  it("retries one ambiguous settlement receipt with the same idempotent claim", async () => {
    rpc
      .mockRejectedValueOnce(new Error("connection lost after commit"))
      .mockResolvedValueOnce({ data: true, error: null });

    await expect(settleAIRequestClaim(
      { rpc } as never,
      "11111111-1111-4111-8111-111111111111",
    )).resolves.toBe(true);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenNthCalledWith(1, "consume_ai_request_claim", {
      usage_claim_id: "11111111-1111-4111-8111-111111111111",
    });
    expect(rpc).toHaveBeenNthCalledWith(2, "consume_ai_request_claim", {
      usage_claim_id: "11111111-1111-4111-8111-111111111111",
    });
  });

  it("can release a committed reservation whose claim response was lost", async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    const operationKey = "22222222-2222-4222-8222-222222222222";
    const recoveryKey = "33333333-3333-4333-8333-333333333333";

    await expect(releaseAIRequestReservation(
      { rpc } as never,
      "session_generation",
      operationKey,
      recoveryKey,
    )).resolves.toBe(true);
    expect(rpc).toHaveBeenCalledWith("release_ai_request_reservation", {
      request_action: "session_generation",
      request_operation_key: operationKey,
      request_recovery_key: recoveryKey,
    });
  });

  it("bounds a never-resolving settlement receipt and retries only the exact claim", async () => {
    vi.useFakeTimers();
    try {
      rpc.mockImplementation(() => new Promise(() => undefined));
      const settlement = settleAIRequestClaim(
        { rpc } as never,
        "11111111-1111-4111-8111-111111111111",
      );
      const rejected = expect(settlement).rejects.toBeInstanceOf(AIUsageGateError);

      await vi.advanceTimersByTimeAsync(6_001);
      await rejected;
      expect(rpc).toHaveBeenCalledTimes(2);
      expect(rpc).toHaveBeenNthCalledWith(1, "consume_ai_request_claim", {
        usage_claim_id: "11111111-1111-4111-8111-111111111111",
      });
      expect(rpc).toHaveBeenNthCalledWith(2, "consume_ai_request_claim", {
        usage_claim_id: "11111111-1111-4111-8111-111111111111",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("bounds a never-resolving failure release to the lease recovery boundary", async () => {
    vi.useFakeTimers();
    try {
      rpc.mockImplementation(() => new Promise(() => undefined));
      const release = releaseAIRequestClaim(
        { rpc } as never,
        "11111111-1111-4111-8111-111111111111",
      );
      const rejected = expect(release).rejects.toBeInstanceOf(AIUsageGateError);

      await vi.advanceTimersByTimeAsync(3_001);
      await rejected;
      expect(rpc).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("bounds a never-resolving reservation receipt", async () => {
    vi.useFakeTimers();
    try {
      rpc.mockImplementation(() => new Promise(() => undefined));
      const reservation = reserveAIRequest(
        { rpc } as never,
        "session_generation",
        "22222222-2222-4222-8222-222222222222",
        "33333333-3333-4333-8333-333333333333",
      );
      const rejected = expect(reservation).rejects.toBeInstanceOf(AIUsageGateError);

      await vi.advanceTimersByTimeAsync(3_001);
      await rejected;
      expect(rpc).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("bounds a never-resolving unknown-reservation recovery", async () => {
    vi.useFakeTimers();
    try {
      rpc.mockImplementation(() => new Promise(() => undefined));
      const recovery = releaseAIRequestReservation(
        { rpc } as never,
        "session_generation",
        "22222222-2222-4222-8222-222222222222",
        "33333333-3333-4333-8333-333333333333",
      );
      const rejected = expect(recovery).rejects.toBeInstanceOf(AIUsageGateError);

      await vi.advanceTimersByTimeAsync(3_001);
      await rejected;
      expect(rpc).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
