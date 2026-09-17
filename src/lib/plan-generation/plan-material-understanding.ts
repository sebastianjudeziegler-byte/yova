import type { LearningMaterial } from "@/lib/domain";
import { MaterialUnderstandingSchema } from "@/lib/knowledge-map/schema";
import { z } from "zod";

const OverrideSchema = z.object({ materialId: z.string().uuid(), understanding: MaterialUnderstandingSchema });

/** Derive only from the signed plan, never from the unsigned activation request. */
export function materialUnderstandingForPlan(materials: readonly LearningMaterial[] = []) {
  return materials.flatMap(material => {
    const parsed = OverrideSchema.safeParse({ materialId: material.id, understanding: material.understanding });
    return parsed.success ? [parsed.data] : [];
  });
}

/** Classifications belong to this plan. Shared upload metadata stays unchanged. */
export function applyPlanMaterialUnderstanding<T extends LearningMaterial>(materials: T[], generationInputs: unknown): T[] {
  const raw = generationInputs && typeof generationInputs === "object" && "materialUnderstandingOverrides" in generationInputs ? generationInputs.materialUnderstandingOverrides : null;
  const overrides = new Map((Array.isArray(raw) ? raw : []).flatMap(value => {
    const parsed = OverrideSchema.safeParse(value);
    return parsed.success ? [[parsed.data.materialId, parsed.data.understanding] as const] : [];
  }));
  return materials.map(material => overrides.has(material.id) ? { ...material, understanding: overrides.get(material.id)! } : material);
}
