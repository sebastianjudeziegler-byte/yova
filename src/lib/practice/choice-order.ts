/** Stable per-question permutation. The stored composed question is the source
 * of truth for rendering, reveal and grading, including after resume. */
export function orderedChoices(choices: readonly string[], correctChoiceIndex: number, identity: string) {
  const positional = /\b(?:option|choice|answer)\s+[a-d1-4]\b|\b(?:all|none|both)\s+(?:of\s+(?:the\s+)?)?(?:above|below)\b|\b[a-d]\s+and\s+[a-d]\b/i;
  const numeric = choices.every(choice => /^\s*[-+]?\d+(?:[.,]\d+)?(?:\s|%|$)/.test(choice));
  const chronological = choices.every(choice => /^(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|april|may|june|july|august|september|october|november|december|before|during|after|first|second|third|fourth|last|yesterday|today|tomorrow)\b/i.test(choice.trim()));
  if (numeric || chronological || choices.some(choice => positional.test(choice))) return { choices: [...choices], correctChoiceIndex };
  let seed = 2166136261;
  for (const character of identity) seed = Math.imul(seed ^ character.charCodeAt(0), 16777619) >>> 0;
  const permutation = choices.map((_, index) => index);
  for (let index = permutation.length - 1; index > 0; index -= 1) {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    const selected = (seed >>> 0) % (index + 1);
    [permutation[index], permutation[selected]] = [permutation[selected], permutation[index]];
  }
  return { choices: permutation.map(index => choices[index]), correctChoiceIndex: permutation.indexOf(correctChoiceIndex) };
}

/** Reject testing the outline's labels or instructions instead of its subject.
 * “Which unit measures force?” remains a valid subject question. */
export function referencesLearningDocument(prompt: string) {
  return /\b(?:study\s+guide|syllabus|course\s+outline)\b/i.test(prompt)
    || /\b(?:goals?|objectives?|topics?)\s+(?:of|for|in)\s+(?:unit|chapter|module)\s+\d+\b/i.test(prompt)
    || /\b(?:unit|chapter|module)\s+\d+\s+(?:lists?|covers?|asks?|requires?|goals?|objectives?)\b/i.test(prompt);
}
