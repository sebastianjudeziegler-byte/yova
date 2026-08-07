import { describe, expect, it } from "vitest";
import {
  formatQuantitativeWork,
  parseQuantitativeWork,
} from "@/components/quantitative-workpad";

describe("quantitative workpad response format", () => {
  it("keeps numbered reasoning and the final result in one bounded answer", () => {
    const answer = formatQuantitativeWork({
      steps: ["Use the product rule", "Differentiate each factor once", ""],
      finalAnswer: "3x^2e^x + x^3e^x",
    });

    expect(answer).toBe([
      "Step 1: Use the product rule",
      "Step 2: Differentiate each factor once",
      "Final answer: 3x^2e^x + x^3e^x",
    ].join("\n"));
    expect(parseQuantitativeWork(answer)).toEqual({
      steps: ["Use the product rule", "Differentiate each factor once"],
      finalAnswer: "3x^2e^x + x^3e^x",
    });
  });

  it("can display a plain response after the learner chooses I do not know", () => {
    expect(parseQuantitativeWork("I do not know this yet.")).toEqual({
      steps: [],
      finalAnswer: "I do not know this yet.",
    });
  });

  it("keeps a multiline note inside its numbered step", () => {
    const answer = formatQuantitativeWork({
      steps: ["Write the rule\nthen substitute the factors"],
      finalAnswer: "2x",
    });

    expect(parseQuantitativeWork(answer)).toEqual({
      steps: ["Write the rule then substitute the factors"],
      finalAnswer: "2x",
    });
  });
});
