import { describe, expect, it } from "vitest";
import type { LearningMaterial, LearningPlan } from "@/lib/domain";
import type { KnowledgeMapTopic } from "@/lib/knowledge-map/schema";
import { baselineSourceForTopic } from "./source-context";

const materialId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const chunkId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const text = "Glycolysis begins in the cytosol. Glucose is phosphorylated twice, split, and oxidised to pyruvate, producing NADH and a net two ATP.";

function material(overrides: Partial<LearningMaterial> = {}): LearningMaterial {
  return { id: materialId, name: "Unit 3 slides.pptx", mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", sizeBytes: 100, textContent: text, processingStatus: "ready", ...overrides };
}

function topic(overrides: Partial<KnowledgeMapTopic> = {}): KnowledgeMapTopic {
  return { id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", title: "Glycolysis", description: "How glucose becomes pyruvate.", subtopics: [], prerequisiteTopicIds: [], status: "not_started", initialEvidence: null, sourceReferences: [], origin: "material", deferred: null, ...overrides };
}

const plan = (materials: LearningMaterial[], sourceMode: LearningPlan["sourceMode"] = "user_materials") => ({ materials, sourceMode });

describe("baseline source context", () => {
  it("names topic-specific slides with their located section and returns the mapped excerpt", () => {
    const result = baselineSourceForTopic(plan([material()]), topic({ sourceReferences: [{ materialId, chunkId, chunkIndex: 0, startCharacter: 0, endCharacter: 33, locationLabel: "slides 12–20", sectionRole: "content_source" }] }));
    expect(result.description).toEqual({ name: "Unit 3 slides.pptx", kind: "slides", location: "slides 12–20" });
    expect(result.excerpts).toEqual([{ label: "Unit 3 slides.pptx · slides 12–20", text: "Glycolysis begins in the cytosol." }]);
  });

  it("describes a pasted video link as the video you added, with no excerpt", () => {
    const result = baselineSourceForTopic(plan([]), topic({ attachedSources: [{ url: "https://www.youtube.com/watch?v=abc" }] }));
    expect(result).toEqual({ description: { name: "the video you added", kind: "video", location: null }, excerpts: [] });
  });

  it("falls back to the plan's material without a location when nothing is mapped to the topic", () => {
    const result = baselineSourceForTopic(plan([material({ name: "Chapter 4.pdf", mimeType: "application/pdf" })]), topic());
    expect(result.description).toEqual({ name: "Chapter 4.pdf", kind: "document", location: null });
    expect(result.excerpts).toEqual([]);
  });

  it("has no source for a YOVA-generated plan without materials", () => {
    expect(baselineSourceForTopic(plan([], "yova_generated"), topic())).toEqual({ description: null, excerpts: [] });
    expect(baselineSourceForTopic(plan([]), null)).toEqual({ description: null, excerpts: [] });
  });

  it("bounds excerpts to eight and four thousand characters each", () => {
    const long = material({ textContent: "x".repeat(10_000) });
    const references = Array.from({ length: 10 }, (_, index) => ({ materialId, chunkId, chunkIndex: index, startCharacter: 0, endCharacter: 10_000, locationLabel: `part ${index}`, sectionRole: "content_source" as const }));
    const result = baselineSourceForTopic(plan([long]), topic({ sourceReferences: references }));
    expect(result.excerpts).toHaveLength(8);
    expect(result.excerpts.every((excerpt) => excerpt.text.length === 4_000)).toBe(true);
  });

  // Brief 1.5 item 8: "Add material" on the pre-session card attaches a file to the topic and flips the block to the source path.
  it("uses a file attached to the topic: its name, and its text as excerpts", () => {
    const attached = material({ id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", name: "My glycolysis notes.txt", mimeType: "text/plain", textContent: "y".repeat(9_000) });
    const result = baselineSourceForTopic(plan([attached], "yova_generated"), topic({ attachedSources: [{ material_id: attached.id }] }));
    expect(result.description).toEqual({ name: "My glycolysis notes.txt", kind: "notes", location: null });
    expect(result.excerpts.map((excerpt) => [excerpt.label, excerpt.text.length])).toEqual([["My glycolysis notes.txt · part 1", 4_000], ["My glycolysis notes.txt · part 2", 4_000], ["My glycolysis notes.txt · part 3", 1_000]]);
  });

  it("prefers an attached file over an attached link", () => {
    const attached = material({ id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", name: "Chapter 4.pdf", mimeType: "application/pdf" });
    const result = baselineSourceForTopic(plan([attached], "yova_generated"), topic({ attachedSources: [{ url: "https://example.com/glycolysis" }, { material_id: attached.id }] }));
    expect(result.description?.name).toBe("Chapter 4.pdf");
  });
});

