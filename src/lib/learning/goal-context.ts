export type GoalContextAssessment = {
  hasEnoughContext: boolean;
  opaqueReference: string | null;
  message: string | null;
};

const OPAQUE_CLASS_REFERENCE = /\b(?:unit|chapter|chap|module|lesson|section)\s*(?:#?\s*[a-z0-9.-]+)?\b|\bu\s*#?\s*\d+\b|\b(?:test|exam|quiz|midterm|final)\b/i;

const NON_TOPIC_WORDS = new Set([
  "a", "about", "an", "and", "at", "begin", "class", "concept", "content", "course", "day", "days",
  "do", "exam", "final", "first", "for", "friday", "help", "homework", "i", "in", "it", "learn",
  "learning", "lesson", "material", "me", "midterm", "monday", "my", "need", "next", "on", "please",
  "practice", "prepare", "preparing", "quiz", "review", "saturday", "second", "soon", "start", "stuff",
  "study", "sunday", "test", "the", "thing", "this", "thursday", "to", "today", "tomorrow", "tonight",
  "topic", "tuesday", "understand", "upcoming", "want", "wednesday", "week", "weekend", "with", "work",
  "working",
]);

const BROAD_SUBJECT_WORDS = new Set([
  "algebra", "bio", "biology", "calc", "calculus", "chem", "chemistry", "class", "cs", "economics",
  "econ", "english", "finance", "french", "geometry", "history", "math", "mathematics", "physics",
  "psychology", "science", "spanish", "statistics", "stats",
]);

/**
 * Class-local labels such as "Calc Unit 3" are not content. Unless the learner
 * supplies material, YOVA must learn the actual concept before it can teach it.
 */
export function assessGoalContext(goal: string, hasUsableMaterials = false): GoalContextAssessment {
  if (hasUsableMaterials) {
    return { hasEnoughContext: true, opaqueReference: null, message: null };
  }

  const normalized = goal.toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9+#.-]+/g, " ").trim();
  const reference = normalized.match(OPAQUE_CLASS_REFERENCE)?.[0] ?? null;
  if (!reference) {
    return { hasEnoughContext: true, opaqueReference: null, message: null };
  }

  const withoutReference = normalized.replace(OPAQUE_CLASS_REFERENCE, " ");
  const meaningfulWords = withoutReference
    .split(/\s+/)
    .map((word) => word.replace(/^#+|[.+-]+$/g, ""))
    .filter(Boolean)
    .filter((word) => !/^\d+$/.test(word))
    .filter((word) => !NON_TOPIC_WORDS.has(word))
    .filter((word) => !BROAD_SUBJECT_WORDS.has(word));

  if (meaningfulWords.length > 0) {
    return { hasEnoughContext: true, opaqueReference: reference, message: null };
  }

  return {
    hasEnoughContext: false,
    opaqueReference: reference,
    message: "YOVA does not know what your class includes in that unit, chapter, or test. Add the actual concept, such as ‘product rule’ or ‘cellular respiration,’ or choose Use my materials and upload something that names the content.",
  };
}

export function goalClarificationSuggestions(goal: string): string[] {
  if (/\bcalc(?:ulus)?\b|derivative|integral/i.test(goal)) {
    return ["Limits and continuity", "Derivative basics", "Product rule", "Chain rule", "Applications of derivatives"];
  }
  if (/\bbio(?:logy)?\b/i.test(goal)) {
    return ["Cellular respiration", "Photosynthesis", "Genetics and inheritance", "Cell division and mitosis"];
  }
  if (/\bchem(?:istry)?\b/i.test(goal)) {
    return ["Atomic structure", "Chemical bonding", "Stoichiometry", "Acids and bases"];
  }
  if (/history|apush|world history/i.test(goal)) {
    return ["Causes and effects", "Compare two periods or events", "Key people and evidence", "Essay or short-answer practice"];
  }
  return [];
}
