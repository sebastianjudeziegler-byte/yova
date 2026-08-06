import { describe, expect, it } from "vitest";
import { buildMaterialSupportPolicy, validateSessionSourceGrounding } from "@/lib/materials/grounding";

const outlineMaterial = [{
  name: "unit-guide.txt",
  text: "Cellular respiration\n- Glycolysis\n- Krebs cycle\n- Electron transport chain\nKnow the location and purpose of each stage.",
  truncated: false,
}];

const explanatoryMaterial = [{
  name: "complete-notes.txt",
  text: Array.from({ length: 90 }, (_, index) => `Section ${index} explains how a mechanism changes inputs into outputs with evidence, examples, and a clear causal relationship.`).join("\n"),
  truncated: false,
}];

describe("material support policy", () => {
  it("allows bounded teaching support for a rough outline", () => {
    expect(buildMaterialSupportPolicy(outlineMaterial).supplementationAllowed).toBe(true);
  });

  it("keeps a substantial explanatory source material-only", () => {
    expect(buildMaterialSupportPolicy(explanatoryMaterial).supplementationAllowed).toBe(false);
  });
});

describe("session source grounding", () => {
  it("accepts a verified source anchor and a disclosed supplement for an outline", () => {
    expect(validateSessionSourceGrounding({
      sourceMode: "user_materials",
      materials: outlineMaterial,
      grounding: {
        mode: "materials_plus_ai",
        summary: "The study guide set the tested scope, while YOVA added a concise explanation of the listed stages.",
        sourceNames: ["unit-guide.txt"],
        anchors: [{
          sourceName: "unit-guide.txt",
          excerpt: "Know the location and purpose of each stage.",
          usedFor: "This line defines the comparison the session will ask the learner to make.",
        }],
        supplements: [{
          topic: "Cellular respiration stages",
          reason: "The guide lists the stages but does not explain the causal sequence between them.",
        }],
      },
    })).toBeNull();
  });

  it("rejects an invented quotation", () => {
    expect(validateSessionSourceGrounding({
      sourceMode: "user_materials",
      materials: outlineMaterial,
      grounding: {
        mode: "materials_only",
        summary: "The session follows the scope and detail supplied in the learner's source material.",
        sourceNames: ["unit-guide.txt"],
        anchors: [{ sourceName: "unit-guide.txt", excerpt: "This sentence was never uploaded.", usedFor: "An unsupported claim about the session scope." }],
        supplements: [],
      },
    })).toMatch(/could not be verified/i);
  });

  it("rejects unnecessary AI supplementation when the source is already substantial", () => {
    expect(validateSessionSourceGrounding({
      sourceMode: "user_materials",
      materials: explanatoryMaterial,
      grounding: {
        mode: "materials_plus_ai",
        summary: "The source is already comprehensive, so this supplement should not be permitted by policy.",
        sourceNames: ["complete-notes.txt"],
        anchors: [{
          sourceName: "complete-notes.txt",
          excerpt: "Section 0 explains how a mechanism changes inputs into outputs",
          usedFor: "This exact passage is the factual anchor for the generated session.",
        }],
        supplements: [{ topic: "Extra overview", reason: "The model wanted to add an overview despite having complete notes." }],
      },
    })).toMatch(/not justified/i);
  });

  it("rejects a supplement that wanders outside the uploaded scope", () => {
    expect(validateSessionSourceGrounding({
      sourceMode: "user_materials",
      materials: outlineMaterial,
      grounding: {
        mode: "materials_plus_ai",
        summary: "The source remains the anchor, but the proposed extra topic is unrelated to the learner's guide.",
        sourceNames: ["unit-guide.txt"],
        anchors: [{
          sourceName: "unit-guide.txt",
          excerpt: "Cellular respiration",
          usedFor: "The uploaded guide establishes cellular respiration as the actual session scope.",
        }],
        supplements: [{ topic: "Shakespearean sonnets", reason: "This unrelated addition should never enter a biology session." }],
      },
    })).toMatch(/not clearly tied/i);
  });
});
