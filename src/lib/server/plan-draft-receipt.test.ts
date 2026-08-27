import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  assertPlanDraftReceiptConfigured,
  issuePlanDraftReceipt,
  PLAN_DRAFT_RECEIPT_CLOCK_SKEW_MS,
  PLAN_DRAFT_RECEIPT_MAX_CANONICAL_BYTES,
  PLAN_DRAFT_RECEIPT_MAX_LIFETIME_MS,
  PLAN_DRAFT_RECEIPT_MAX_LENGTH,
  PlanDraftReceiptConfigurationError,
  PlanDraftReceiptInputError,
  verifyPlanDraftReceipt,
  type PlanDraftReceiptSecrets,
} from "@/lib/server/plan-draft-receipt";

const CURRENT_SECRET = "current-plan-draft-secret-0123456789-abcdef";
const PREVIOUS_SECRET = "previous-plan-draft-secret-0123456789-abcdef";
const ROTATED_SECRET = "rotated-plan-draft-secret-0123456789-abcdef";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const ISSUED_AT = "2026-08-23T12:00:00.000Z";
const EXPIRES_AT = "2026-08-23T13:00:00.000Z";
const NOW = "2026-08-23T12:30:00.000Z";

const secrets: PlanDraftReceiptSecrets = { current: CURRENT_SECRET };

