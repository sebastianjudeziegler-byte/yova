import type { AnswerEvaluationDraft } from "@/lib/session-evaluation/schema";

const LETTER = /\p{Letter}/u;
const LATIN = /\p{Script_Extensions=Latin}/u;
const COMMON = /\p{Script_Extensions=Common}/u;
const GREEK = /\p{Script_Extensions=Greek}/u;

/**
 * YOVA currently teaches in English. Keep ordinary Unicode punctuation and
 * mathematical notation available while rejecting prose that leaks through in
 * another writing system. A few isolated Greek letters are allowed because
 * they are routinely used as mathematical and scientific symbols; Greek prose
 * is still rejected.
 */
export function containsUnexpectedNonLatinScript(value: string) {
  let consecutiveGreekLetters = 0;

  for (const character of value) {
    if (!LETTER.test(character)) {
      consecutiveGreekLetters = 0;
      continue;
    }

    if (LATIN.test(character) || COMMON.test(character)) {
      consecutiveGreekLetters = 0;
      continue;
    }

    if (GREEK.test(character)) {
      consecutiveGreekLetters += 1;
      if (consecutiveGreekLetters > 2) {
        return true;
      }
      continue;
    }

    return true;
  }

  return false;
}

export function answerEvaluationUsesUnexpectedScript(
  evaluation: AnswerEvaluationDraft,
) {
  return [
    evaluation.feedback,
    ...evaluation.matchedIdeas,
    ...evaluation.missingIdeas,
  ].some(containsUnexpectedNonLatinScript);
}
