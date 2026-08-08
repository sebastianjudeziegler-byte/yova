import { describe, expect, test, vi } from "vitest";
import { buildSessionEvaluationCases } from "@/evals/session-cases";
import { evaluateSessionDraft } from "@/evals/session-rubric";

vi.mock("server-only", () => ({}));

const liveEvaluationEnabled = process.env.YOVA_RUN_LIVE_SESSION_EVALS === "1";
const requestedCase = process.env.YOVA_SESSION_EVAL_CASE?.trim();
const evaluationCases = buildSessionEvaluationCases()
  .filter((evaluationCase) => !requestedCase || evaluationCase.id === requestedCase);

describe.skipIf(!liveEvaluationEnabled)("live OpenAI session quality", () => {
  test("the requested case exists", () => {
    expect(evaluationCases.length, `Unknown YOVA_SESSION_EVAL_CASE: ${requestedCase}`).toBeGreaterThan(0);
  });

  test.each(evaluationCases)("$label", async (evaluationCase) => {
    const { generateProductionSessionWithOpenAI } = await import("@/lib/openai/session-generation-strategy");
    const generated = await generateProductionSessionWithOpenAI(evaluationCase.context);
    const result = evaluateSessionDraft(
      generated.draft,
      evaluationCase.context,
      evaluationCase.taskFamily,
      evaluationCase.expectedSourceTerms,
      generated.deliveryPolicy,
    );

    console.info(`\nYOVA session evaluation · ${evaluationCase.label} · ${result.score}/100`);
    console.info(`Generation · ${generated.model} · ${(generated.generationStats.elapsedMs / 1_000).toFixed(1)}s · ${generated.generationStats.attempts} ${generated.generationStats.attempts === 1 ? "attempt" : "attempts"} · ${generated.generationStats.cachedInputTokens.toLocaleString()} cached input tokens`);
    if (generated.generationStats.repairDetail) {
      console.info(`Repair trigger · ${generated.generationStats.repairDetail}`);
    }
    for (const activity of generated.draft.activities) {
      console.info(`${activity.type.padEnd(16)} ${activity.concept ?? "none"} · ${activity.title}`);
    }
    console.info("");
    for (const check of result.checks) {
      console.info(`${check.passed ? "PASS" : "FAIL"}  ${check.label} (${check.earned}/${check.points}) · ${check.detail}`);
    }

    expect(result.requiredFailures).toEqual([]);
    expect(result.score).toBeGreaterThanOrEqual(80);
    if (evaluationCase.expectedGroundingMode) {
      expect(generated.draft.sourceGrounding?.mode).toBe(evaluationCase.expectedGroundingMode);
    }
  }, 90_000);
});
