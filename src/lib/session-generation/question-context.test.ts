import { describe, expect, it } from "vitest";
import type { GeneratedSessionDraft } from "@/lib/session-generation/schema";
import { validateSessionQuestionContext } from "@/lib/session-generation/question-context";

describe("session question context", () => {
  it("accepts factual year recall without demanding arithmetic operands", () => {
    const draft = sessionWithQuestion({ title: "Identify the war's end year", body: "In which year did World War I end?", choices: ["1914", "1916", "1918", "1920"] });
    expect(validateSessionQuestionContext(draft)).toBeNull();
  });

  it("still requires supplied values when calculating a year", () => {
    const draft = sessionWithQuestion({ title: "Calculate the year", body: "In which year will the loan end after all its payments?", choices: ["2028", "2029", "2030", "2031"] });
    expect(validateSessionQuestionContext(draft)).toMatch(/without supplying enough values/);
  });
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
