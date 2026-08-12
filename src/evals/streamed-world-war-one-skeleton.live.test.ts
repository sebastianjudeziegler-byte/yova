import { describe, expect, test, vi } from "vitest";
import { buildSessionEvaluationCases } from "@/evals/session-cases";
import { StreamedGeneratedSessionDraftSchema } from "@/lib/session-generation/schema";
import { isRubricLikeReferenceAnswer } from "@/lib/session-generation/content-specificity";
import { coverageTargetsMatch } from "@/lib/openai/session-generator";

vi.mock("server-only", () => ({}));

const liveEvaluationEnabled = process.env.YOVA_RUN_LIVE_WWI_SKELETON_EVALS === "1";
const exactBaselineEvaluationEnabled = process.env.YOVA_RUN_LIVE_WWI_BASELINE_EVALS === "1";

describe.skipIf(!exactBaselineEvaluationEnabled)("live exact World War I baseline skeleton", () => {
  test("creates the production 45-minute streamed teaching session", async () => {
    const { generateProductionSessionWithOpenAI } = await import("@/lib/openai/session-generation-strategy");
    const evaluationCase = buildSessionEvaluationCases().find(
      (candidate) => candidate.id === "world_war_one_mapped_45_min",
    );
    if (!evaluationCase) throw new Error("The exact World War I session case is missing.");

    try {
      const result = await generateProductionSessionWithOpenAI(evaluationCase.context);
      const draft = StreamedGeneratedSessionDraftSchema.parse(result.draft);
      console.info("Exact WWI baseline skeleton", {
        generationStats: result.generationStats,
        coverage: draft.coverage,
        activities: draft.activities.map((activity) => ({
          type: activity.type,
          phase: activity.methodPhase,
          concept: activity.concept,
          minutes: activity.estimatedMinutes,
          ideas: activity.lessonBrief?.essentialIdeas ?? [],
        })),
      });
      const focusedActivities = draft.activities.filter((activity) => activity.methodPhase !== "schedule_return");
      expect(focusedActivities.filter((activity) => (
        activity.type === "instruction" && activity.lessonBrief
      ))).toHaveLength(3);
      expect(focusedActivities.filter((activity) => (
        activity.requiredForCompletion
        && (activity.type === "multiple_choice" || activity.type === "free_response")
      ))).toHaveLength(3);
      expect(focusedActivities.reduce((total, activity) => total + activity.estimatedMinutes, 0))
        .toBe(45);
      expect(draft.coverage.essentialIdeas).toHaveLength(3);
      expect(draft.coverage.deferredContent).toEqual([]);
    } catch (error) {
      console.info("Exact WWI baseline generation failure", {
        message: error instanceof Error ? error.message : String(error),
        generationStats: error && typeof error === "object" && "generationStats" in error
          ? error.generationStats
          : null,
      });
      throw error;
    }
  }, 180_000);
});

describe.skipIf(!liveEvaluationEnabled)("live streamed World War I session skeleton", () => {
  test("reliably creates a valid subject-specific session outline", async () => {
    const { generateProductionSessionWithOpenAI } = await import("@/lib/openai/session-generation-strategy");
    const evaluationCase = buildSessionEvaluationCases().find(
      (candidate) => candidate.id === "world_war_one_mapped_45_min",
    );
    if (!evaluationCase) throw new Error("The exact World War I session case is missing.");

    const context = {
      ...evaluationCase.context,
      session: {
        ...evaluationCase.context.session,
        estimatedMinutes: 15,
      },
      sessionAdjustment: {
        familiarity: "need_teaching" as const,
        availableMinutes: 15,
        knownTargets: [],
        note: "Teach the July Crisis cause chain first. Keep this session within 15 minutes and leave later-war topics for later sessions.",
      },
    };

    const requestedRunCount = Number.parseInt(process.env.YOVA_LIVE_WWI_RUN_COUNT ?? "3", 10);
    const runCount = Number.isFinite(requestedRunCount)
      ? Math.min(3, Math.max(1, requestedRunCount))
      : 3;
    const runs = [];
    for (let run = 1; run <= runCount; run += 1) {
      const startedAt = Date.now();
      const result = await generateProductionSessionWithOpenAI(context);
      const draft = StreamedGeneratedSessionDraftSchema.parse(result.draft);
      const freeResponses = draft.activities.filter((activity) => activity.type === "free_response");
      const requiredFreeResponses = freeResponses.filter((activity) => activity.requiredForCompletion);
      const plannedTargets = context.session.contentTargets ?? [];
      const generatedCoverage = [
        ...draft.coverage.essentialIdeas,
        ...draft.coverage.deferredContent,
      ];
      const requiredMinutes = draft.activities
        .filter((activity) => activity.requiredForCompletion)
        .reduce((total, activity) => total + activity.estimatedMinutes, 0);
      const activeActivityText = JSON.stringify(draft.activities);
      const runStats = {
        run,
        elapsedMs: Date.now() - startedAt,
        attempts: result.generationStats.attempts,
        firstAttemptPassed: result.generationStats.firstAttemptPassed,
        repairAttempted: result.generationStats.repairAttempted,
        repairSucceeded: result.generationStats.repairSucceeded,
        failedValidator: result.generationStats.failedValidator,
        repairDetail: result.generationStats.repairDetail,
        requiredMinutes,
        activeIdeas: draft.coverage.essentialIdeas,
        deferredContent: draft.coverage.deferredContent,
      };
      console.info("WWI streamed skeleton run", runStats);

      expect(draft.activities[0]?.type).toBe("instruction");
      expect(freeResponses.length).toBeGreaterThan(0);
      expect(requiredFreeResponses.length).toBeGreaterThan(0);
      expect(requiredMinutes).toBeLessThanOrEqual(15);
      expect(draft.coverage.deferredContent).toContain("Basic chronology from 1914 to 1918");
      expect(activeActivityText).not.toMatch(/U\.S\. entry|United States entered|armistice|full 1914.{0,8}1918 chronology/i);
      expect(JSON.stringify(draft.coverage.completionEvidence)).not.toMatch(
        /U\.S\. entry|United States entered|armistice|full 1914.{0,8}1918 chronology/i,
      );
      for (const target of plannedTargets) {
        expect(generatedCoverage.some((item) => (
          coverageTargetsMatch(item, target) || coverageTargetsMatch(target, item)
        ))).toBe(true);
      }
      for (const activity of freeResponses) {
        expect(isRubricLikeReferenceAnswer(activity.correctAnswer ?? "")).toBe(false);
      }

      runs.push(runStats);
    }

    console.info("WWI streamed skeleton reliability", runs);
  }, 180_000);
});
