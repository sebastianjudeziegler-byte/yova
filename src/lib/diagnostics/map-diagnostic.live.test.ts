import { describe, expect, test, vi } from "vitest";
import { PlanKnowledgeMapSchema } from "@/lib/knowledge-map/schema";

vi.mock("server-only", () => ({}));

const liveEnabled = process.env.YOVA_RUN_LIVE_DIAGNOSTIC === "1";

function map(origin: "material" | "ai_generated") {
  return PlanKnowledgeMapSchema.parse({
    version: 1,
    scopeJudgment: {
      band: "unit_or_exam",
      label: "World War I unit",
      minimumSessions: 4,
      recommendedSessions: 6,
      maximumSessions: 8,
      minimumTeachingSessions: 2,
      explanation: "The learner needs the prerequisite causes before explaining escalation and consequences.",
    },
    topics: [
      ["Long-term causes", "Explain militarism, alliances, imperial competition, and nationalism as background conditions"],
      ["July Crisis", "Trace how the assassination triggered diplomatic decisions and mobilization"],
      ["Alliance escalation", "Explain why alliance commitments and mobilization widened the conflict"],
      ["Consequences", "Connect the war's outcome to political, territorial, and social change"],
    ].map(([title, description], index) => ({
      id: `10000000-1000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      title,
      description,
      subtopics: [],
      prerequisiteTopicIds: index === 0 ? [] : [`10000000-1000-4000-8000-${String(index).padStart(12, "0")}`],
      status: "not_started",
      initialEvidence: null,
      sourceReferences: [],
      origin,
      deferred: null,
    })),
    placementCheck: { status: "available", completedAt: null, demonstratedTopicIds: [], gapTopicIds: [] },
  });
}

describe.skipIf(!liveEnabled)("live map diagnostic generation", () => {
  test.each(["material", "ai_generated"] as const)("generates from a %s map and reports latency", async (origin) => {
    const { generateMapDiagnostic } = await import("@/lib/diagnostics/map-diagnostic");
    const result = await generateMapDiagnostic(map(origin), "Prepare for a World War I unit test from the beginning").catch((error) => {
      console.error("DIAGNOSTIC_LIVE_ERROR", error instanceof Error ? error.cause : error);
      throw error;
    });
    console.info(`DIAGNOSTIC_TELEMETRY origin=${origin} elapsedMs=${result.stats.elapsedMs} inputTokens=${result.stats.inputTokens} outputTokens=${result.stats.outputTokens} questions=${result.questions.length}`);
    expect(result.questions.length).toBeGreaterThanOrEqual(4);
    expect(result.questions.every((question) => question.options.at(-1) === "I don't know yet")).toBe(true);
    expect(result.stats.elapsedMs).toBeGreaterThan(0);
  }, 60_000);
});
