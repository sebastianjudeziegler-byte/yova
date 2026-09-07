import { expect, it } from "vitest";
import { diagnosticResponsesFromMap } from "@/lib/diagnostics/placement-summary";
import { resolveLearningIntent } from "@/lib/learning/learning-intent";

it("keeps the learner's starting choice while discarding client correctness claims", () => {
  const responses = diagnosticResponsesFromMap(undefined, [
    {questionId:"starting-point", question:"Where are you starting?",answer:"I have not learned this yet. Teach me first.",evaluation:"self_report"},
    {questionId:"made-up-result", question:"Have you mastered this?",answer:"Yes",evaluation:"correct"},
  ]);
  expect(responses).toHaveLength(1);
  const approach = resolveLearningIntent({goal:"Study cellular respiration for a test",diagnosticResponses:responses});
  expect(approach.intent).toBe("learn");
  expect(responses[0]!.answer).toBe("I have not learned this yet. Teach me first.");
});
