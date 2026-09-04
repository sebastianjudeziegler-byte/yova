import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  adminRpc: vi.fn(),
  createAdmin: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: mocks.createAdmin,
}));

import {
  AIUsageGateError,
  aiUsageReservationConflict,
  consumeAIRequestClaimAfterProviderFailure,
  refundAIRequestClaimBeforeProvider,
  refundAIRequestReservationBeforeProvider,
  reserveAIRequest,
  settleAIRequestClaim,
} from "@/lib/server/ai-usage";

const USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CLAIM_ID = "11111111-1111-4111-8111-111111111111";
const OPERATION_KEY = "22222222-2222-4222-8222-222222222222";
const RECOVERY_KEY = "33333333-3333-4333-8333-333333333333";

function authenticatedClient() {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: USER_ID } },
        error: null,
      }),
    },
    rpc: vi.fn(),
  };
}

describe("strict AI usage reservations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("AUTH_PASSWORD_ACCOUNTS", "true");
    vi.stubEnv("AUTH_INVITE_ONLY", "false");
    mocks.createAdmin.mockReturnValue({ rpc: mocks.adminRpc });
  });

  it("reserves through the service-only per-user RPC after verifying the user", async () => {
    const client = authenticatedClient();
    mocks.adminRpc.mockResolvedValue({
      data: {
        allowed: true,
        claimId: CLAIM_ID,
        operationKey: OPERATION_KEY,
        reservationState: "reserved",
        replayed: false,
        retryAfterSeconds: 0,
        remainingToday: 9,
      },
      error: null,
    });

    await expect(reserveAIRequest(
      client as never,
      "session_generation",
      OPERATION_KEY,
      RECOVERY_KEY,
    )).resolves.toMatchObject({
      allowed: true,
      claimId: CLAIM_ID,
      operationKey: OPERATION_KEY,
    });

    expect(client.auth.getUser).toHaveBeenCalledOnce();
    expect(mocks.adminRpc).toHaveBeenCalledWith("reserve_ai_request_for_user", {
      target_user_id: USER_ID,
      request_action: "session_generation",
      request_operation_key: OPERATION_KEY,
      request_recovery_key: RECOVERY_KEY,
      request_public_accounts: true,
    });
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("lets the database select the invite-only tier without caller limits", async () => {
    vi.stubEnv("AUTH_PASSWORD_ACCOUNTS", "false");
    const client = authenticatedClient();
    mocks.adminRpc.mockResolvedValue({
      data: {
        allowed: true,
        claimId: CLAIM_ID,
        operationKey: OPERATION_KEY,
        reservationState: "reserved",
        replayed: false,
        retryAfterSeconds: 0,
        remainingToday: 39,
      },
      error: null,
    });

    await reserveAIRequest(
      client as never,
      "session_generation",
      OPERATION_KEY,
      RECOVERY_KEY,
    );

    expect(mocks.adminRpc).toHaveBeenCalledWith("reserve_ai_request_for_user", {
      target_user_id: USER_ID,
      request_action: "session_generation",
      request_operation_key: OPERATION_KEY,
      request_recovery_key: RECOVERY_KEY,
      request_public_accounts: false,
    });
  });

  it("fails closed before the admin RPC for an unverifiable user", async () => {
    const client = authenticatedClient();
    client.auth.getUser.mockResolvedValue({
      data: { user: null },
      error: new Error("invalid token"),
    });

    await expect(reserveAIRequest(
      client as never,
      "session_generation",
      OPERATION_KEY,
      RECOVERY_KEY,
    )).rejects.toBeInstanceOf(AIUsageGateError);
    expect(mocks.createAdmin).not.toHaveBeenCalled();
    expect(mocks.adminRpc).not.toHaveBeenCalled();
  });

  it("fails closed when service-role access is not configured", async () => {
    const client = authenticatedClient();
    mocks.createAdmin.mockImplementation(() => {
      throw new Error("missing secret");
    });

    await expect(reserveAIRequest(
      client as never,
      "session_generation",
      OPERATION_KEY,
      RECOVERY_KEY,
    )).rejects.toBeInstanceOf(AIUsageGateError);
    expect(mocks.adminRpc).not.toHaveBeenCalled();
  });

  it("rejects an allowed reservation without an exact claim id", async () => {
    mocks.adminRpc.mockResolvedValue({
      data: {
        allowed: true,
        operationKey: OPERATION_KEY,
        reservationState: "reserved",
        replayed: false,
        retryAfterSeconds: 0,
        remainingToday: 9,
      },
      error: null,
    });

    await expect(reserveAIRequest(
      authenticatedClient() as never,
      "session_generation",
      OPERATION_KEY,
      RECOVERY_KEY,
    )).rejects.toBeInstanceOf(AIUsageGateError);
  });

  it("does not allow the operation key to double as the recovery secret", async () => {
    const client = authenticatedClient();

    await expect(reserveAIRequest(
      client as never,
      "session_generation",
      OPERATION_KEY,
      OPERATION_KEY,
    )).rejects.toBeInstanceOf(AIUsageGateError);
    await expect(refundAIRequestReservationBeforeProvider(
      client as never,
      "session_generation",
      OPERATION_KEY,
      OPERATION_KEY,
    )).rejects.toBeInstanceOf(AIUsageGateError);
    expect(client.auth.getUser).not.toHaveBeenCalled();
    expect(mocks.adminRpc).not.toHaveBeenCalled();
  });

  it("treats a live operation replay as contention, not quota exhaustion", async () => {
    mocks.adminRpc.mockResolvedValue({
      data: {
        allowed: false,
        claimId: null,
        operationKey: OPERATION_KEY,
        denialReason: "operation_in_progress",
        retryAfterSeconds: 37,
        remainingToday: 9,
      },
      error: null,
    });

    const reservation = await reserveAIRequest(
      authenticatedClient() as never,
      "session_generation",
      OPERATION_KEY,
      RECOVERY_KEY,
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

  it("keeps terminal operation replays distinct from usage limits", () => {
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

  it("settles one exact claim through the service-only per-user RPC", async () => {
    const client = authenticatedClient();
    mocks.adminRpc.mockResolvedValue({ data: true, error: null });

    await expect(settleAIRequestClaim(client as never, CLAIM_ID)).resolves.toBe(true);
    expect(mocks.adminRpc).toHaveBeenCalledWith("consume_ai_request_claim_for_user", {
      target_user_id: USER_ID,
      usage_claim_id: CLAIM_ID,
    });
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("retries one ambiguous settlement receipt with the same claim", async () => {
    const client = authenticatedClient();
    mocks.adminRpc
      .mockRejectedValueOnce(new Error("connection lost after commit"))
      .mockResolvedValueOnce({ data: true, error: null });

    await expect(settleAIRequestClaim(client as never, CLAIM_ID)).resolves.toBe(true);
    expect(mocks.adminRpc).toHaveBeenCalledTimes(2);
    expect(mocks.adminRpc).toHaveBeenNthCalledWith(1, "consume_ai_request_claim_for_user", {
      target_user_id: USER_ID,
      usage_claim_id: CLAIM_ID,
    });
    expect(mocks.adminRpc).toHaveBeenNthCalledWith(2, "consume_ai_request_claim_for_user", {
      target_user_id: USER_ID,
      usage_claim_id: CLAIM_ID,
    });
  });

  it("consumes post-provider failures through the same idempotent settlement", async () => {
    const client = authenticatedClient();
    mocks.adminRpc.mockResolvedValue({ data: true, error: null });

    await expect(consumeAIRequestClaimAfterProviderFailure(client as never, CLAIM_ID))
      .resolves.toBe(true);
    expect(mocks.adminRpc).toHaveBeenCalledWith("consume_ai_request_claim_for_user", {
      target_user_id: USER_ID,
      usage_claim_id: CLAIM_ID,
    });
  });

  it("refunds only an exact known pre-provider claim through the trusted RPC", async () => {
    const client = authenticatedClient();
    mocks.adminRpc.mockResolvedValue({ data: true, error: null });

    await expect(refundAIRequestClaimBeforeProvider(client as never, CLAIM_ID)).resolves.toBe(true);
    expect(mocks.adminRpc).toHaveBeenCalledWith("release_ai_request_claim_for_user", {
      target_user_id: USER_ID,
      usage_claim_id: CLAIM_ID,
    });
  });

  it("recovers an ambiguous reservation through the trusted per-user RPC", async () => {
    const client = authenticatedClient();
    mocks.adminRpc.mockResolvedValue({ data: true, error: null });

    await expect(refundAIRequestReservationBeforeProvider(
      client as never,
      "session_generation",
      OPERATION_KEY,
      RECOVERY_KEY,
    )).resolves.toBe(true);
    expect(mocks.adminRpc).toHaveBeenCalledWith("release_ai_request_reservation_for_user", {
      target_user_id: USER_ID,
      request_action: "session_generation",
      request_operation_key: OPERATION_KEY,
      request_recovery_key: RECOVERY_KEY,
    });
  });

  it("fails closed on malformed claim ids or malformed database receipts", async () => {
    const malformedClient = authenticatedClient();
    await expect(refundAIRequestClaimBeforeProvider(malformedClient as never, "not-a-uuid"))
      .rejects.toBeInstanceOf(AIUsageGateError);
    expect(malformedClient.auth.getUser).not.toHaveBeenCalled();
    expect(mocks.adminRpc).not.toHaveBeenCalled();

    mocks.adminRpc.mockResolvedValue({ data: null, error: null });
    await expect(refundAIRequestClaimBeforeProvider(authenticatedClient() as never, CLAIM_ID))
      .rejects.toBeInstanceOf(AIUsageGateError);
  });

  it("bounds a never-resolving settlement receipt and retries only the same claim", async () => {
    vi.useFakeTimers();
    try {
      mocks.adminRpc.mockImplementation(() => new Promise(() => undefined));
      const settlement = settleAIRequestClaim(authenticatedClient() as never, CLAIM_ID);
      const rejected = expect(settlement).rejects.toBeInstanceOf(AIUsageGateError);

      await vi.advanceTimersByTimeAsync(6_001);
      await rejected;
      expect(mocks.adminRpc).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    ["refund", () => refundAIRequestClaimBeforeProvider(authenticatedClient() as never, CLAIM_ID)],
    ["reserve", () => reserveAIRequest(
      authenticatedClient() as never,
      "session_generation",
      OPERATION_KEY,
      RECOVERY_KEY,
    )],
    ["recovery", () => refundAIRequestReservationBeforeProvider(
      authenticatedClient() as never,
      "session_generation",
      OPERATION_KEY,
      RECOVERY_KEY,
    )],
  ])("bounds a never-resolving %s receipt", async (_name, invoke) => {
    vi.useFakeTimers();
    try {
      mocks.adminRpc.mockImplementation(() => new Promise(() => undefined));
      const result = invoke();
      const rejected = expect(result).rejects.toBeInstanceOf(AIUsageGateError);

      await vi.advanceTimersByTimeAsync(3_001);
      await rejected;
      expect(mocks.adminRpc).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
