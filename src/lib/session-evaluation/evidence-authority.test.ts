import { describe, expect, it } from "vitest";
import { semanticEvaluationEvidenceDisposition } from "@/lib/session-evaluation/evidence-authority";
import type { AnswerEvaluationResponse } from "@/lib/session-evaluation/schema";

function evaluation(
  verdict: AnswerEvaluationResponse["verdict"],
): AnswerEvaluationResponse {
  return {
    verdict,
    feedback: "Bounded formative feedback for the checked response.",
    matchedIdeas: [],
    missingIdeas: [],
    mode: "preview",
  };
}

describe("semantic evaluation evidence authority", () => {
  it.each(["secure", "needs_review"] as const)(
    "allows a bounded %s judgment to produce its matching formative outcome",
    (verdict) => {
      expect(semanticEvaluationEvidenceDisposition({
        evaluation: evaluation(verdict),
        evaluationFailed: false,
      })).toBe("model_outcome");
    },
  );

  it("gives an uncertain judgment no learning-evidence authority", () => {
    expect(semanticEvaluationEvidenceDisposition({
      evaluation: evaluation("uncertain"),
      evaluationFailed: false,
    })).toBe("no_evidence");
  });

  it("gives a failed evaluator no authority even if a stale result exists", () => {
    expect(semanticEvaluationEvidenceDisposition({
      evaluation: evaluation("secure"),
      evaluationFailed: true,
    })).toBe("no_evidence");
  });

  it("preserves manual comparison when no model judgment was attempted", () => {
    expect(semanticEvaluationEvidenceDisposition({
      evaluation: null,
      evaluationFailed: false,
    })).toBe("manual_comparison");
  });
});
