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
    const material = materialByChunkId.get(anchor.chunkId);
    return !grounding.sourceNames.includes(anchor.sourceName)
      || !material
      || material.name !== anchor.sourceName
      || material.locationLabel !== anchor.locationLabel
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
