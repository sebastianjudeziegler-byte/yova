import { describe, expect, test, vi } from "vitest";
import { buildSessionEvaluationCases } from "@/evals/session-cases";
import { StreamedGeneratedSessionDraftSchema } from "@/lib/session-generation/schema";
import { isRubricLikeReferenceAnswer } from "@/lib/session-generation/content-specificity";

vi.mock("server-only", () => ({}));

const liveEvaluationEnabled = process.env.YOVA_RUN_LIVE_WWI_SKELETON_EVALS === "1";

describe.skipIf(!liveEvaluationEnabled)("live streamed World War I session skeleton", () => {
  test("reliably creates a valid subject-specific session outline", async () => {
    const { generateProductionSessionWithOpenAI } = await import("@/lib/openai/session-generation-strategy");
    const evaluationCase = buildSessionEvaluationCases().find(
      (candidate) => candidate.id === "world_war_one_mapped_45_min",
    );
    if (!evaluationCase) throw new Error("The exact World War I session case is missing.");

    const runs = [];
    for (let run = 1; run <= 3; run += 1) {
      const startedAt = Date.now();
      const result = await generateProductionSessionWithOpenAI(evaluationCase.context);
      const draft = StreamedGeneratedSessionDraftSchema.parse(result.draft);
      const freeResponses = draft.activities.filter((activity) => activity.type === "free_response");

      expect(draft.activities[0]?.type).toBe("instruction");
      expect(freeResponses.length).toBeGreaterThan(0);
      for (const activity of freeResponses) {
        expect(isRubricLikeReferenceAnswer(activity.correctAnswer ?? "")).toBe(false);
      }

      runs.push({
        run,
        elapsedMs: Date.now() - startedAt,
        attempts: result.generationStats.attempts,
        firstAttemptPassed: result.generationStats.firstAttemptPassed,
        repairAttempted: result.generationStats.repairAttempted,
        repairSucceeded: result.generationStats.repairSucceeded,
        failedValidator: result.generationStats.failedValidator,
      });
    }

    console.info("WWI streamed skeleton reliability", runs);
  }, 180_000);
});
