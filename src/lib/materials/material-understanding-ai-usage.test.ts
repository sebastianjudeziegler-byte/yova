import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  reserve: vi.fn(),
  settle: vi.fn(),
  release: vi.fn(),
  recover: vi.fn(),
  parse: vi.fn(),
  persist: vi.fn(),
  getConfig: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/server/ai-usage", () => ({
  reserveAIRequest: mocks.reserve,
  settleAIRequestClaim: mocks.settle,
  refundAIRequestClaimBeforeProvider: mocks.release,
  refundAIRequestReservationBeforeProvider: mocks.recover,
}));
vi.mock("@/lib/openai/client", () => ({
  getOpenAIClient: () => ({ responses: { parse: mocks.parse } }),
}));
vi.mock("@/lib/openai/config", () => ({
  getOpenAIKnowledgeMapConfig: mocks.getConfig,
}));
vi.mock("@/lib/materials/material-mapping-persistence", () => ({
  persistMaterialMappingResult: mocks.persist,
}));

import {
  MaterialMappingAllowanceError,
  mapAndPersistMaterial,
} from "@/lib/materials/material-understanding";

const MATERIAL_ID = "22222222-2222-4222-8222-222222222222";
const CLAIM_ID = "33333333-3333-4333-8333-333333333333";
const supabase = {} as SupabaseClient;

describe("material mapping durable AI allowance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getConfig.mockReturnValue({ apiKey: "test-key", model: "test-model" });
    mocks.reserve.mockResolvedValue({
      allowed: true,
      claimId: CLAIM_ID,
      operationKey: MATERIAL_ID,
      reservationState: "reserved",
      replayed: false,
      retryAfterSeconds: 0,
      remainingToday: 2,
    });
    mocks.settle.mockResolvedValue(true);
    mocks.release.mockResolvedValue(true);
    mocks.recover.mockResolvedValue(false);
    mocks.persist.mockResolvedValue(true);
    mocks.parse.mockResolvedValue(completedMappingResponse());
  });

  it("uses the material UUID as the reservation key and consumes immediately before provider work", async () => {
    await expect(mapAndPersistMaterial(mappingInput())).resolves.toMatchObject({
      version: 1,
      chunkCount: 1,
    });

    const recoveryKey = mocks.reserve.mock.calls[0]?.[3];
    expect(recoveryKey).toEqual(expect.any(String));
    expect(mocks.reserve).toHaveBeenCalledWith(
      supabase,
      "material_processing",
      MATERIAL_ID,
      recoveryKey,
    );
    expect(mocks.settle).toHaveBeenCalledWith(supabase, CLAIM_ID);
    expect(mocks.reserve.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.settle.mock.invocationCallOrder[0]);
    expect(mocks.settle.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.parse.mock.invocationCallOrder[0]);
    expect(mocks.release).not.toHaveBeenCalled();
    expect(mocks.recover).not.toHaveBeenCalled();
  });

  it("keeps a paid provider failure consumed", async () => {
    mocks.parse.mockRejectedValueOnce(new Error("provider response invalid"));

    await expect(mapAndPersistMaterial(mappingInput())).rejects.toThrow("provider response invalid");

    expect(mocks.settle).toHaveBeenCalledOnce();
    expect(mocks.parse).toHaveBeenCalledOnce();
    expect(mocks.release).not.toHaveBeenCalled();
    expect(mocks.persist).toHaveBeenCalledWith(expect.objectContaining({
      metadataPatch: { mappingStatus: "failed" },
    }));
  });

  it("refunds an exact reservation when configuration fails before any provider call", async () => {
    mocks.getConfig.mockReturnValue(null);

    await expect(mapAndPersistMaterial(mappingInput())).rejects.toThrow(
      "Knowledge mapping is not configured.",
    );

    expect(mocks.settle).not.toHaveBeenCalled();
    expect(mocks.parse).not.toHaveBeenCalled();
    expect(mocks.release).toHaveBeenCalledWith(supabase, CLAIM_ID);
  });

  it("does not contact the provider when claim consumption cannot be confirmed", async () => {
    mocks.settle.mockResolvedValue(false);

    await expect(mapAndPersistMaterial(mappingInput()))
      .rejects.toBeInstanceOf(MaterialMappingAllowanceError);

    expect(mocks.parse).not.toHaveBeenCalled();
    expect(mocks.release).toHaveBeenCalledWith(supabase, CLAIM_ID);
  });

  it("denies mapping before provider work when the material allowance is exhausted", async () => {
    mocks.reserve.mockResolvedValue({
      allowed: false,
      claimId: null,
      operationKey: MATERIAL_ID,
      denialReason: "usage_limit",
      retryAfterSeconds: 3_600,
      remainingToday: 0,
    });

    const error = await mapAndPersistMaterial(mappingInput()).catch((caught) => caught);
    expect(error).toBeInstanceOf(MaterialMappingAllowanceError);
    expect(error).toMatchObject({
      denialReason: "usage_limit",
      retryAfterSeconds: 3_600,
    });
    expect(mocks.settle).not.toHaveBeenCalled();
    expect(mocks.parse).not.toHaveBeenCalled();
    expect(mocks.release).not.toHaveBeenCalled();
  });

  it("recovers an ambiguous reserve receipt with the same stable operation key", async () => {
    mocks.reserve.mockRejectedValueOnce(new Error("receipt lost"));

    await expect(mapAndPersistMaterial(mappingInput()))
      .rejects.toBeInstanceOf(MaterialMappingAllowanceError);

    const recoveryKey = mocks.reserve.mock.calls[0]?.[3];
    expect(mocks.recover).toHaveBeenCalledWith(
      supabase,
      "material_processing",
      MATERIAL_ID,
      recoveryKey,
    );
    expect(mocks.parse).not.toHaveBeenCalled();
  });
});

function mappingInput() {
  return {
    supabase,
    materialId: MATERIAL_ID,
    filename: "cell-respiration.txt",
    text: "Cellular respiration transfers energy through a sequence of chemical reactions.",
  };
}

function completedMappingResponse() {
  return {
    status: "completed",
    output_parsed: {
      roleReason: "The material contains a concise instructional explanation.",
      chunks: [{
        chunkIndex: 0,
        sectionRole: "content_source",
        topics: [{
          title: "Cellular respiration",
          description: "How cells transfer energy through a sequence of reactions.",
          subtopics: ["Energy transfer"],
          prerequisiteTitles: [],
        }],
      }],
    },
    usage: {
      input_tokens: 100,
      input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
      output_tokens: 20,
    },
  };
}
