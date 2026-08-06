import type { MaterialExcerpt } from "@/lib/materials/context";
import type { SessionSourceGrounding } from "@/lib/session-generation/schema";

export type MaterialSupportPolicy = {
  supplementationAllowed: boolean;
  supplementationRequiredForTeaching: boolean;
  reason: string;
};

export function buildMaterialSupportPolicy(materials: MaterialExcerpt[]): MaterialSupportPolicy {
  const combined = materials.map((material) => material.text).join("\n");
  const words = combined.match(/[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu) ?? [];
  const lines = combined.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const outlineLines = lines.filter((line) => (
    /^([-*•]|\d+[.)])\s+/.test(line)
    || (/^[^.!?]{2,80}:?$/.test(line) && line.split(/\s+/).length <= 10)
  ));
  const outlineRatio = lines.length > 0 ? outlineLines.length / lines.length : 0;

  if (words.length < 300 || outlineRatio >= 0.45) {
    return {
      supplementationAllowed: true,
      supplementationRequiredForTeaching: words.length < 120 || outlineRatio >= 0.7,
      reason: "The uploaded material is short or outline-heavy. It should define the session scope, while YOVA may add only the explanation or example needed to teach those listed ideas.",
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
  learningMode,
}: {
  sourceMode: string;
  materials: MaterialExcerpt[];
  grounding: SessionSourceGrounding | null;
  learningMode?: "learn" | "study";
}): string | null {
  if (sourceMode !== "user_materials") {
    return grounding === null ? null : "YOVA-generated sessions must not claim uploaded-source grounding.";
  }
  if (materials.length === 0) return "A material-grounded session needs readable source text.";
  if (!grounding) return "A material-grounded session must report which source evidence it used.";

  const materialByName = new Map(materials.map((material) => [material.name, material]));
  if (grounding.sourceNames.some((name) => !materialByName.has(name))) {
    return "The session cited a filename that was not supplied by the learner.";
  }
  if (grounding.anchors.some((anchor) => {
    const material = materialByName.get(anchor.sourceName);
    return !grounding.sourceNames.includes(anchor.sourceName)
      || !material
      || !normalize(material.text).includes(normalize(anchor.excerpt));
  })) {
    return "The session included a source anchor that could not be verified in the uploaded text.";
  }

  const policy = buildMaterialSupportPolicy(materials);
  if (learningMode === "learn" && policy.supplementationRequiredForTeaching && grounding.mode !== "materials_plus_ai") {
    return "The uploaded source only outlines the topic, so a learn session must disclose bounded AI teaching support instead of pretending the outline contains a full explanation.";
  }
  if (grounding.mode === "materials_plus_ai" && !policy.supplementationAllowed) {
    return "The source already contains substantial explanations, so outside supplementation was not justified.";
  }
  if (grounding.mode === "materials_plus_ai" && grounding.supplements.some((supplement) => (
    !sharesInScopeTerm(supplement.topic, materials)
  ))) {
    return "A proposed AI supplement was not clearly tied to a topic in the uploaded material.";
  }

  return null;
}

function normalize(value: string) {
  return value.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

function sharesInScopeTerm(topic: string, materials: MaterialExcerpt[]) {
  const materialRoots = new Set(wordRoots(materials.map((material) => material.text).join(" ")));
  return wordRoots(topic).some((root) => materialRoots.has(root));
}

function wordRoots(value: string) {
  const ignored = new Set(["about", "after", "before", "between", "explain", "extra", "overview", "relationship", "their", "these", "those", "using", "where", "which"]);
  return (normalize(value).match(/[\p{L}\p{N}]+/gu) ?? [])
    .filter((word) => word.length >= 4 && !ignored.has(word))
    .map((word) => word.slice(0, 6));
}
