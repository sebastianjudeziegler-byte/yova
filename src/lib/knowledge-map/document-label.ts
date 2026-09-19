/**
 * Brief 2.5 root cause 5 (finding 22): a plan's topics were "Unit 6 test scope"
 * and "Unit 6 concept explanations" - the names of a study guide's sections,
 * not knowledge. The 7 Sept change removed one path that copied them; the map
 * model could still return them, and only a prompt line asked it not to. A
 * topic title names what is learned, never a part of a document.
 */
const LABELS: readonly RegExp[] = [
  /\b(?:test|exam|quiz|assessment|midterm|final)\s+(?:scope|outline|review|topics|objectives|content|coverage)\b/i,
  /\bconcept\s+explanations?\b/i,
  /\b(?:study\s+guide|learning\s+(?:objectives|goals|targets)|key\s+terms|vocabulary\s+list|table\s+of\s+contents|review\s+sheet|practice\s+test|answer\s+key|course\s+outline|syllabus)\b/i,
  /^(?:unit|chapter|module|section|lesson|week|part|topic)\s*\d+[a-z]?\b/i,
];

export function isDocumentLabelTitle(title: string) {
  const trimmed = title.trim();
  return LABELS.some(pattern => pattern.test(trimmed));
}
