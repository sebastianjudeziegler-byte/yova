import type { AnswerEvaluationDraft, AnswerEvaluationRequest } from "@/lib/session-evaluation/schema";

const STOP_WORDS = new Set([
  "about", "after", "again", "also", "because", "before", "being", "between",
  "could", "does", "during", "each", "from", "have", "into", "more", "most",
  "other", "should", "than", "that", "their", "then", "there", "these", "they",
  "this", "through", "using", "what", "when", "where", "which", "while", "with",
  "would", "your",
]);

export function evaluatePreviewAnswer(request: AnswerEvaluationRequest): AnswerEvaluationDraft {
  const referenceTokens = meaningfulTokens(request.activity.referenceAnswer);
  const learnerTokens = meaningfulTokens(request.learnerAnswer);
  const matched = [...referenceTokens].filter((token) => learnerTokens.has(token));
  const coverage = referenceTokens.size ? matched.length / referenceTokens.size : 0;
  const verdict = coverage >= 0.34 || normalized(request.learnerAnswer).includes(normalized(request.activity.referenceAnswer))
    ? "secure"
    : coverage >= 0.16
      ? "uncertain"
      : "needs_review";

  return {
    verdict,
    feedback: verdict === "secure"
      ? "Your explanation includes the central relationship in the reference answer. Compare the wording below and correct any detail you intended differently."
      : verdict === "uncertain"
        ? "Your explanation overlaps with part of the reference answer, but YOVA cannot confirm the full key idea from this response alone. Compare it carefully below."
        : "Your explanation does not yet show enough of the reference answer's central idea. Use the comparison below to identify the missing relationship.",
    matchedIdeas: matched.slice(0, 3).map((token) => `You included the idea connected to “${token}.”`),
    missingIdeas: verdict === "secure"
      ? []
      : [...referenceTokens]
        .filter((token) => !learnerTokens.has(token))
        .slice(0, 2)
        .map((token) => `Check the part of the answer involving “${token}.”`),
  };
}

function meaningfulTokens(value: string) {
  return new Set(
    normalized(value)
      .split(" ")
      .filter((token) => token.length >= 4 && !STOP_WORDS.has(token)),
  );
}

function normalized(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9%]+/g, " ")
    .trim();
}
