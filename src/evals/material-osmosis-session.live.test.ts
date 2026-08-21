import { describe, expect, test, vi } from "vitest";
import type { SessionGenerationContext } from "@/lib/openai/session-generator";
import { coverageTargetsMatch } from "@/lib/openai/session-generator";

vi.mock("server-only", () => ({}));

const liveEvaluationEnabled = process.env.YOVA_RUN_LIVE_OSMOSIS_EVALS === "1";

const MATERIAL_ID = "71111111-1111-4111-8111-111111111111";
const CHUNK_ID = "72222222-2222-4222-8222-222222222222";
const TOPIC_IDS = [
  "73333333-3333-4333-8333-333333333331",
  "73333333-3333-4333-8333-333333333332",
  "73333333-3333-4333-8333-333333333333",
] as const;
const TARGETS = [
  "Osmosis and water potential",
  "Tonicity and cell water movement",
  "Effects of osmosis on animal and plant cells",
] as const;
const MATERIAL_TEXT = `YOVA production walkthrough — synthetic study notes

Osmosis is the net movement of water across a selectively permeable membrane from a region of lower solute concentration to a region of higher solute concentration. Water moves down its own water-potential gradient until equilibrium is approached.

In a hypotonic environment, a cell gains water. In a hypertonic environment, it loses water. In an isotonic environment, there is no net movement of water, although molecules continue moving in both directions.

For an animal cell, too much water can cause lysis; too little causes shriveling. Plant cell walls resist expansion, so water entry produces turgor pressure.

Check for understanding: predict the direction of net water movement when a cell contains 10% solute and the surrounding solution contains 2% solute, assuming only water crosses the membrane.`;

export function materialOsmosisSessionContext(): SessionGenerationContext {
  return {
    sessionArchitectureVersion: "filled_teaching_v1",
    learningGoal: {
      title: "Biology Quiz on Osmosis",
      topic: "Osmosis, tonicity, and the effects of water movement on animal and plant cells",
      kind: "test",
      deadline: null,
      sourceMode: "user_materials",
      studyMode: "inside_yova",
      learningIntent: "study",
    },
    planRationale: "Use closed-note retrieval across the connected osmosis concepts, then repair only the relationships the learner cannot yet explain.",
    journey: {
      currentSequence: 1,
      totalSessions: 1,
      previousSessions: [],
      nextSessions: [],
    },
    materials: [{
      materialId: MATERIAL_ID,
      chunkId: CHUNK_ID,
      chunkIndex: 0,
      name: "yova-walkthrough-osmosis-notes.txt",
      text: MATERIAL_TEXT,
      truncated: false,
      locationLabel: "Uploaded text",
      role: "content_source",
    }],
    knowledgeTopics: TARGETS.map((title, index) => ({
      id: TOPIC_IDS[index]!,
      title,
      description: [
        "How water moves across a selectively permeable membrane down its water-potential gradient.",
        "How hypotonic, hypertonic, and isotonic environments change net water movement into or out of cells.",
        "How osmosis can cause lysis or shriveling in animal cells and turgor pressure in plant cells.",
      ][index]!,
      subtopics: index === 0
        ? ["selectively permeable membrane", "solute concentration", "water-potential gradient"]
        : index === 1
          ? ["hypotonic", "hypertonic", "isotonic"]
          : ["lysis", "shriveling", "turgor pressure"],
      prerequisiteTopicIds: index === 0 ? [] : [TOPIC_IDS[index - 1]!],
      status: "not_started" as const,
      initialEvidence: null,
      sourceReferences: [{
        materialId: MATERIAL_ID,
        chunkId: CHUNK_ID,
        chunkIndex: 0,
        startCharacter: 0,
        endCharacter: MATERIAL_TEXT.length,
        locationLabel: "Uploaded text",
        sectionRole: "content_source" as const,
      }],
      origin: "material" as const,
      deferred: null,
      curriculumReference: null,
    })),
    session: {
      title: "Retrieve and apply Osmosis and water potential and 2 connected topics",
      objective: "Retrieve and apply Osmosis and water potential, Tonicity and cell water movement, Effects of osmosis on animal and plant cells without notes, then repair only the gap the attempt reveals.",
      method: "Closed-note retrieval",
      methodReason: "An unsupported attempt makes the current gap visible before targeted repair.",
      estimatedMinutes: 25,
      learningMode: "study",
      topicIds: [...TOPIC_IDS],
      contentTargets: [...TARGETS],
      completionEvidence: [
        "Explain osmosis and predict net water movement without notes.",
        "Classify a solution's tonicity and explain the resulting cell water movement.",
        "Predict effects of osmosis on animal and plant cells, then repair any gap.",
      ],
      reviewConcept: null,
      reviewType: null,
    },
    learnerProfile: {
      commonBlocker: "Large tasks can feel difficult to start",
      guidancePreference: "Show one visible step at a time",
      explanationPreference: "Start with the big picture before details",
      focusFrequency: "Often studies in fifteen-minute windows",
      startingPattern: "Starts more consistently when the first action is small",
      primaryImprovementGoal: "Recall and apply concepts without relying on rereading",
    },
    sessionAdjustment: {
      familiarity: "as_planned",
      availableMinutes: 15,
      knownTargets: [],
      note: "",
    },
    recentResults: [],
    recentInterruptions: [],
    conceptSignals: [],
    scaffoldSignals: [],
    topicCalibrationSignals: [],
  };
}

describe.skipIf(!liveEvaluationEnabled)("live shortened material-backed osmosis session", () => {
  test("keeps two current targets and defers the third in a 15-minute window", async () => {
    const { generateProductionSessionWithOpenAI } = await import(
      "@/lib/openai/session-generation-strategy"
    );
    const requestedRunCount = Number.parseInt(
      process.env.YOVA_LIVE_OSMOSIS_RUN_COUNT ?? "1",
      10,
    );
    const runCount = Number.isFinite(requestedRunCount)
      ? Math.min(5, Math.max(1, requestedRunCount))
      : 1;

    for (let run = 1; run <= runCount; run += 1) {
      let result;
      try {
        result = await generateProductionSessionWithOpenAI(materialOsmosisSessionContext());
      } catch (error) {
        console.info("Shortened material-backed osmosis session failure", {
          run,
          message: error instanceof Error ? error.message : String(error),
          generationStats: error && typeof error === "object" && "generationStats" in error
            ? error.generationStats
            : null,
        });
        throw error;
      }
      console.info("Shortened material-backed osmosis session", {
        run,
        generationStats: result.generationStats,
        topicIds: result.draft.topicIds,
        coverage: result.draft.coverage,
      });

      expect(result.draft.topicIds).toEqual(TOPIC_IDS.slice(0, 2));
      expect(result.draft.coverage.essentialIdeas.length).toBeLessThanOrEqual(2);
      expect(result.draft.coverage.deferredContent).toEqual([TARGETS[2]]);
      expect(result.draft.coverage.essentialIdeas.some((idea) => (
        coverageTargetsMatch(idea, TARGETS[2])
      ))).toBe(false);
      expect(result.draft.sourceGrounding?.mode).toBe("materials_only");
    }
  }, 180_000);
});
