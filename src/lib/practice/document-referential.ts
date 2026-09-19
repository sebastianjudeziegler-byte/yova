/**
 * Spec docs/redesign/05-PLAN-MODEL.md section 8, rule 2: reject
 * document-referential questions ("goals of unit 6", "what does the study
 * guide list"). Brief 2.5 root cause 5 (finding 23): the rule was a prompt
 * instruction only, and questions asking what "fits the notes" still reached
 * learners. A practice question is closed-book: it must be answerable from the
 * subject, never by recalling what a document, unit or guide says.
 */
const DOCUMENTS = "(?:(?:class|lecture|provided|uploaded|attached|study|review)\\s+)?(?:notes?|study\\s+guide|guide|handouts?|outline|syllabus|slides?|worksheet|packet|materials?|documents?)";
const UNITS = "(?:unit|chapter|module|section|lesson|week)\\s*\\d+";
const PATTERNS: ReadonlyArray<[RegExp, string]> = [
  [new RegExp(`\\b(?:according\\s+to|based\\s+on|from|in|per|using|as\\s+(?:listed|stated|described|shown|explained|defined)\\s+in|fits?|matches?|consistent\\s+with)\\s+(?:the|your|this|these)\\s+${DOCUMENTS}\\b`, "i"), "refers to the learner's document"],
  [new RegExp(`\\bwhat\\s+(?:does|do)\\s+(?:the|your|this)\\s+${DOCUMENTS}\\s+(?:list|say|include|state|mention|cover|describe|define)`, "i"), "asks what a document says"],
  [new RegExp(`\\b(?:the|your)\\s+(?:study\\s+guide|syllabus|outline|notes?)\\s+(?:lists?|says|includes|states|mentions|covers|describes)\\b`, "i"), "asks what a document says"],
  [new RegExp(`\\b(?:goals?|objectives?|learning\\s+targets?|outcomes?|scope|topics?)\\s+(?:of|for|in|on)\\s+(?:the\\s+)?${UNITS}\\b`, "i"), "asks about a unit rather than the subject"],
  [new RegExp(`\\b${UNITS}\\s+(?:test|exam|quiz|study\\s+guide|goals?|objectives?|scope|outline|review)\\b`, "i"), "asks about a unit rather than the subject"],
];

export function documentReferentialReason(text: string): string | null {
  for (const [pattern, reason] of PATTERNS) if (pattern.test(text)) return reason;
  return null;
}

/** Every learner-visible part of a practice question: prompt, options, explanation. */
export function questionDocumentReferentialReason(question: { prompt: string; choices?: readonly string[] | null; explanation?: string | null }) {
  return documentReferentialReason([question.prompt, ...(question.choices ?? []), question.explanation ?? ""].join("\n"));
}
