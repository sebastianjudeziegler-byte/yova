import "server-only";
import { MaterialUnderstandingSchema } from "@/lib/knowledge-map/schema";
import { StoredMaterialSchema } from "@/lib/plan-generation/schema";
import type { MapDelta } from "@/lib/plan-revision/map-delta";
import type { LearningPlan } from "@/lib/domain";
import type { createSupabaseServerClient } from "@/lib/supabase/server";
import { PlanRevisionRequestError } from "@/lib/plan-revision/preview-service";

export async function authorizeRevisionSources({ plan, delta, excluded, supabase, userId, now }: {
  plan: LearningPlan; delta: MapDelta; excluded: readonly number[];
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>> | null; userId: string | null; now: Date;
}) {
  const ids = [...new Set(delta.operations.flatMap((operation, index) => excluded.includes(index) ? [] : operation.op === "attach_source" && operation.material_id ? [operation.material_id]
    : operation.op === "add_topic" ? (operation.source_refs ?? []).flatMap(source => "material_id" in source ? [source.material_id] : []) : []))];
  if (!ids.length) return plan.materials ?? [];
  if (!supabase || !userId) throw new PlanRevisionRequestError("Sign in to attach a private file to this plan. You can still attach a public source URL.", 410);
  const attached = await supabase.from("materials").select("id,learning_item_id,filename,mime_type,byte_size,processing_status,metadata").eq("user_id", userId).in("id", ids);
  const staged = await supabase.from("material_uploads").select("id,filename,mime_type,byte_size,processing_status,expires_at,metadata").eq("user_id", userId).in("id", ids);
  if (attached.error || staged.error) throw new PlanRevisionRequestError("The source could not be verified. Nothing was changed.", 503);
  const selected = ids.map(id => (attached.data ?? []).find(row => row.id === id && row.learning_item_id === plan.learningItemId)
    ?? (staged.data ?? []).find(row => row.id === id && Date.parse(row.expires_at) > now.getTime()));
  if (selected.some(row => !row || row.processing_status !== "ready")) throw new PlanRevisionRequestError("A source is missing, expired, still processing or belongs to another goal. Choose a ready file you own.", 410);
  const materials = new Map((plan.materials ?? []).map(material => [material.id, material]));
  for (const row of selected) {
    const understanding = MaterialUnderstandingSchema.safeParse(row!.metadata?.understanding);
    materials.set(row!.id, StoredMaterialSchema.parse({ id: row!.id, name: row!.filename, mimeType: row!.mime_type, sizeBytes: row!.byte_size,
      textContent: null, processingStatus: "ready", understanding: understanding.success ? understanding.data : null }));
  }
  if (materials.size > 5) throw new PlanRevisionRequestError("This plan can keep up to five private files. Attach a link or use a file already in the plan.");
  return [...materials.values()];
}
