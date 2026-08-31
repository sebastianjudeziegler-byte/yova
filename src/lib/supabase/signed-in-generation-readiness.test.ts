import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  adminConfigured: true,
  rpc: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  isSupabaseAdminConfigured: () => mocks.adminConfigured,
  createSupabaseAdminClient: () => ({ rpc: mocks.rpc }),
}));

import {
  signedInGenerationReadinessStatus,
  SIGNED_IN_GENERATION_CONTRACT_VERSION,
} from "@/lib/supabase/signed-in-generation-readiness";

describe("deployed signed-in generation readiness", () => {
  beforeEach(() => {
    mocks.adminConfigured = true;
    mocks.rpc.mockReset().mockResolvedValue({
      data: completeReadinessPayload(),
      error: null,
    });
    vi.stubEnv(
      "YOVA_DRAFT_RECEIPT_SECRET",
      "draft-receipt-secret-that-is-at-least-thirty-two-characters",
    );
    vi.stubEnv("YOVA_DRAFT_RECEIPT_PREVIOUS_SECRET", "");
  });

  it("reports ready only after the service-only database contract passes", async () => {
    await expect(signedInGenerationReadinessStatus()).resolves.toBe("ready");
    expect(mocks.rpc).toHaveBeenCalledWith("signed_in_generation_readiness_v3");
  });

  it("fails before probing when either server-only prerequisite is absent", async () => {
    vi.stubEnv("YOVA_DRAFT_RECEIPT_SECRET", "");
    await expect(signedInGenerationReadinessStatus()).resolves.toBe("unavailable");
    expect(mocks.rpc).not.toHaveBeenCalled();

    vi.stubEnv(
      "YOVA_DRAFT_RECEIPT_SECRET",
      "draft-receipt-secret-that-is-at-least-thirty-two-characters",
    );
    mocks.adminConfigured = false;
    await expect(signedInGenerationReadinessStatus()).resolves.toBe("unavailable");
    expect(mocks.rpc).not.toHaveBeenCalled();

    mocks.adminConfigured = true;
    vi.stubEnv("YOVA_DRAFT_RECEIPT_PREVIOUS_SECRET", "invalid-rotation-key");
    await expect(signedInGenerationReadinessStatus()).resolves.toBe("unavailable");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("rejects RPC errors, stale versions, and partial database contracts", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "PGRST202" } });
    await expect(signedInGenerationReadinessStatus()).resolves.toBe("unavailable");

    mocks.rpc.mockResolvedValueOnce({
      data: { ...completeReadinessPayload(), contractVersion: "stale" },
      error: null,
    });
    await expect(signedInGenerationReadinessStatus()).resolves.toBe("unavailable");

    mocks.rpc.mockResolvedValueOnce({
      data: { ...completeReadinessPayload(), requiredRouteRpcs: false },
      error: null,
    });
    await expect(signedInGenerationReadinessStatus()).resolves.toBe("unavailable");

    mocks.rpc.mockResolvedValueOnce({
      data: { ...completeReadinessPayload(), expandedMethodAgencyBoundary: false },
      error: null,
    });
    await expect(signedInGenerationReadinessStatus()).resolves.toBe("unavailable");

    mocks.rpc.mockResolvedValueOnce({
      data: { ...completeReadinessPayload(), methodEligibilityV3Boundary: false },
      error: null,
    });
    await expect(signedInGenerationReadinessStatus()).resolves.toBe("unavailable");
  });
});

function completeReadinessPayload() {
  return {
    contractVersion: SIGNED_IN_GENERATION_CONTRACT_VERSION,
    ready: true,
    studyRoutesSchema: true,
    planSessionsRoutePointer: true,
    requiredRouteRpcs: true,
    expandedMethodAgencyBoundary: true,
    methodEligibilityV3Boundary: true,
  };
}
