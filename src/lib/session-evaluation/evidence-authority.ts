import type { AnswerEvaluationResponse } from "@/lib/session-evaluation/schema";

export const SEMANTIC_EVALUATION_EVIDENCE_POLICY_VERSION =
  "semantic_evaluation_evidence_v1" as const;

export type SemanticEvaluationEvidenceDisposition =
  | "model_outcome"
  | "no_evidence"
  | "manual_comparison";

/**
 * An uncertain or failed semantic judgment may reveal the reference answer,
 * but it has no authority to write a correct/incorrect learning outcome.
 */
export function semanticEvaluationEvidenceDisposition({
  evaluation,
  evaluationFailed,
}: {
  evaluation: AnswerEvaluationResponse | null;
  evaluationFailed: boolean;
}): SemanticEvaluationEvidenceDisposition {
  if (evaluationFailed || evaluation?.verdict === "uncertain") {
    return "no_evidence";
  }
  if (
    evaluation?.verdict === "secure"
    || evaluation?.verdict === "needs_review"
  ) {
    return "model_outcome";
  }
  return "manual_comparison";
}
