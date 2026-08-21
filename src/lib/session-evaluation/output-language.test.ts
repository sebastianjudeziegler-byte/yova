import { describe, expect, it } from "vitest";
import {
  answerEvaluationUsesUnexpectedScript,
  containsUnexpectedNonLatinScript,
} from "@/lib/session-evaluation/output-language";

describe("answer-evaluation output language", () => {
  it("detects the Devanagari leakage seen in production", () => {
    expect(containsUnexpectedNonLatinScript("The answer does not go beyond a local घटना."))
      .toBe(true);
    expect(answerEvaluationUsesUnexpectedScript({
      verdict: "needs_review",
      feedback: "The explanation stays at a local घटना instead of the full relationship.",
      matchedIdeas: [],
      missingIdeas: ["Connect the local step to the overall result."],
    })).toBe(true);
  });

  it.each([
    "The derivative is Δy / Δx = α + β + γ + δ + 2πr.",
    "Use θ and ∫₀¹ x² dx to show the relationship.",
    "The café example establishes a cause-and-effect relationship.",
    "The value belongs to ℝ and is approximately 3.5.",
  ])("allows Latin prose and legitimate mathematical notation: %s", (value) => {
    expect(containsUnexpectedNonLatinScript(value)).toBe(false);
  });

  it.each([
    "The missing idea is причинность.",
    "The result follows from 这个关系.",
    "Αυτή η εξήγηση δεν είναι στα αγγλικά.",
  ])("rejects non-English prose written in another script: %s", (value) => {
    expect(containsUnexpectedNonLatinScript(value)).toBe(true);
  });
});
