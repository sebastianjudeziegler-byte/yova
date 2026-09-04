import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { GenerationObservation } from "@/lib/analytics/generation-observation";
import { persistMaterialMappingResult } from "@/lib/materials/material-mapping-persistence";

vi.mock("server-only", () => ({}));

const openAIMocks = vi.hoisted(() => ({
  parse: vi.fn(),
}));

vi.mock("@/lib/openai/client", () => ({
  getOpenAIClient: () => ({ responses: { parse: openAIMocks.parse } }),
}));
vi.mock("@/lib/openai/config", () => ({
  getOpenAIKnowledgeMapConfig: () => ({ apiKey: "test-key", model: "test-model" }),
}));

import { mapAndPersistMaterialWithConsumedAIUsage } from "@/lib/materials/material-understanding";

const observation: GenerationObservation = {
  generationType: "material_mapping",
  environment: "production",
  finalOutcome: "success",
  firstAttemptPassed: true,
  failedValidator: null,
  repairAttempted: false,
  repairSucceeded: null,
  elapsedMs: 25,
  attempts: 1,
  inputTokens: 100,
  cachedInputTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: 20,
  model: "test-model",
};

const chunks = [{
  id: "22222222-2222-4222-8222-222222222222",
  chunkIndex: 0,
  charStart: 0,
  charEnd: 12,
  locationLabel: "Beginning",
  sectionRole: "content_source" as const,
  chunkText: "Study text.",
}];

describe("material mapping persistence", () => {
  it("abandons a completed map without a second write when Reset removed its parent", async () => {
    openAIMocks.parse.mockResolvedValueOnce({
      status: "completed",
      output_parsed: {
        roleReason: "The material contains a concise instructional explanation.",
        chunks: [{
          chunkIndex: 0,
          sectionRole: "content_source",
          topics: [{
            title: "Core concept",
            description: "A complete description of the core concept.",
            subtopics: ["Supporting detail"],
            prerequisiteTitles: [],
          }],
        }],
      },
      usage: {
        input_tokens: 100,
        input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
        output_tokens: 20,
      },
    });
    const rpc = vi.fn().mockResolvedValue({ data: false, error: null });
    const from = vi.fn();

    await expect(mapAndPersistMaterialWithConsumedAIUsage({
      supabase: { rpc, from } as unknown as SupabaseClient,
      materialId: "22222222-2222-4222-8222-222222222222",
      filename: "notes.txt",
      text: "This material teaches the core concept with one supporting detail.",
    })).rejects.toThrow("The material was removed before mapping finished.");

    expect(rpc).toHaveBeenCalledOnce();
    expect(from).not.toHaveBeenCalled();
  });

  it("leaves no client-side write path when Reset already removed the parent", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: false, error: null });
    const from = vi.fn();
    const persisted = await persistMaterialMappingResult({
      supabase: { rpc, from } as unknown as SupabaseClient,
      table: "material_uploads",
      materialId: "11111111-1111-4111-8111-111111111111",
      metadataPatch: { mappingStatus: "ready" },
      chunks,
      observation,
    });

    expect(persisted).toBe(false);
    expect(rpc).toHaveBeenCalledOnce();
    expect(from).not.toHaveBeenCalled();
  });

  it("sends metadata, chunks, and observation through one atomic RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    const persisted = await persistMaterialMappingResult({
      supabase: { rpc } as unknown as SupabaseClient,
      table: "materials",
      materialId: "11111111-1111-4111-8111-111111111111",
      metadataPatch: { mappingStatus: "ready" },
      chunks,
      observation,
    });

    expect(persisted).toBe(true);
    expect(rpc).toHaveBeenCalledWith("persist_material_mapping_result", {
      requested_material_table: "materials",
      requested_material_id: "11111111-1111-4111-8111-111111111111",
      requested_metadata_patch: { mappingStatus: "ready" },
      requested_chunks: chunks,
      requested_observation: observation,
    });
  });

  it("surfaces database persistence errors", async () => {
    const error = { code: "40001", message: "serialization failed" };
    const rpc = vi.fn().mockResolvedValue({ data: null, error });

    await expect(persistMaterialMappingResult({
      supabase: { rpc } as unknown as SupabaseClient,
      table: "material_uploads",
      materialId: "11111111-1111-4111-8111-111111111111",
      metadataPatch: { mappingStatus: "failed" },
      chunks: [],
      observation: { ...observation, finalOutcome: "failure" },
    })).rejects.toBe(error);
  });
});
