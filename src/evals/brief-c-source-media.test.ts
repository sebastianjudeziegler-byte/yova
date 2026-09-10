import { describe, expect, it, vi } from "vitest";
import { buildTopicMaterialExcerpts } from "@/lib/materials/context";
import { planBlockContents } from "@/lib/session-blocks/plan";
import { blockFixture, BLOCK_TOPIC_ID } from "./brief-c-block-fixture";
import type { SessionGenerationContext } from "@/lib/openai/session-generator";
import { generationContext } from "./brief-c-generation-fixture";
vi.mock("server-only", () => ({}));

describe("Brief C already-usable source delivery", () => {
  it("opens an explicitly attached ready file without inventing a map reference or borrowing a neighboring file", () => {
    const context = generationContext(1);
    const original = context.materials[0]!;
    context.knowledgeTopics[0]!.sourceReferences = [];
    const input = {
      chunkRows: [
        { id: "foreign-chunk", material_id: "foreign-file", chunk_index: 0, location_label: "Unrelated section", section_role: "content_source" as const, chunk_text: "An unrelated photosynthesis source must not enter ATP practice." },
        { id: original.chunkId!, material_id: original.materialId!, chunk_index: 0, location_label: "ATP section", section_role: "content_source" as const, chunk_text: original.text },
      ], materialNames: new Map([[original.materialId!, original.name]]), orderedChunkIds: [],
      attachedMaterialIds: [original.materialId!],
    };
    context.materials = buildTopicMaterialExcerpts(input);
    const plan = planBlockContents(context);
    expect(plan.sources.map(source => source.materialId)).toEqual([original.materialId]);
    expect(plan.sources[0]!.text).toBe(original.text);
    expect(plan.sources[0]!.section).toBe("ATP section");
    expect(plan.explanationTopicIds).toEqual([]);
    expect(context.knowledgeTopics[0]!.sourceReferences).toEqual([]);
  });

  it("does not silently omit a second attached source or substitute another section for an exact map reference", () => {
    const context = generationContext(1);
    context.knowledgeTopics[0]!.attachedSources!.push({ material_id: "c0000000-0000-4000-8000-000000000009" });
    expect(() => planBlockContents(context)).toThrow(/source section is not ready/);
    const mapped = generationContext(1);
    mapped.knowledgeTopics[0]!.sourceReferences.push({ ...mapped.knowledgeTopics[0]!.sourceReferences[0]!, chunkId: "c0000000-0000-4000-8000-000000000008" });
    expect(() => planBlockContents(mapped)).toThrow(/source section is not ready/);
  });
  it("opens the assigned usable YouTube transcript as a watch section before practice", () => {
    const fixture = blockFixture(); const source = fixture.block.sources[0]!;
    const chunkId = "c0000000-0000-4000-8000-000000000005";
    const url = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
    // This is existing ingestion metadata, not a fetch or new upload format.
    const input = { chunkRows: [{ id: chunkId, material_id: source.materialId, chunk_index: 0, location_label: "02:00–03:30", section_role: "content_source" as const, chunk_text: source.text }],
      materialNames: new Map([[source.materialId, "ATP lecture transcript.txt"]]), orderedChunkIds: [chunkId],
      materialMetadata: new Map([[source.materialId, { sourceKind: "youtube", sourceTitle: "ATP energy transfer", sourceUrl: url }]]),
    };
    const materials = buildTopicMaterialExcerpts(input);
    const context: SessionGenerationContext = {
      learningGoal: { title: "AP Biology", topic: "ATP", kind: "course", deadline: null, sourceMode: "user_materials", studyMode: "inside_yova", learningIntent: "learn" },
      planRationale: "Use the assigned video section.",
      session: { title: "ATP", objective: fixture.block.objective, method: "Retrieval Practice", methodReason: "Retrieve the energy relationship.", estimatedMinutes: 20, learningMode: "learn", topicIds: [BLOCK_TOPIC_ID] },
      knowledgeTopics: [{ id: BLOCK_TOPIC_ID, title: "ATP energy transfer", description: fixture.block.objective, subtopics: [], prerequisiteTopicIds: [], status: "not_started", initialEvidence: null, deferred: null, origin: "material", attachedSources: [{ material_id: source.materialId }], sourceReferences: [{ materialId: source.materialId, chunkId, chunkIndex: 0, startCharacter: 0, endCharacter: source.text.length, locationLabel: "02:00–03:30", sectionRole: "content_source" }] }],
      materials, learnerProfile: null, recentResults: [], recentInterruptions: [], conceptSignals: [],
    };
    const plan = planBlockContents(context);
    expect(plan.sources[0]!.kind).toBe("watch_source_section");
    expect(plan.sources[0]!.url).toBe(url);
    expect(plan.sources[0]!.section).toBe("02:00–03:30");
    expect(plan.explanationTopicIds).toEqual([]);
    expect(plan.slots.every(slot => slot.sourceIds.includes(plan.sources[0]!.id))).toBe(true);
  });
});
