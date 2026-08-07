import { describe, expect, it } from "vitest";
import { selectFreeResponseMode } from "@/lib/learning/response-mode";

describe("free-response mode", () => {
  it("uses a workpad for a quantitative calculation", () => {
    expect(selectFreeResponseMode({
      taskType: "problem_solving",
      title: "Differentiate $x^3e^x$",
      prompt: "Show both product-rule terms before simplifying.",
      referenceAnswer: "$3x^2e^x + x^3e^x$",
    })).toBe("quantitative_workpad");
  });

  it("keeps a conceptual math explanation in the normal response format", () => {
    expect(selectFreeResponseMode({
      taskType: "problem_solving",
      title: "Why does the product rule contain two terms?",
      prompt: "Explain the structure in your own words.",
      referenceAnswer: "Each term represents one factor changing while the other remains fixed.",
    })).toBe("explanation");
  });

  it("does not turn non-math free responses into workpads", () => {
    expect(selectFreeResponseMode({
      taskType: "conceptual_learning",
      title: "Explain how glycolysis connects to later stages",
      prompt: "Rebuild the sequence from memory.",
      referenceAnswer: "Glycolysis begins in the cytoplasm and its products feed later stages.",
    })).toBe("explanation");
  });

  it("can recognize an explicit calculation when old session data has no task label", () => {
    expect(selectFreeResponseMode({
      taskType: null,
      title: "Calculate the derivative",
      prompt: "Show your work before the final answer.",
      referenceAnswer: "$2x$",
    })).toBe("quantitative_workpad");
  });
});
