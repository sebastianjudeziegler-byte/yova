import { describe, expect, test, vi } from "vitest";
import { completeAnswerFixtures, insufficientContextFixtures, underspecifiedAnswerFixtures } from "./grader-calibration-fixtures";
vi.mock("server-only", () => ({}));

describe.skipIf(process.env.YOVA_RUN_LIVE_ANSWER_EVALS !== "1")("live grader calibration across subjects", () => {
  test.each(completeAnswerFixtures)("complete: $label", async fixture => {
    const { evaluateAnswerWithOpenAI } = await import("@/lib/openai/answer-evaluator");
    const result = await evaluateAnswerWithOpenAI(fixture.request);
    console.info(fixture.id, result);
    expect(result.verdict).toBe("secure");
    expect(result.missingIdeas).toEqual([]);
    expect(result.matchedIdeas.length).toBeGreaterThan(0);
    expect(result.feedback).not.toMatch(/\bmissing\b|\bincomplete\b|\byou (?:need|should) (?:also |still )?(?:add|mention|include)\b/i);
  }, 90_000);

  test.each([...underspecifiedAnswerFixtures, ...insufficientContextFixtures])("insufficient: $label", async fixture => {
    const { evaluateAnswerWithOpenAI } = await import("@/lib/openai/answer-evaluator");
    const result = await evaluateAnswerWithOpenAI(fixture.request);
    console.info(fixture.id, result);
    expect(fixture.expectedVerdicts).toContain(result.verdict);
    expect(result.verdict).not.toBe("secure");
  }, 90_000);
});
