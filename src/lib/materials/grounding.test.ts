import { describe, expect, it } from "vitest";
import {
  bindSessionSourceGroundingToMaterials,
  buildMaterialSupportPolicy,
  validateSessionSourceGrounding,
} from "@/lib/materials/grounding";

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
  it("binds model provenance fields to the exact mapped database chunk", () => {
    const grounding = bindSessionSourceGroundingToMaterials({
      materials: explanatoryMaterial,
      focus: "Osmosis and water potential",
      grounding: {
        mode: "materials_only",
        summary: "The lesson uses the learner's complete source notes for the bounded explanation and checks.",
        sourceNames: ["complete-notes.txt"],
        anchors: [{
          chunkId: "44444444-4444-4444-8444-444444444444",
          sourceName: "complete-notes.txt",
          locationLabel: "Characters 1-7000",
          excerpt: "Section zero explains how the mechanism changes its input.",
          usedFor: "The provider attempted to transcribe the mapped source section.",
        }],
        supplements: [],
      },
    });

    expect(grounding?.anchors[0]).toMatchObject({
      chunkId: explanatoryMaterial[0]!.chunkId,
      sourceName: explanatoryMaterial[0]!.name,
      locationLabel: explanatoryMaterial[0]!.locationLabel,
      excerpt: explanatoryMaterial[0]!.text.slice(0, 220).trim(),
    });
    expect(validateSessionSourceGrounding({
      sourceMode: "user_materials",
      materials: explanatoryMaterial,
      grounding,
    })).toBeNull();
  });

  it("accepts an exact legacy excerpt when older material has no persisted chunk metadata", () => {
    const legacyMaterial = [{
      role: "scope_outline" as const,
      name: "World War I guide.pdf",
      text: "Militarism and alliances increased European tensions before the July Crisis.",
      truncated: false,
    }];

    expect(validateSessionSourceGrounding({
      sourceMode: "user_materials",
      materials: legacyMaterial,
      grounding: {
        mode: "materials_plus_ai",
        summary: "The study guide defines the scope while YOVA provides the instruction for the listed causes.",
        sourceNames: ["World War I guide.pdf"],
        anchors: [{
          chunkId: "00000000-0000-4000-8000-123456789abc",
          sourceName: "World War I guide.pdf",
          locationLabel: "Uploaded material",
          excerpt: "Militarism and alliances increased European tensions",
          usedFor: "This exact excerpt defines the causes that belong in the lesson.",
        }],
        supplements: [{
          topic: "Militarism and alliances",
          reason: "The guide names these causes but needs full instruction about how they increased tensions.",
        }],
      },
    })).toBeNull();
  });

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

  it("allows only explicitly named AI-origin targets beside substantial mapped material", () => {
    const mixedGrounding = {
      mode: "materials_plus_ai" as const,
      summary: "The uploaded notes ground the mapped material target. The AI-origin FADH2 target uses disclosed model knowledge and is not attributed to those notes.",
      sourceNames: ["complete-notes.txt"],
      anchors: [{
        chunkId: "44444444-4444-4444-8444-444444444444",
        sourceName: "complete-notes.txt",
        locationLabel: "Characters 1-7000",
        excerpt: "Section 0 explains how a mechanism changes inputs into outputs",
        usedFor: "This exact passage grounds the mapped material target.",
      }],
      supplements: [{
        topic: "FADH2 formation",
        reason: "This target is AI-origin, so it uses disclosed model knowledge rather than the uploaded notes.",
      }],
    };

    expect(validateSessionSourceGrounding({
      sourceMode: "user_materials",
      materials: explanatoryMaterial,
      grounding: mixedGrounding,
      modelKnowledgeTopics: ["FADH2 formation"],
      materialTopicRequirements: [{
        topic: "Mapped mechanism",
        chunkIds: ["44444444-4444-4444-8444-444444444444"],
      }],
    })).toBeNull();

    expect(validateSessionSourceGrounding({
      sourceMode: "user_materials",
      materials: explanatoryMaterial,
      grounding: mixedGrounding,
      modelKnowledgeTopics: ["FADH2 formation"],
      materialTopicRequirements: [{
        topic: "Second mapped topic",
        chunkIds: ["55555555-5555-4555-8555-555555555555"],
      }],
    })).toMatch(/outside the active topics|needs at least one authoritative source anchor/i);

    expect(validateSessionSourceGrounding({
      sourceMode: "user_materials",
      materials: explanatoryMaterial,
      grounding: {
        ...mixedGrounding,
        supplements: [
          ...mixedGrounding.supplements,
          { topic: "Unlisted extension", reason: "This was not part of the authoritative AI-origin target contract." },
        ],
      },
      modelKnowledgeTopics: ["FADH2 formation"],
    })).toMatch(/only the explicitly named AI-origin targets/i);
  });

  it("requires a separate authoritative anchor for every active material-backed topic", () => {
    const secondMaterial = {
      ...explanatoryMaterial[0]!,
      materialId: "55555555-5555-4555-8555-555555555555",
      chunkId: "66666666-6666-4666-8666-666666666666",
      name: "second-topic-notes.txt",
      locationLabel: "Second mapped topic",
      text: "A second explanatory source section gives the mechanism, evidence, and worked relationship for its own active topic.",
    };
    expect(validateSessionSourceGrounding({
      sourceMode: "user_materials",
      materials: [...explanatoryMaterial, secondMaterial],
      grounding: {
        mode: "materials_plus_ai",
        summary: "The uploaded notes ground mapped targets. AI-origin targets use disclosed model knowledge and are not attributed to those sources.",
        sourceNames: ["complete-notes.txt"],
        anchors: [{
          chunkId: explanatoryMaterial[0]!.chunkId,
          sourceName: explanatoryMaterial[0]!.name,
          locationLabel: explanatoryMaterial[0]!.locationLabel,
          excerpt: explanatoryMaterial[0]!.text.slice(0, 220),
          usedFor: "This exact source section grounds only the first active material-backed topic.",
        }],
        supplements: [{
          topic: "AI-origin extension",
          reason: "This exact active target is AI-origin and uses disclosed model knowledge.",
        }],
      },
      modelKnowledgeTopics: ["AI-origin extension"],
      materialTopicRequirements: [{
        topic: "First mapped topic",
        chunkIds: [explanatoryMaterial[0]!.chunkId!],
      }, {
        topic: "Second mapped topic",
        chunkIds: [secondMaterial.chunkId],
      }],
    })).toMatch(/second mapped topic.*authoritative source anchor/i);
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
