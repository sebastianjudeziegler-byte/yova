import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildPlanEvaluationCases } from "@/evals/plan-cases";
import { generatePreviewPlan } from "@/lib/plan-generation/preview-generator";

type MatrixCaseId =
  | "product_rule_narrow_15"
  | "world_war_one_guide_15"
  | "calculus_broad_pathway_30"
  | "startup_funding_general_25";

function matrixCase(id: MatrixCaseId) {
  const found = buildPlanEvaluationCases(new Date("2026-08-08T18:00:00.000Z"))
    .find((candidate) => candidate.id === id);
  if (!found) throw new Error(`Missing journey-matrix case: ${id}`);
  return found;
}

function mappedRequest(id: MatrixCaseId) {
  const evaluationCase = matrixCase(id);
  const definitions = {
    product_rule_narrow_15: {
      band: "focused_skill" as const,
      recommended: 4,
      topics: ["Products of functions", "The product rule procedure", "Independent product rule selection"],
    },
    world_war_one_guide_15: {
      band: "unit_or_exam" as const,
      recommended: 8,
      topics: ["Long-term causes", "Alliance systems", "The July Crisis", "The Western Front", "The Eastern Front", "United States entry", "The armistice", "Consequences of the war"],
    },
    calculus_broad_pathway_30: {
      band: "broad_course" as const,
      recommended: 12,
      topics: ["Functions and graphs", "Limits", "Continuity", "Derivative from first principles", "Derivative rules", "Derivative applications", "Accumulation", "Definite integrals", "Fundamental theorem of calculus", "Cumulative transfer"],
    },
    startup_funding_general_25: {
      band: "unit_or_exam" as const,
      recommended: 7,
      topics: ["Funding purpose and stages", "Investor types", "Equity and debt", "Convertible instruments", "Dilution", "Valuation", "Term sheets"],
    },
  }[id];
  const minimum = definitions.band === "broad_course" ? 10 : definitions.band === "focused_skill" ? 2 : 4;
  const maximum = definitions.band === "broad_course" ? 14 : definitions.band === "focused_skill" ? 6 : 12;
  return {
    ...evaluationCase.request,
    knowledgeMap: {
      version: 1 as const,
      scopeJudgment: {
        band: definitions.band,
        label: definitions.band === "focused_skill" ? "Focused skill" : definitions.band === "broad_course" ? "Broad course" : "Unit or exam",
        minimumSessions: minimum,
        recommendedSessions: definitions.recommended,
        maximumSessions: maximum,
        minimumTeachingSessions: definitions.band === "broad_course" ? 4 : definitions.band === "focused_skill" ? 1 : 2,
        explanation: "The model scoped the map to the learner's stated goal and ordered it by prerequisites.",
      },
      topics: definitions.topics.map((title, index) => ({
        id: `20000000-2000-4000-8000-${String(index + 1).padStart(12, "0")}`,
        title,
        description: `Learn and produce evidence for ${title}.`,
        subtopics: [],
        prerequisiteTopicIds: index === 0 ? [] : [`20000000-2000-4000-8000-${String(index).padStart(12, "0")}`],
        status: "not_started" as const,
        initialEvidence: null,
        sourceReferences: [],
        origin: "ai_generated" as const,
        deferred: null,
      })),
      placementCheck: { status: "skipped" as const, completedAt: null, demonstratedTopicIds: [], gapTopicIds: [] },
    },
  };
}

