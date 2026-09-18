import { z } from "zod";
import type { LearningMaterial } from "@/lib/domain";
import { PlanKnowledgeMapSchema, type PlanKnowledgeMap, type KnowledgeMapTopic } from "@/lib/knowledge-map/schema";

export const SetupCorrectionsSchema = z.object({
  materials: z.array(z.object({ materialId: z.string().uuid(), role: z.enum(["content_source", "scope_outline"]) }).strict()).max(5),
  topics: z.array(z.object({ id: z.string().uuid(), materialId: z.string().uuid().nullable(), covered: z.boolean(), addedTitle: z.string().trim().min(2).max(140).optional() }).strict()).min(1).max(40),
}).strict();
export type SetupCorrections = z.infer<typeof SetupCorrectionsSchema>;

export function initialSetupCorrections(map: PlanKnowledgeMap, materials: LearningMaterial[]): SetupCorrections {
  const ids = new Set(materials.map(material => material.id));
  return {
    materials: materials.filter(material => material.understanding?.role !== "mixed").map(material => ({ materialId: material.id, role: material.understanding?.role === "scope_outline" ? "scope_outline" : "content_source" })),
    topics: map.topics.filter(topic => !topic.removed).map(topic => ({ id: topic.id,
      materialId: topic.attachedSources?.flatMap(source => "material_id" in source && ids.has(source.material_id) ? [source.material_id] : [])[0]
        ?? topic.sourceReferences.find(source => ids.has(source.materialId))?.materialId ?? null,
      covered: topic.initialEvidence?.source === "learner_report",
    })),
  };
}

/** The caller authenticates the original map receipt and loads authorized materials.
 * This boundary accepts declarations only, never client-scored evidence. */
export function applySetupCorrections<T extends LearningMaterial>({ knowledgeMap, materials, corrections: raw }: {
  knowledgeMap: PlanKnowledgeMap; materials: T[]; corrections: SetupCorrections;
}): { knowledgeMap: PlanKnowledgeMap; materials: T[] } {
  const corrections = SetupCorrectionsSchema.parse(raw);
  const original = PlanKnowledgeMapSchema.parse(knowledgeMap);
  const materialIds = new Set(materials.map(material => material.id));
  const roles = new Map<string, "content_source" | "scope_outline">();
  for (const choice of corrections.materials) {
    if (!materialIds.has(choice.materialId)) throw new Error("That source is not attached to this plan.");
    if (roles.has(choice.materialId)) throw new Error("Duplicate source classification.");
    roles.set(choice.materialId, choice.role);
  }
  const originalTopics = new Map(original.topics.map(topic => [topic.id, topic]));
  const ids = new Set<string>();
  const topics: KnowledgeMapTopic[] = corrections.topics.map(choice => {
    if (ids.has(choice.id)) throw new Error("Duplicate topic in these corrections.");
    ids.add(choice.id);
    if (choice.materialId && !materialIds.has(choice.materialId)) throw new Error("That topic source is not attached to this plan.");
    const existing = originalTopics.get(choice.id);
    if (!existing && choice.addedTitle && (original.topics.some(topic => topic.title.toLocaleLowerCase() === choice.addedTitle!.toLocaleLowerCase()) || corrections.topics.some(other => other.id !== choice.id && other.addedTitle?.toLocaleLowerCase() === choice.addedTitle!.toLocaleLowerCase()))) throw new Error("Duplicate topic title. Use the existing topic.");
    if (existing && choice.addedTitle) throw new Error("An existing topic title cannot be changed. Remove it and add the correct topic.");
    if (!existing && !choice.addedTitle) throw new Error("Give the added topic a title.");
    const topic: KnowledgeMapTopic = existing ? structuredClone(existing) : {
      id: choice.id, title: choice.addedTitle!, description: `Learn and apply ${choice.addedTitle!}.`, subtopics: [], prerequisiteTopicIds: [], status: "not_started", initialEvidence: null, sourceReferences: [], origin: "ai_generated", deferred: null,
    };
    if (choice.covered) {
      if (topic.initialEvidence?.source === "placement_check") topic.placementEvidence = topic.initialEvidence;
      topic.initialEvidence = { source: "learner_report", outcome: "covered_elsewhere", checked: false };
    } else if (topic.initialEvidence?.source === "learner_report") topic.initialEvidence = topic.placementEvidence ?? null;
    topic.attachedSources = choice.materialId ? [{ material_id: choice.materialId }] : [];
    topic.sourceReferences = choice.materialId ? topic.sourceReferences.filter(reference => reference.materialId === choice.materialId).map(reference => ({ ...reference, sectionRole: roles.get(reference.materialId) ?? reference.sectionRole })) : [];
    topic.origin = choice.materialId ? "material" : "ai_generated";
    topic.removed = false;
    topic.deferred = null;
    return topic;
  });
  const positions = new Map(topics.map((topic, index) => [topic.id, index]));
  for (const topic of topics) {
    if (topic.prerequisiteTopicIds.some(id => !positions.has(id) || positions.get(id)! >= positions.get(topic.id)!)) {
      throw new Error(`${topic.title} needs its prerequisite first. Keep that topic before it, or remove both.`);
    }
  }
  const updatedMaterials = materials.map(material => {
    const role = roles.get(material.id);
    if (!role) return structuredClone(material);
    const existing = material.understanding;
    return { ...material, understanding: {
      version: 1 as const, role, roleReason: "The learner selected this source classification during plan setup.",
      mixedSections: [], topics: topics.filter(topic => topic.attachedSources?.some(source => "material_id" in source && source.material_id === material.id)).length
        ? topics.filter(topic => topic.attachedSources?.some(source => "material_id" in source && source.material_id === material.id)) : existing?.topics ?? [topics[0]],
      chunkCount: existing?.chunkCount ?? 1, mappedAt: existing?.mappedAt ?? new Date().toISOString(),
    } };
  });
  return { knowledgeMap: PlanKnowledgeMapSchema.parse({ ...original, topics, placementCheck: {
    ...original.placementCheck,
    demonstratedTopicIds: original.placementCheck.demonstratedTopicIds.filter(id => ids.has(id)),
    gapTopicIds: original.placementCheck.gapTopicIds.filter(id => ids.has(id)),
  } }), materials: updatedMaterials };
}
