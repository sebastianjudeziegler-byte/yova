import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  applyDiagnosticAnswers,
  buildPreviewMapDiagnostic,
} from "@/lib/diagnostics/map-diagnostic";
import { PlanKnowledgeMapSchema } from "@/lib/knowledge-map/schema";

function map(origin: "material" | "ai_generated") {
  return PlanKnowledgeMapSchema.parse({
    version: 1,
    scopeJudgment: {
      band: "unit_or_exam",
      label: "Mapped unit",
      minimumSessions: 4,
      recommendedSessions: 6,
      maximumSessions: 8,
      minimumTeachingSessions: 2,
      explanation: "The map follows the prerequisite structure needed for the learner's stated unit goal.",
    },
    topics: [
      ["Causes", "Explain the long-term causes that made a wider conflict possible"],
      ["Escalation", "Connect alliances and mobilization to the expansion of the conflict"],
      ["Turning points", "Distinguish the military and political turning points"],
      ["Consequences", "Explain the major political and social consequences"],
    ].map(([title, description], index) => ({
      id: `10000000-1000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      title,
      description,
      subtopics: [],
      prerequisiteTopicIds: index === 0
        ? []
        : [`10000000-1000-4000-8000-${String(index).padStart(12, "0")}`],
      status: "not_started",
      initialEvidence: null,
      sourceReferences: [],
      origin,
      deferred: null,
    })),
    placementCheck: {
      status: "available",
      completedAt: null,
      demonstratedTopicIds: [],
      gapTopicIds: [],
    },
  });
}

describe("knowledge-map diagnostics", () => {
  it.each(["material", "ai_generated"] as const)(
    "generates a self-contained optional check from a %s map",
    (origin) => {
      const knowledgeMap = map(origin);
      const questions = buildPreviewMapDiagnostic(knowledgeMap);

      expect(questions.length).toBeGreaterThanOrEqual(4);
      expect(questions.length).toBeLessThanOrEqual(8);
      expect(questions.every((question) => knowledgeMap.topics.some((topic) => topic.id === question.topicId))).toBe(true);
      expect(questions.every((question) => question.options.length === 4)).toBe(true);
      expect(questions.every((question) => new Set(question.options).size === question.options.length)).toBe(true);
      expect(questions.every((question) => question.options.at(-1) === "I don't know yet")).toBe(true);
      expect(questions.every((question) => question.options.includes(question.correctAnswer))).toBe(true);
    },
  );

  it("keeps preview answer choices unique when the map has only one topic", () => {
    const knowledgeMap = PlanKnowledgeMapSchema.parse({
      ...map("ai_generated"),
      topics: map("ai_generated").topics.slice(0, 1),
    });

    const questions = buildPreviewMapDiagnostic(knowledgeMap);

    expect(questions).toHaveLength(4);
    expect(questions.every((question) => new Set(question.options).size === 4)).toBe(true);
  });

  it("skips without silently creating evidence or changing topic status", () => {
    const knowledgeMap = map("ai_generated");
    const questions = buildPreviewMapDiagnostic(knowledgeMap);
    const result = applyDiagnosticAnswers(knowledgeMap, questions, [], true);

    expect(result.responses).toEqual([]);
    expect(result.map.placementCheck.status).toBe("skipped");
    expect(result.map.placementCheck.demonstratedTopicIds).toEqual([]);
    expect(result.map.placementCheck.gapTopicIds).toEqual([]);
    expect(result.map.topics.every((topic) => topic.status === "not_started")).toBe(true);
    expect(result.map.topics.every((topic) => topic.initialEvidence === null)).toBe(true);
  });

  it("records demonstrated starting evidence and confirmed gaps without marking either secure", () => {
    const knowledgeMap = map("material");
    const questions = buildPreviewMapDiagnostic(knowledgeMap);
    const answers = questions.map((question, index) => (
      index % 2 === 0 ? question.correctAnswer : "I don't know yet"
    ));
    const result = applyDiagnosticAnswers(knowledgeMap, questions, answers, false);

    expect(result.map.placementCheck.status).toBe("completed");
    expect(result.map.placementCheck.demonstratedTopicIds.length).toBeGreaterThan(0);
    expect(result.map.placementCheck.gapTopicIds.length).toBeGreaterThan(0);
    expect(result.map.topics.some((topic) => topic.initialEvidence?.outcome === "demonstrated" && topic.status === "evidenced")).toBe(true);
    expect(result.map.topics.some((topic) => topic.initialEvidence?.outcome === "gap" && topic.status === "not_started")).toBe(true);
    expect(result.map.topics.some((topic) => topic.status === "secure")).toBe(false);
  });
});
