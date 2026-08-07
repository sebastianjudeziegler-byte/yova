import { describe, expect, it } from "vitest";
import type { GeneratedSessionDraft } from "@/lib/session-generation/schema";
import { validateSessionQuestionContext } from "@/lib/session-generation/question-context";

describe("session question context", () => {
  it("rejects a delayed quantitative check with hidden values", () => {
    const draft = sessionWithQuestion({
      title: "Estimate from nearby values",
      body: "Without reopening the prior answer, choose the best estimate.",
      choices: ["0.4", "8", "4", "40"],
    });

    expect(validateSessionQuestionContext(draft)).toMatch(/previous or hidden prompt/i);
  });

  it("rejects numeric answer choices when the prompt omits the data", () => {
    const draft = sessionWithQuestion({
      title: "Choose the estimate",
      body: "Choose the best numerical answer.",
      choices: ["0.4", "8", "4", "40"],
    });

    expect(validateSessionQuestionContext(draft)).toMatch(/without supplying enough values/i);
  });

  it("accepts a self-contained quantitative question", () => {
    const draft = sessionWithQuestion({
      title: "Estimate the slope near x = 2",
      body: "For f(x) = x^2, use f(2) = 4 and f(2.1) = 4.41 to choose the closest nearby-interval slope.",
      choices: ["0.4", "8", "4.1", "40"],
    });

    expect(validateSessionQuestionContext(draft)).toBeNull();
  });
});

function sessionWithQuestion(input: { title: string; body: string; choices: string[] }) {
  return {
    activities: [{
      type: "multiple_choice",
      title: input.title,
      body: input.body,
      choices: input.choices,
    }],
  } as GeneratedSessionDraft;
}
