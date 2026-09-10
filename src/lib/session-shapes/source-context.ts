import type { LearningMaterial, LearningPlan } from "@/lib/domain";
import type { KnowledgeMapTopic } from "@/lib/knowledge-map/schema";
import type { SourceDescription, SourceExcerpt } from "@/lib/session-shapes/slots-schema";

/**
 * What the baseline session knows about the learner's material for one topic.
 *
 * - description: for Slot 1, named as specifically as the material allows
 *   (topic-specific notes → the name; a large document with a located section
 *   → the section; a pasted link → "the video you added"). Never the text.
 * - excerpts: the mapped chunks of the learner's own material, bounded, for
 *   Slot 3 (comparison) and Slot 4 (practice from the source).
 */
export type BaselineSourceContext = {
  description: SourceDescription | null;
  excerpts: SourceExcerpt[];
};

const EXCERPT_LIMIT = 8;
const EXCERPT_CHARACTERS = 4_000;

function materialKind(material: Pick<LearningMaterial, "name" | "mimeType">): SourceDescription["kind"] {
  const name = material.name.toLowerCase();
  const mime = material.mimeType.toLowerCase();
  if (mime.includes("presentation") || /\.(pptx?|key)$/.test(name) || /\bslides?\b/.test(name)) return "slides";
  if (mime.startsWith("video/") || /\byoutube\b|\bvideo\b|transcript/.test(name)) return "video";
  if (mime.startsWith("text/") && /\bnotes?\b/.test(name)) return "notes";
  if (mime === "application/pdf" || mime.includes("document") || mime.startsWith("text/")) return "document";
  return "other";
}

export function baselineSourceForTopic(plan: Pick<LearningPlan, "materials" | "sourceMode">, topic: KnowledgeMapTopic | null): BaselineSourceContext {
  if (!topic) return { description: null, excerpts: [] };
  const materials = new Map((plan.materials ?? []).map((material) => [material.id, material]));
  const excerpts: SourceExcerpt[] = [];
  const locations = new Map<string, string[]>();
  for (const reference of topic.sourceReferences) {
    const material = materials.get(reference.materialId);
    if (!material?.textContent) continue;
    const text = material.textContent.slice(reference.startCharacter, reference.endCharacter).trim();
    if (text) excerpts.push({ label: `${material.name} · ${reference.locationLabel}`, text: text.slice(0, EXCERPT_CHARACTERS) });
    locations.set(material.id, [...(locations.get(material.id) ?? []), reference.locationLabel]);
    if (excerpts.length >= EXCERPT_LIMIT) break;
  }
  const attachedLink = topic.attachedSources?.find((attached): attached is { url: string } => "url" in attached);
  const referencedMaterial = [...locations.keys()].map((id) => materials.get(id)).find((material): material is LearningMaterial => Boolean(material));
  const anyMaterial = referencedMaterial ?? (plan.materials ?? [])[0] ?? null;
  let description: SourceDescription | null = null;
  if (referencedMaterial) {
    const labels = [...new Set(locations.get(referencedMaterial.id) ?? [])];
    description = {
      name: referencedMaterial.name.slice(0, 160),
      kind: materialKind(referencedMaterial),
      location: labels.length ? labels.slice(0, 3).join(", ").slice(0, 120) : null,
    };
  } else if (attachedLink) {
    const video = /youtube\.com|youtu\.be|vimeo\.com/.test(attachedLink.url);
    description = { name: video ? "the video you added" : "the link you added", kind: video ? "video" : "link", location: null };
  } else if (anyMaterial && plan.sourceMode === "user_materials") {
    description = { name: anyMaterial.name.slice(0, 160), kind: materialKind(anyMaterial), location: null };
  }
  return { description, excerpts };
}
