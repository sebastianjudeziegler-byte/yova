import { expect, it } from "vitest";
import captures from "./brief-0-5-rubric-captures.json";
import { evaluateSessionDraft } from "./session-rubric";
import type { SessionGenerationContext } from "@/lib/openai/session-generator";
import { StreamedGeneratedSessionDraftSchema } from "@/lib/session-generation/schema";
import type { SessionDeliveryPolicy } from "@/lib/personalization/session-delivery-policy";

it.each(["product", "javascript"] as const)("scores captured %s learner content against its current session contract", name => {
  const capture = captures[name];
  const draft = StreamedGeneratedSessionDraftSchema.parse(capture.draft);
  const result = evaluateSessionDraft(draft, capture.context as SessionGenerationContext,
    name === "product" ? "problem_solving" : "coding", [], capture.deliveryPolicy as SessionDeliveryPolicy);
  expect(result.checks.filter(check => check.required && !check.passed)).toEqual([]);
  if (name === "javascript") expect(draft.activities.some(activity => activity.correctAnswer === "filter")).toBe(true);
  if (name === "product") expect(draft.coverage.deferredContent).toContain("Connect the product rule formula to its two derivative terms");
});

it("still rejects an empty typed answer and off-topic streamed teaching", () => {
  const capture = captures.javascript;
  const draft = StreamedGeneratedSessionDraftSchema.parse(capture.draft);
  const question = draft.activities.find(activity => activity.type === "free_response")!;
  question.correctAnswer = " ";
  let result = evaluateSessionDraft(draft, capture.context as SessionGenerationContext, "coding");
  expect(result.requiredFailures).toContain("Questions include usable answers and feedback");
  const unrelated = "Photosynthesis converts sunlight to chemical energy inside chloroplasts.";
  for (const activity of draft.activities) {
    activity.title = unrelated;
    activity.body = unrelated;
    activity.correctAnswer = activity.correctAnswer ? unrelated : null;
    activity.feedback = activity.feedback ? unrelated : null;
    if (activity.lessonBrief) activity.lessonBrief.essentialIdeas = [unrelated];
  }
  result = evaluateSessionDraft(draft, capture.context as SessionGenerationContext, "coding");
  expect(result.requiredFailures).toContain("The lesson names and teaches the actual subject content");
});
