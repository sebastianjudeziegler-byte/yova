import { describe, expect, test, vi } from "vitest";
import { melatoninStreamedEvaluationContext } from "@/evals/melatonin-session-case";
import { StreamedGeneratedSessionDraftSchema } from "@/lib/session-generation/schema";

vi.mock("server-only", () => ({}));

const liveEvaluationEnabled = process.env.YOVA_RUN_LIVE_MELATONIN_EVALS === "1";
describe.skipIf(!liveEvaluationEnabled)("live streamed Melatonin session skeleton", () => {
  test("reliably creates the affected 15-minute teaching-first session", async () => {
    const { generateProductionSessionWithOpenAI } = await import("@/lib/openai/session-generation-strategy");
    const requestedRunCount = Number.parseInt(process.env.YOVA_LIVE_MELATONIN_RUN_COUNT ?? "3", 10);
    const runCount = Number.isFinite(requestedRunCount)
      ? Math.min(3, Math.max(1, requestedRunCount))
      : 3;

    for (let run = 1; run <= runCount; run += 1) {
      try {
        const result = await generateProductionSessionWithOpenAI(melatoninStreamedEvaluationContext());
        const draft = StreamedGeneratedSessionDraftSchema.parse(result.draft);
        const focused = draft.activities.filter((activity) => activity.methodPhase !== "schedule_return");
        console.info("Melatonin streamed skeleton run", {
          run,
          generationStats: result.generationStats,
          deliveryModes: {
            presentation: result.deliveryPolicy.presentation.mode,
            repair: result.deliveryPolicy.repair.mode,
            retention: result.deliveryPolicy.retention.mode,
            firstActionMinutes: result.deliveryPolicy.pacing.firstActionMinutes,
            maximumActivities: result.deliveryPolicy.pacing.maximumActivities,
          },
          phases: draft.activities.map((activity) => activity.methodPhase),
          focusedMinutes: focused.reduce((total, activity) => total + activity.estimatedMinutes, 0),
        });

        expect(focused.reduce((total, activity) => total + activity.estimatedMinutes, 0)).toBe(15);
        expect(draft.activities.some((activity) => activity.methodPhase === "schedule_return")).toBe(true);
        expect(draft.activities.find((activity) => activity.methodPhase === "schedule_return"))
          .toMatchObject({ requiredForCompletion: false, estimatedMinutes: 1 });
      } catch (error) {
        console.info("Melatonin streamed skeleton failure", {
          run,
          message: error instanceof Error ? error.message : String(error),
          generationStats: error && typeof error === "object" && "generationStats" in error
            ? error.generationStats
            : null,
        });
        throw error;
      }
    }
  }, 240_000);
});
