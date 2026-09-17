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

/** Round-robin extraction gives every selected topic source context within the same request cap. */
export function baselineSourceForTopics(plan: Pick<LearningPlan, "materials" | "sourceMode">, topics: readonly KnowledgeMapTopic[]): BaselineSourceContext {
  const unique = [...new Map(topics.map((topic) => [topic.id, topic])).values()].slice(0, 4);
  if (unique.length < 2) return baselineSourceForTopic(plan, unique[0] ?? null);
  const contexts = unique.map((topic) => ({ topic, source: baselineSourceForTopic(plan, topic) }));
  const excerpts: SourceExcerpt[] = [];
  for (let index = 0; excerpts.length < EXCERPT_LIMIT; index += 1) {
    let found = false;
    for (const { topic, source } of contexts) {
      const excerpt = source.excerpts[index];
      if (!excerpt || excerpts.length >= EXCERPT_LIMIT) continue;
      found = true;
      excerpts.push({ ...excerpt, label: `${topic.title} · ${excerpt.label}`.slice(0, 160) });
    }
    if (!found) break;
  }
  const descriptions = contexts.flatMap(({ source }) => source.description ? [source.description] : []);
  return { description: descriptions.length ? { name: [...new Set(descriptions.map((item) => item.name))].join("; ").slice(0, 160), kind: descriptions[0]!.kind, location: descriptions.flatMap((item) => item.location ? [item.location] : []).join("; ").slice(0, 120) || null } : null, excerpts };
}

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
    if (reference.sectionRole !== "content_source" || !material?.textContent || material.understanding?.role === "scope_outline") continue;
    const text = material.textContent.slice(reference.startCharacter, reference.endCharacter).trim();
    if (text) excerpts.push({ label: `${material.name} · ${reference.locationLabel}`, text: text.slice(0, EXCERPT_CHARACTERS) });
    locations.set(material.id, [...(locations.get(material.id) ?? []), reference.locationLabel]);
    if (excerpts.length >= EXCERPT_LIMIT) break;
  }
  const attachedLink = topic.attachedSources?.find((attached): attached is { url: string } => "url" in attached);
  // A file attached to this topic (the plan screen, or Add material on the pre-session card).
  const attachedMaterial = (topic.attachedSources ?? [])
    .flatMap((attached) => ("material_id" in attached ? [materials.get(attached.material_id)] : []))
    .find((material): material is LearningMaterial => Boolean(material && canTeachFromMaterial(material)));
  if (!excerpts.length && attachedMaterial?.textContent) {
    // A mixed file must not leak its scope-outline sections through the
    // attached-file fallback. Only its explicitly mapped teaching ranges count.
    const text = attachedMaterial.understanding?.role === "mixed"
      ? attachedMaterial.understanding.topics.flatMap(entry => entry.sourceReferences)
        .filter(reference => reference.sectionRole === "content_source")
        .map(reference => attachedMaterial.textContent!.slice(reference.startCharacter, reference.endCharacter))
        .join("\n").trim()
      : attachedMaterial.textContent.trim();
    for (let start = 0, part = 1; start < text.length && excerpts.length < EXCERPT_LIMIT; start += EXCERPT_CHARACTERS, part += 1) {
      excerpts.push({ label: `${attachedMaterial.name} · part ${part}`, text: text.slice(start, start + EXCERPT_CHARACTERS) });
    }
  }
  const referencedMaterial = [...locations.keys()].map((id) => materials.get(id)).find((material): material is LearningMaterial => Boolean(material));
  const outlineOnly = topic.sourceReferences.length > 0 && topic.sourceReferences.every(reference => reference.sectionRole === "scope_outline");
  const anyMaterial = referencedMaterial ?? (topic.origin === "material" && !outlineOnly
    ? (plan.materials ?? []).find(canTeachFromMaterial) ?? null : null);
  let description: SourceDescription | null = null;
  if (referencedMaterial) {
    const labels = [...new Set(locations.get(referencedMaterial.id) ?? [])];
    description = {
      name: referencedMaterial.name.slice(0, 160),
      kind: materialKind(referencedMaterial),
      location: labels.length ? labels.slice(0, 3).join(", ").slice(0, 120) : null,
    };
  } else if (attachedMaterial) {
    description = { name: attachedMaterial.name.slice(0, 160), kind: materialKind(attachedMaterial), location: null };
  } else if (attachedLink) {
    const video = /youtube\.com|youtu\.be|vimeo\.com/.test(attachedLink.url);
    description = { name: video ? "the video you added" : "the link you added", kind: video ? "video" : "link", location: null };
  } else if (anyMaterial && plan.sourceMode === "user_materials") {
    description = { name: anyMaterial.name.slice(0, 160), kind: materialKind(anyMaterial), location: null };
  }
  return { description, excerpts };
}

function canTeachFromMaterial(material: LearningMaterial) {
  if (material.understanding?.role === "scope_outline") return false;
  return material.understanding?.role !== "mixed" || material.understanding.topics.some(topic => (
    topic.sourceReferences.some(reference => reference.sectionRole === "content_source")
  ));
}
