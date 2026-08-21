import { describe, expect, it } from "vitest";
import {
  MaterialPlanRebuildRequiredError,
  reconcileMappedMaterialsIntoActivePlan,
} from "@/lib/materials/active-plan-attachment";
import {
  buildMappedSessionSourceGrounding,
  validateSessionSourceGrounding,
} from "@/lib/materials/grounding";
import type { MaterialUnderstanding, PlanKnowledgeMap } from "@/lib/knowledge-map/schema";

const PLAN_TOPIC_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_TOPIC_ID = "22222222-2222-4222-8222-222222222222";
const MATERIAL_ID = "33333333-3333-4333-8333-333333333333";
const MATERIAL_TOPIC_ID = "44444444-4444-4444-8444-444444444444";
const CHUNK_ID = "55555555-5555-4555-8555-555555555555";

describe("active-plan material reconciliation", () => {
  it("binds an arbitrary mapped source to the existing unfinished topic identity", () => {
    const reconciled = reconcileMappedMaterialsIntoActivePlan({
      knowledgeMap: map(),
      understandings: [understanding({
        title: "Collision resolution in hash tables",
        description: "Compare separate chaining and open addressing when hash keys collide.",
        subtopics: ["Separate chaining", "Open addressing"],
      })],
      unfinishedTopicIds: [PLAN_TOPIC_ID],
    });

    expect(reconciled.topics[0]).toMatchObject({
      id: PLAN_TOPIC_ID,
      origin: "material",
      sourceReferences: [{ materialId: MATERIAL_ID, chunkId: CHUNK_ID }],
    });
    expect(reconciled.topics[1]?.sourceReferences).toEqual([]);
  });

  it("carries the attached durable chunk through the session-start grounding contract", () => {
    const reconciled = reconcileMappedMaterialsIntoActivePlan({
      knowledgeMap: map(),
      understandings: [understanding({
        title: "Collision resolution in hash tables",
        description: "Compare separate chaining and open addressing when hash keys collide.",
        subtopics: ["Separate chaining", "Open addressing"],
      })],
      unfinishedTopicIds: [PLAN_TOPIC_ID],
    });
    const sessionTopics = reconciled.topics.filter((topic) => topic.id === PLAN_TOPIC_ID);
    const orderedChunkIds = [...new Set(sessionTopics.flatMap((topic) => (
      topic.sourceReferences.map((reference) => reference.chunkId)
    )))];
    const materials = orderedChunkIds.map((chunkId) => ({
      materialId: MATERIAL_ID,
      chunkId,
      chunkIndex: 0,
      name: "hash-table-notes.md",
      text: "Separate chaining stores colliding keys in a bucket, while open addressing probes for another slot.",
      truncated: false,
      locationLabel: "Characters 1-800",
      role: "content_source" as const,
    }));
    const grounding = buildMappedSessionSourceGrounding({
      materials,
      focus: sessionTopics[0]!.title,
    });

    expect(orderedChunkIds).toEqual([CHUNK_ID]);
    expect(grounding?.anchors).toEqual([
      expect.objectContaining({ chunkId: CHUNK_ID, sourceName: "hash-table-notes.md" }),
    ]);
    expect(validateSessionSourceGrounding({
      sourceMode: "user_materials",
      materials,
      grounding,
    })).toBeNull();
  });

  it("fails closed when the source adds a topic outside the current plan", () => {
    expect(() => reconcileMappedMaterialsIntoActivePlan({
      knowledgeMap: map(),
      understandings: [understanding({
        title: "Plate tectonics and subduction zones",
        description: "Explain how convergent plate boundaries recycle oceanic crust.",
        subtopics: ["Mantle convection"],
      })],
      unfinishedTopicIds: [PLAN_TOPIC_ID],
    })).toThrow(MaterialPlanRebuildRequiredError);
  });

  it("does not rewrite completed-only scope and call it attached", () => {
    expect(() => reconcileMappedMaterialsIntoActivePlan({
      knowledgeMap: map(),
      understandings: [understanding({
        title: "Collision handling in hash tables",
        description: "Compare separate chaining with open addressing for collisions.",
        subtopics: ["Separate chaining"],
      })],
      unfinishedTopicIds: [OTHER_TOPIC_ID],
    })).toThrow(/already completed/);
  });

  it("keeps completed topic provenance unchanged when the source also supports future work", () => {
    const original = map();
    const reconciled = reconcileMappedMaterialsIntoActivePlan({
      knowledgeMap: original,
      understandings: [{
        ...understanding({
          title: "Hash table load factor",
          description: "Relate load factor to collision frequency and resizing decisions.",
          subtopics: ["Load factor"],
        }),
        topics: [
          understanding({
            title: "Collision resolution in hash tables",
            description: "Compare separate chaining and open addressing when hash keys collide.",
            subtopics: ["Separate chaining"],
          }).topics[0]!,
          understanding({
            title: "Hash table load factor",
            description: "Relate load factor to collision frequency and resizing decisions.",
            subtopics: ["Load factor"],
          }).topics[0]!,
        ],
      }],
      unfinishedTopicIds: [OTHER_TOPIC_ID],
    });

    expect(reconciled.topics[0]).toEqual(original.topics[0]);
    expect(reconciled.topics[1]).toMatchObject({
      id: OTHER_TOPIC_ID,
      origin: "material",
      sourceReferences: [{ materialId: MATERIAL_ID, chunkId: CHUNK_ID }],
    });
  });
});

function map(): PlanKnowledgeMap {
  return {
    version: 1,
    scopeJudgment: {
      band: "focused_skill",
      label: "Hash table collisions",
      minimumSessions: 1,
      recommendedSessions: 2,
      maximumSessions: 3,
      minimumTeachingSessions: 1,
      explanation: "The learner needs one bounded comparison followed by an independent application.",
    },
    topics: [{
      id: PLAN_TOPIC_ID,
      title: "Hash table collision strategies",
      description: "Explain and compare separate chaining and open addressing after a key collision.",
      subtopics: ["Separate chaining", "Open addressing"],
      prerequisiteTopicIds: [],
      status: "not_started",
      initialEvidence: null,
      sourceReferences: [],
      origin: "ai_generated",
      deferred: null,
    }, {
      id: OTHER_TOPIC_ID,
      title: "Hash table load factor",
      description: "Relate load factor to collision frequency and resizing decisions.",
      subtopics: ["Load factor"],
      prerequisiteTopicIds: [PLAN_TOPIC_ID],
      status: "not_started",
      initialEvidence: null,
      sourceReferences: [],
      origin: "ai_generated",
      deferred: null,
    }],
    placementCheck: {
      status: "available",
      completedAt: null,
      demonstratedTopicIds: [],
      gapTopicIds: [],
    },
  };
}

function understanding(topic: { title: string; description: string; subtopics: string[] }): MaterialUnderstanding {
  return {
    version: 1,
    role: "content_source",
    roleReason: "The source contains explanations and examples that can teach the mapped topic.",
    mixedSections: [],
    chunkCount: 1,
    mappedAt: "2026-08-21T12:00:00.000Z",
    topics: [{
      id: MATERIAL_TOPIC_ID,
      ...topic,
      prerequisiteTopicIds: [],
      status: "not_started",
      initialEvidence: null,
      sourceReferences: [{
        materialId: MATERIAL_ID,
        chunkId: CHUNK_ID,
        chunkIndex: 0,
        startCharacter: 0,
        endCharacter: 800,
        locationLabel: "Characters 1-800",
        sectionRole: "content_source",
      }],
      origin: "material",
      deferred: null,
    }],
  };
}
