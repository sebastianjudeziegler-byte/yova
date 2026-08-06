import { describe, expect, test, vi } from "vitest";
import { buildPlanEvaluationCases } from "@/evals/plan-cases";
import { evaluatePlanDraft } from "@/evals/plan-rubric";

vi.mock("server-only", () => ({}));

const liveEvaluationEnabled = process.env.YOVA_RUN_LIVE_EVALS === "1";
const requestedCase = process.env.YOVA_EVAL_CASE?.trim();
const evaluationCases = buildPlanEvaluationCases()
  .filter((evaluationCase) => !requestedCase || evaluationCase.id === requestedCase);

describe.skipIf(!liveEvaluationEnabled)("live OpenAI plan quality", () => {
  test("the requested case exists", () => {
    expect(evaluationCases.length, `Unknown YOVA_EVAL_CASE: ${requestedCase}`).toBeGreaterThan(0);
  });

  test.each(evaluationCases)("$label", async (evaluationCase) => {
    const { generatePlanWithOpenAI } = await import("@/lib/openai/plan-generator");
    const generated = await generatePlanWithOpenAI(evaluationCase.request);
    const result = evaluatePlanDraft(generated.draft, evaluationCase.request, evaluationCase.taskFamily);

    console.info(`\nYOVA plan evaluation · ${evaluationCase.label} · ${result.score}/100`);
    for (const check of result.checks) {
      console.info(`${check.passed ? "PASS" : "FAIL"}  ${check.label} (${check.earned}/${check.points}) · ${check.detail}`);
    }

    expect(result.requiredFailures).toEqual([]);
    expect(result.score).toBeGreaterThanOrEqual(80);
  }, 90_000);
});
