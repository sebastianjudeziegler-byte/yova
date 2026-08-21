import type { MaterialExcerpt } from "@/lib/materials/context";
import type { SessionSourceGrounding } from "@/lib/session-generation/schema";

export type MaterialSupportPolicy = {
  supplementationAllowed: boolean;
  supplementationRequiredForTeaching: boolean;
  reason: string;
};

export function buildMaterialSupportPolicy(materials: MaterialExcerpt[]): MaterialSupportPolicy {
  const hasScopeOutline = materials.some((material) => material.role === "scope_outline");
  if (hasScopeOutline) {
    return {
      supplementationAllowed: true,
      supplementationRequiredForTeaching: true,
      reason: "The mapped source chunks define what belongs in the lesson but do not contain all of its instruction. YOVA must teach the mapped topic fully and disclose that distinction.",
    };
  }

  return {
    supplementationAllowed: false,
    supplementationRequiredForTeaching: false,
    reason: "The uploaded material contains substantial explanatory text. Keep factual teaching inside the source and do not add outside content unless a later learner request explicitly asks for it.",
  };
}

/**
 * Source ids, filenames, locations, and quotations come from YOVA's mapped
 * database rows, not from model transcription. Preserve the provider's
 * decision to include grounding, then bind its provenance fields to those
 * authoritative rows so punctuation or Unicode drift cannot invalidate an
 * otherwise source-faithful lesson after generation.
 */
export function bindSessionSourceGroundingToMaterials({
  materials,
  grounding,
  focus,
}: {
  materials: MaterialExcerpt[];
  grounding: SessionSourceGrounding | null;
  focus: string;
}): SessionSourceGrounding | null {
  if (!grounding) return null;
  return buildMappedSessionSourceGrounding({ materials, focus }) ?? grounding;
}

export function buildMappedSessionSourceGrounding({
  materials,
  focus,
}: {
  materials: MaterialExcerpt[];
  focus: string;
}): SessionSourceGrounding | null {
  const mappedMaterials = materials.filter((material): material is MaterialExcerpt & { chunkId: string } => (
    Boolean(material.chunkId) && material.text.trim().length >= 12
  ));
  // Legacy excerpts do not carry a persisted chunk identity. Their provider
  // anchor remains subject to the existing exact-verification validator.
  if (mappedMaterials.length === 0) return null;

  const policy = buildMaterialSupportPolicy(materials);
  const selected = mappedMaterials.slice(0, 4);
  const sourceNames = [...new Set(materials.map((material) => material.name))].slice(0, 5);
  const mode = policy.supplementationRequiredForTeaching
    ? "materials_plus_ai" as const
    : "materials_only" as const;
  const boundedFocus = focus.trim().replace(/\s+/g, " ").slice(0, 160) || "the current session target";

  return {
    mode,
    summary: mode === "materials_plus_ai"
      ? "The guide defines the scope. YOVA provides the instruction."
      : "This lesson stays within the explanations in the learner's mapped source sections.",
    sourceNames,
    anchors: selected.map((material) => ({
      chunkId: material.chunkId,
      sourceName: material.name,
      locationLabel: material.locationLabel ?? "Uploaded material",
      excerpt: material.text.trim().slice(0, 220).trim(),
      usedFor: `Grounding ${boundedFocus} in the learner's mapped source section.`.slice(0, 240),
    })),
    supplements: mode === "materials_plus_ai"
      ? [{
        topic: scopeOutlineTopic(selected[0]!.text, boundedFocus),
        reason: "The mapped outline names the scope, while YOVA supplies the minimum explanation needed for this lesson.",
      }]
      : [],
  };
}

export function validateSessionSourceGrounding({
  sourceMode,
  materials,
  grounding,
}: {
  sourceMode: string;
  materials: MaterialExcerpt[];
  grounding: SessionSourceGrounding | null;
}): string | null {
  if (sourceMode !== "user_materials") {
    return grounding === null ? null : "YOVA-generated sessions must not claim uploaded-source grounding.";
  }
  if (materials.length === 0) return "A material-grounded session needs readable source text.";
  if (!grounding) return "A material-grounded session must report which source evidence it used.";

  const materialNames = new Set(materials.map((material) => material.name));
  const materialByChunkId = new Map(materials.flatMap((material) => (
    material.chunkId ? [[material.chunkId, material] as const] : []
  )));
  if (grounding.sourceNames.some((name) => !materialNames.has(name))) {
    return "The session cited a filename that was not supplied by the learner.";
  }
  if (grounding.anchors.some((anchor) => {
    const material = materialByChunkId.get(anchor.chunkId) ?? materials.find((candidate) => (
      !candidate.chunkId
      && candidate.name === anchor.sourceName
      && (candidate.locationLabel ?? "Uploaded material") === anchor.locationLabel
      && normalize(candidate.text).includes(normalize(anchor.excerpt))
    ));
    return !grounding.sourceNames.includes(anchor.sourceName)
      || !material
      || material.name !== anchor.sourceName
      || (material.locationLabel ?? "Uploaded material") !== anchor.locationLabel
      || !normalize(material.text).includes(normalize(anchor.excerpt));
  })) {
    return "The session included a source anchor that could not be verified in the mapped material chunk.";
  }

  const policy = buildMaterialSupportPolicy(materials);
  if (policy.supplementationRequiredForTeaching && grounding.mode !== "materials_plus_ai") {
    return "A scope outline defines what to teach, so YOVA must disclose that it supplied the instructional substance.";
  }
  if (grounding.mode === "materials_plus_ai" && !policy.supplementationAllowed) {
    return "The source already contains substantial explanations, so outside supplementation was not justified.";
  }
  if (policy.supplementationRequiredForTeaching) {
    const summary = normalize(grounding.summary);
    if (!summary.includes("defines the scope") || !summary.includes("provides the instruction")) {
      return "A scope-outline session must plainly say that the guide defines the scope while YOVA provides the instruction.";
    }
    const scopeText = normalize(materials.map((material) => material.text).join(" "));
    const unrelatedSupplement = grounding.supplements.find((supplement) => {
      const meaningfulWords = normalize(supplement.topic)
        .split(" ")
        .filter((word) => word.length >= 4);
      return meaningfulWords.length > 0 && !meaningfulWords.some((word) => scopeText.includes(word));
    });
    if (unrelatedSupplement) {
      return `The AI-supplied teaching topic "${unrelatedSupplement.topic}" is not clearly tied to the uploaded outline's scope.`;
    }
  }

  return null;
}

function normalize(value: string) {
  return value.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

function scopeOutlineTopic(text: string, fallback: string) {
  const firstLine = text.split(/\r?\n/u).map((line) => line.trim()).find((line) => line.length >= 2);
  return (firstLine ?? fallback).slice(0, 140);
}
