import { describe, expect, it } from "vitest";
import type { KnowledgeMapTopic } from "@/lib/knowledge-map/schema";
import { mapTargetsToKnowledgeTopics } from "@/lib/learning/target-topic-mapping";

const TOPIC_A = "00000000-0000-4000-8000-000000000001";
const TOPIC_B = "00000000-0000-4000-8000-000000000002";

function topic(overrides: Partial<KnowledgeMapTopic>): KnowledgeMapTopic {
  return {
    id: TOPIC_A,
    title: "Cellular respiration",
    description: "How cells release energy from glucose through linked biochemical stages.",
    subtopics: ["Glycolysis inputs and outputs", "Krebs cycle location"],
    prerequisiteTopicIds: [],
    status: "not_started",
    initialEvidence: null,
    sourceReferences: [],
    origin: "ai_generated",
    deferred: null,
    ...overrides,
  };
}

describe("authoritative target-to-topic mapping", () => {
  it("maps reversed targets by subject meaning rather than array position", () => {
    const respiration = topic({});
    const finance = topic({
      id: TOPIC_B,
      title: "Financial statements",
      description: "How the balance sheet and income statement represent company performance.",
      subtopics: ["Revenue recognition", "Assets and liabilities"],
    });

    const result = mapTargetsToKnowledgeTopics(
      ["Explain revenue recognition", "Retrieve glycolysis inputs and outputs"],
      [respiration, finance],
    );

    expect(result.issue).toBeNull();
    expect(result.assignments.map(({ topic: assignedTopic }) => assignedTopic.id)).toEqual([
      TOPIC_B,
      TOPIC_A,
    ]);
  });

  it.each([
    ["Explain the core idea", "zero subject overlap"],
    ["Compare energy and outputs", "ambiguous subject overlap"],
  ])("fails closed for %s instead of guessing from %s", (target) => {
    const result = mapTargetsToKnowledgeTopics(
      [target],
      [
        topic({
          description: "Energy conversion and important outputs in the respiration pathway.",
        }),
        topic({
          id: TOPIC_B,
          title: "Photosynthesis",
          description: "Energy conversion and important outputs in the photosynthesis pathway.",
          subtopics: ["Light reactions", "Calvin cycle"],
        }),
      ],
    );

    expect(result.assignments).toEqual([]);
    expect(result.issue).toContain("could not uniquely bind target 1");
  });

  it("ignores instructional boilerplate when deciding evidence attribution", () => {
    const result = mapTargetsToKnowledgeTopics(
      ["Explain, compare, and verify the concept independently"],
      [
        topic({
          title: "Market segmentation",
          description: "Explain and compare how customer groups differ.",
          subtopics: [],
        }),
        topic({
          id: TOPIC_B,
          title: "Cell division",
          description: "Explain and compare how mitosis stages differ.",
          subtopics: [],
        }),
      ],
    );

    expect(result.assignments).toEqual([]);
    expect(result.issue).not.toBeNull();
  });

  it("rejects a detailed rules target when two topics have the same lexical evidence", () => {
    const result = mapTargetsToKnowledgeTopics(
      ["Apply constant, power, constant-multiple, and sum or difference rules"],
      [
        topic({
          title: "Basic derivative rules",
          description: "Differentiate simple functions using the power rule and linearity before combining rules.",
          subtopics: [],
        }),
        topic({
          id: TOPIC_B,
          title: "Polynomial calculation rules",
          description: "Use the power rule and linearity when calculating changes in polynomial expressions.",
          subtopics: [],
        }),
      ],
    );

    expect(result.assignments).toEqual([]);
    expect(result.issue).toContain("could not uniquely bind target 1");
  });
});
