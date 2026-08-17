import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { GenerationObservation } from "@/lib/analytics/generation-observation";
import type { MaterialSectionRole } from "@/lib/knowledge-map/schema";

export type PersistedMaterialChunk = {
  id: string;
  chunkIndex: number;
  charStart: number;
  charEnd: number;
  locationLabel: string;
  sectionRole: MaterialSectionRole;
  chunkText: string;
};

export async function persistMaterialMappingResult(input: {
  supabase: SupabaseClient;
  table: "material_uploads" | "materials";
  materialId: string;
  metadataPatch: Record<string, unknown>;
  chunks: PersistedMaterialChunk[];
  observation: GenerationObservation;
}) {
  const { data, error } = await input.supabase.rpc("persist_material_mapping_result", {
    requested_material_table: input.table,
    requested_material_id: input.materialId,
    requested_metadata_patch: input.metadataPatch,
    requested_chunks: input.chunks,
    requested_observation: input.observation,
  });
  if (error) throw error;
  return data === true;
}
