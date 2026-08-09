import { describe, expect, it } from "vitest";
import { buildMaterialSupportPolicy, validateSessionSourceGrounding } from "@/lib/materials/grounding";

const outlineMaterial = [{
  materialId: "11111111-1111-4111-8111-111111111111",
  chunkId: "22222222-2222-4222-8222-222222222222",
  chunkIndex: 0,
  locationLabel: "Characters 1-120",
  role: "scope_outline" as const,
  name: "unit-guide.txt",
  text: "Cellular respiration\n- Glycolysis\n- Krebs cycle\n- Electron transport chain\nKnow the location and purpose of each stage.",
  truncated: false,
}];

const explanatoryMaterial = [{
  materialId: "33333333-3333-4333-8333-333333333333",
  chunkId: "44444444-4444-4444-8444-444444444444",
  chunkIndex: 0,
  locationLabel: "Characters 1-7000",
  role: "content_source" as const,
  name: "complete-notes.txt",
  text: Array.from({ length: 90 }, (_, index) => `Section ${index} explains how a mechanism changes inputs into outputs with evidence, examples, and a clear causal relationship.`).join("\n"),
  truncated: false,
}];

describe("material support policy", () => {
  it("allows bounded teaching support for a rough outline", () => {
    expect(buildMaterialSupportPolicy(outlineMaterial)).toMatchObject({
      supplementationAllowed: true,
      supplementationRequiredForTeaching: true,
    });
  });

  it("keeps a substantial explanatory source material-only", () => {
    expect(buildMaterialSupportPolicy(explanatoryMaterial)).toMatchObject({
      supplementationAllowed: false,
      supplementationRequiredForTeaching: false,
    });
  });
});

describe("session source grounding", () => {
  it("accepts a verified source anchor and a disclosed supplement for an outline", () => {
    expect(validateSessionSourceGrounding({
      sourceMode: "user_materials",
      materials: outlineMaterial,
      grounding: {
        mode: "materials_plus_ai",
        summary: "The study guide defines the scope while YOVA provides the instruction for the listed stages.",
        sourceNames: ["unit-guide.txt"],
        anchors: [{
          chunkId: "22222222-2222-4222-8222-222222222222",
          sourceName: "unit-guide.txt",
          locationLabel: "Characters 1-120",
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
        anchors: [{ chunkId: "22222222-2222-4222-8222-222222222222", sourceName: "unit-guide.txt", locationLabel: "Characters 1-120", excerpt: "This sentence was never uploaded.", usedFor: "An unsupported claim about the session scope." }],
        supplements: [],
      },
    })).toMatch(/could not be verified/i);
  });

  it("requires disclosed teaching support when a new learner uploads only an outline", () => {
    expect(validateSessionSourceGrounding({
      sourceMode: "user_materials",
      materials: outlineMaterial,
      grounding: {
        mode: "materials_only",
        summary: "The session claims the short outline contains enough detail to teach the complete process.",
        sourceNames: ["unit-guide.txt"],
        anchors: [{
          chunkId: "22222222-2222-4222-8222-222222222222",
          sourceName: "unit-guide.txt",
          locationLabel: "Characters 1-120",
          excerpt: "Know the location and purpose of each stage.",
          usedFor: "The line defines the requested scope but does not teach the process itself.",
        }],
        supplements: [],
      },
    })).toMatch(/must disclose that it supplied the instructional substance/i);
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
          chunkId: "44444444-4444-4444-8444-444444444444",
          sourceName: "complete-notes.txt",
          locationLabel: "Characters 1-7000",
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
        summary: "The guide defines the scope while YOVA provides the instruction needed to learn each listed topic.",
        sourceNames: ["unit-guide.txt"],
        anchors: [{
          chunkId: "22222222-2222-4222-8222-222222222222",
          sourceName: "unit-guide.txt",
          locationLabel: "Characters 1-120",
          excerpt: "Cellular respiration",
          usedFor: "The uploaded guide establishes cellular respiration as the actual session scope.",
        }],
        supplements: [{ topic: "Shakespearean sonnets", reason: "This unrelated addition should never enter a biology session." }],
      },
    })).toMatch(/not clearly tied/i);
  });
});
