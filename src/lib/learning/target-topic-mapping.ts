import type { KnowledgeMapTopic } from "@/lib/knowledge-map/schema";

export type TargetTopicAssignment = {
  target: string;
  targetIndex: number;
  topic: KnowledgeMapTopic;
};

export type TargetTopicMapping = {
  assignments: TargetTopicAssignment[];
  issue: string | null;
};

const MINIMUM_TARGET_TOPIC_SCORE = 0.34;
const MINIMUM_TARGET_TOPIC_LEAD = 0.08;

// These words describe the requested learning action rather than the subject
// being learned. Letting them drive attribution can make unrelated topics look
// like a unique match (for example, two topics that both say "explain").
const INSTRUCTIONAL_TOKENS = new Set([
  "answer",
  "apply",
  "check",
  "choose",
  "compare",
  "concept",
  "confirm",
  "correct",
  "define",
  "demonstrate",
  "describe",
  "discuss",
  "distinguish",
  "evaluate",
  "explain",
  "identify",
  "independent",
  "independently",
  "know",
  "learn",
  "list",
  "model",
  "name",
  "practice",
  "question",
  "recall",
  "recognize",
  "retrieve",
  "review",
  "select",
  "show",
  "solve",
  "state",
  "study",
  "summarize",
  "target",
  "understand",
  "use",
  "verify",
]);

const COMMON_TOKENS = new Set([
  "a",
  "an",
  "and",
  "as",
  "at",
  "be",
  "before",
  "by",
  "each",
  "for",
  "from",
  "how",
  "in",
  "into",
  "is",
  "it",
  "its",
  "of",
  "on",
  "or",
  "that",
  "the",
  "their",
  "this",
  "to",
  "what",
  "when",
  "where",
  "which",
  "why",
  "with",
  "without",
]);

/**
 * Binds persisted content targets to knowledge-map topics using subject text,
 * never array position. A multi-topic assignment is accepted only when one
 * topic has both meaningful lexical support and a clear lead over the runner
 * up. Callers that record per-topic evidence must fail closed on `issue`.
 */
export function mapTargetsToKnowledgeTopics(
  targets: string[],
  topics: KnowledgeMapTopic[],
): TargetTopicMapping {
  if (topics.length === 0) {
    return {
      assignments: [],
      issue: "The session must retain at least one active knowledge-map topic.",
    };
  }
  if (topics.length === 1) {
    return {
      assignments: targets.map((target, targetIndex) => ({ target, targetIndex, topic: topics[0]! })),
      issue: null,
    };
  }

  const assignments: TargetTopicAssignment[] = [];
  for (const [targetIndex, target] of targets.entries()) {
    const ranked = topics
      .map((topic) => ({ topic, score: targetTopicScore(target, topic) }))
      .sort((left, right) => right.score - left.score || left.topic.id.localeCompare(right.topic.id));
    const best = ranked[0];
    const runnerUp = ranked[1];
    if (
      !best
      || best.score < MINIMUM_TARGET_TOPIC_SCORE
      || (runnerUp && best.score - runnerUp.score < MINIMUM_TARGET_TOPIC_LEAD)
    ) {
      return {
        assignments: [],
        issue: `YOVA could not uniquely bind target ${targetIndex + 1} to its authoritative knowledge-map topic.`,
      };
    }
    assignments.push({ target, targetIndex, topic: best.topic });
  }
  return { assignments, issue: null };
}

function targetTopicScore(target: string, topic: KnowledgeMapTopic) {
  const normalizedTarget = normalizeText(target);
  const topicFields = [topic.title, topic.description, ...topic.subtopics];
  if (topicFields.some((field) => normalizeText(field) === normalizedTarget)) return 1;

  const targetTokens = subjectTokens(target);
  if (targetTokens.length === 0) return 0;
  const compactTarget = targetTokens.join(" ");
  const fieldTokens = topicFields.map(subjectTokens);
  const compactTopicFields = fieldTokens.map((tokens) => tokens.join(" "));
  const containingField = compactTopicFields.some((field) => (
    field.length > 0 && (field.includes(compactTarget) || compactTarget.includes(field))
  ));
  // Score against each authoritative field independently. Combining every
  // field into one denominator penalizes a detailed target simply because its
  // topic description contains extra explanatory words. Two or more distinct
  // subject matches receive a small tolerance for wording such as "linearity"
  // versus enumerated constant/sum rules; the clear-lead requirement still
  // rejects competing topics with the same evidence.
  const bestFieldScore = fieldTokens.reduce((bestScore, tokens) => {
    if (tokens.length === 0) return bestScore;
    const overlap = targetTokens.filter((targetToken) => (
      tokens.some((topicToken) => tokenMatches(targetToken, topicToken))
    )).length;
    if (overlap === 0) return bestScore;
    const coverage = overlap / Math.min(targetTokens.length, tokens.length);
    return Math.max(bestScore, Math.min(1, coverage + (overlap >= 2 ? 0.05 : 0)));
  }, 0);
  return Math.max(containingField ? 0.9 : 0, bestFieldScore);
}

function normalizeText(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function subjectTokens(value: string) {
  return [...new Set(normalizeText(value).split(" ").filter((token) => (
    token.length >= 3
    && !COMMON_TOKENS.has(token)
    && !INSTRUCTIONAL_TOKENS.has(token)
  )))];
}

function tokenMatches(left: string, right: string) {
  if (left === right) return true;
  if (left.length < 5 || right.length < 5) return false;
  return stemToken(left) === stemToken(right);
}

function stemToken(token: string) {
  return token
    .replace(/(?:ations?|ments?|ness|ingly|edly)$/u, "")
    .replace(/(?:ing|ers?|ies|ied|ed|es|s)$/u, "");
}