function receiptInput() {
  return {
    parsedPlan: {
      id: "22222222-2222-4222-8222-222222222222",
      status: "draft",
      sessions: [{ id: "33333333-3333-4333-8333-333333333333", minutes: 25 }],
    },
    normalizedGenerationContract: {
      intent: "study_now",
      availability: [{ minutes: 25, day: "Sunday", window: "Now" }],
    },
    authenticatedUserId: USER_ID,
    issuedAt: ISSUED_AT,
    expiresAt: EXPIRES_AT,
  } as const;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("plan draft receipt", () => {
  it("issues and verifies one compact receipt for the exact user, plan, and generation contract", () => {
    const issued = issuePlanDraftReceipt(receiptInput(), { secrets });
    const verified = verifyPlanDraftReceipt({
      ...receiptInput(),
      receipt: issued.receipt,
      now: NOW,
    }, { secrets });

    expect(issued.receipt.length).toBeLessThanOrEqual(PLAN_DRAFT_RECEIPT_MAX_LENGTH);
    expect(issued.receipt).toMatch(/^yova-draft\.v1\.[A-Za-z0-9_-]{16}\./u);
    expect(issued.metadata).toEqual({
      version: "v1",
      kid: expect.any(String),
      issuedAt: ISSUED_AT,
      expiresAt: EXPIRES_AT,
    });
    expect(verified).toEqual({ ok: true, metadata: issued.metadata });
    expect(Object.isFrozen(issued)).toBe(true);
    expect(Object.isFrozen(issued.metadata)).toBe(true);
  });

  it("uses stable canonical JSON rather than caller object-key insertion order", () => {
    const first = issuePlanDraftReceipt(receiptInput(), { secrets });
    const reordered = issuePlanDraftReceipt({
      ...receiptInput(),
      parsedPlan: {
        sessions: [{ minutes: 25, id: "33333333-3333-4333-8333-333333333333" }],
        status: "draft",
        id: "22222222-2222-4222-8222-222222222222",
      },
      normalizedGenerationContract: {
        availability: [{ window: "Now", day: "Sunday", minutes: 25 }],
        intent: "study_now",
      },
    }, { secrets });

    expect(reordered.receipt).toBe(first.receipt);
  });

  it.each([
    ["plan", { parsedPlan: { ...receiptInput().parsedPlan, status: "active" } }],
    ["contract", { normalizedGenerationContract: { intent: "plan" } }],
    ["user", { authenticatedUserId: "44444444-4444-4444-8444-444444444444" }],
  ])("rejects a changed %s with an equal-length constant-time signature comparison", (_label, change) => {
    const issued = issuePlanDraftReceipt(receiptInput(), { secrets });
    expect(verifyPlanDraftReceipt({
      ...receiptInput(),
      ...change,
      receipt: issued.receipt,
      now: NOW,
    }, { secrets })).toEqual({ ok: false, reason: "signature_mismatch" });
  });

  it("rejects receipts before their bounded clock-skew window and at expiration", () => {
    const issued = issuePlanDraftReceipt(receiptInput(), { secrets });
    const issuedAtMs = Date.parse(ISSUED_AT);

    expect(verifyPlanDraftReceipt({
      ...receiptInput(),
      receipt: issued.receipt,
      now: issuedAtMs - PLAN_DRAFT_RECEIPT_CLOCK_SKEW_MS - 1,
    }, { secrets })).toEqual({ ok: false, reason: "not_yet_valid" });
    expect(verifyPlanDraftReceipt({
      ...receiptInput(),
      receipt: issued.receipt,
      now: EXPIRES_AT,
    }, { secrets })).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects zero, negative, and overlong issuance windows", () => {
    const issuedAtMs = Date.parse(ISSUED_AT);
    for (const expiresAt of [
      issuedAtMs,
      issuedAtMs - 1,
      issuedAtMs + PLAN_DRAFT_RECEIPT_MAX_LIFETIME_MS + 1,
    ]) {
      expect(() => issuePlanDraftReceipt({
        ...receiptInput(),
        issuedAt: issuedAtMs,
        expiresAt,
      }, { secrets })).toThrow(PlanDraftReceiptInputError);
    }
  });

  it("verifies an old receipt with the bounded previous-secret rotation slot", () => {
    const oldReceipt = issuePlanDraftReceipt(receiptInput(), {
      secrets: { current: PREVIOUS_SECRET },
    });
    const rotated = { current: ROTATED_SECRET, previous: PREVIOUS_SECRET };

    expect(verifyPlanDraftReceipt({
      ...receiptInput(),
      receipt: oldReceipt.receipt,
      now: NOW,
    }, { secrets: rotated })).toMatchObject({ ok: true });
    expect(verifyPlanDraftReceipt({
      ...receiptInput(),
      receipt: oldReceipt.receipt,
      now: NOW,
    }, { secrets: { current: ROTATED_SECRET } })).toEqual({
      ok: false,
      reason: "key_unavailable",
    });
  });

  it("loads only dedicated server secrets and fails closed on missing or short configuration", () => {
    vi.stubEnv("YOVA_DRAFT_RECEIPT_SECRET", CURRENT_SECRET);
    const issued = issuePlanDraftReceipt(receiptInput());
    expect(verifyPlanDraftReceipt({
      ...receiptInput(),
      receipt: issued.receipt,
      now: NOW,
    })).toMatchObject({ ok: true });

    vi.stubEnv("YOVA_DRAFT_RECEIPT_SECRET", "too-short");
    expect(() => assertPlanDraftReceiptConfigured()).toThrow(
      PlanDraftReceiptConfigurationError,
    );
    expect(() => issuePlanDraftReceipt(receiptInput())).toThrow(PlanDraftReceiptConfigurationError);
    expect(verifyPlanDraftReceipt({
      ...receiptInput(),
      receipt: issued.receipt,
      now: NOW,
    })).toEqual({ ok: false, reason: "configuration_error" });
  });

  it.each([
    "",
    "not-a-receipt",
    "yova-draft.v2.aaaaaaaaaaaaaaaa.1.2.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    `yova-draft.v1.aaaaaaaaaaaaaaaa.1.2.${"a".repeat(PLAN_DRAFT_RECEIPT_MAX_LENGTH)}`,
  ])("rejects malformed or unsupported receipt %j without throwing", (receipt) => {
    const result = verifyPlanDraftReceipt({
      ...receiptInput(),
      receipt,
      now: NOW,
    }, { secrets });
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({
      reason: receipt.includes(".v2.") ? "unsupported_version" : "malformed_receipt",
    });
  });

  it("rejects ambiguous, cyclic, non-finite, non-plain, and oversized payloads", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const invalidPlans = [
      { value: undefined },
      { value: Number.NaN },
      new Date(ISSUED_AT),
      cyclic,
      { value: "x".repeat(PLAN_DRAFT_RECEIPT_MAX_CANONICAL_BYTES + 1) },
    ];

    for (const parsedPlan of invalidPlans) {
      expect(() => issuePlanDraftReceipt({
        ...receiptInput(),
        parsedPlan,
      }, { secrets })).toThrow(PlanDraftReceiptInputError);
    }
  });
});