describe("learner journey matrix", () => {
  beforeAll(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-08T18:00:00.000Z"));
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  it("keeps one narrow skill much smaller than an entire course", () => {
    const narrow = generatePreviewPlan(mappedRequest("product_rule_narrow_15"));
    const broad = generatePreviewPlan(mappedRequest("calculus_broad_pathway_30"));

    expect(narrow.kind).toBe("skill");
    expect(narrow.sessions).toHaveLength(4);
    expect(narrow.sessions.every((session) => session.estimatedMinutes <= 15)).toBe(true);
    expect(narrow.sessions.slice(0, 2).every((session) => session.learningMode === "learn")).toBe(true);
    expect(narrow.sessions.at(-1)?.learningMode).toBe("study");

    expect(broad.kind).toBe("course");
    expect(broad.sessions).toHaveLength(12);
    expect(broad.sessions.length).toBeGreaterThan(narrow.sessions.length);
    const broadKnowledgeMap = broad.knowledgeMap;
    if (!broadKnowledgeMap) throw new Error("Expected a knowledge map on the generated broad plan.");
    const broadTopicIds = broadKnowledgeMap.topics.map((topic) => topic.id);
    const scheduledOrDeferred = new Set([
      ...broad.sessions.flatMap((session) => session.topicIds ?? []),
      ...broadKnowledgeMap.topics.filter((topic) => topic.deferred).map((topic) => topic.id),
    ]);
    expect(broad.sessions.map((session) => session.title)).toEqual(expect.arrayContaining([
      expect.stringMatching(/Limits|Continuity/),
      expect.stringMatching(/Derivative rules/),
      expect.stringMatching(/Accumulation/),
      expect.stringMatching(/Cumulative transfer/),
    ]));
    expect([...scheduledOrDeferred]).toEqual(expect.arrayContaining(broadTopicIds));
  });

  it("maps every visible study-guide section into bounded sessions", () => {
    const plan = generatePreviewPlan(mappedRequest("world_war_one_guide_15"));
    const mappedTargets = plan.sessions.flatMap((session) => session.contentTargets ?? []);

    expect(mappedTargets.length).toBeGreaterThan(0);
    expect(plan.sessions.every((session) => session.estimatedMinutes <= 15)).toBe(true);
    expect(plan.sessions.every((session) => (session.contentTargets?.length ?? 0) <= 2)).toBe(true);
    expect(plan.sessions[0]?.learningMode).toBe("learn");
    expect(plan.sessions.at(-1)?.learningMode).toBe("study");
  });

  it("preserves every mapped topic while reducing topics per short session", () => {
    const shortRequest = mappedRequest("world_war_one_guide_15");
    const shortPlan = generatePreviewPlan(shortRequest);
    const longPlan = generatePreviewPlan({
      ...shortRequest,
      availability: shortRequest.availability.map((slot) => ({ ...slot, minutes: 45 })),
    });

    const mappedTopics = shortRequest.knowledgeMap.topics.map((topic) => topic.title);
    const shortTargets = shortPlan.sessions.flatMap((session) => session.contentTargets ?? []);
    const longTargets = longPlan.sessions.flatMap((session) => session.contentTargets ?? []);

    expect(shortPlan.sessions.length).toBeGreaterThanOrEqual(longPlan.sessions.length);
    expect(shortPlan.sessions.every((session) => session.estimatedMinutes <= 15)).toBe(true);
    expect(longPlan.sessions.every((session) => session.estimatedMinutes <= 45)).toBe(true);
    expect(shortTargets).toEqual(expect.arrayContaining(mappedTopics));
    expect(longTargets).toEqual(expect.arrayContaining(mappedTopics));
    expect(Math.max(...shortPlan.sessions.map((session) => session.topicIds?.length ?? 0))).toBeLessThanOrEqual(
      Math.max(...longPlan.sessions.map((session) => session.topicIds?.length ?? 0)),
    );
  });

  it("makes a general-learning pathway concrete without pretending it is a school course", () => {
    const plan = generatePreviewPlan(mappedRequest("startup_funding_general_25"));

    expect(plan.kind).toBe("topic");
    expect(plan.title).toMatch(/startup funding/i);
    expect(plan.sessions[0]?.learningMode).toBe("learn");
    expect(plan.sessions[0]?.objective).toMatch(/startup funding|funding stages|investor/i);
    expect(plan.sessions.every((session) => (
      session.contentTargets?.length && session.completionEvidence?.length
    ))).toBe(true);
  });

  it("carries learner preferences into delivery decisions without fixed-trait claims", () => {
    const plan = generatePreviewPlan(mappedRequest("world_war_one_guide_15"));
    const learnerFacingText = [
      plan.rationale,
      ...plan.sessions.map((session) => session.methodReason),
    ].join(" ");

    expect(learnerFacingText).toMatch(/big picture|overall model/i);
    expect(learnerFacingText).toMatch(/hint/i);
    expect(learnerFacingText).toMatch(/delay|few days/i);
    expect(learnerFacingText).not.toMatch(/learns? best|learning style|brain type/i);
  });
});
