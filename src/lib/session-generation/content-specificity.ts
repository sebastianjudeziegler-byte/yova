import type { GeneratedSessionDraft } from "@/lib/session-generation/schema";

const GENERIC_PLACEHOLDER_PATTERNS = [
  /\bfirst concept listed\b/i,
  /\bthe learner has (?:not )?encountered the material\b/i,
  /\bprovided context\b/i,
  /\bthe current objective\b/i,
  /\bthe subject matter\b/i,
  /\ba relevant (?:idea|concept|example|topic)\b/i,
  /\bthe concept above\b/i,
  /\bwhat should happen after an initial explanation\b/i,
  /\bsee the structure before trying it alone\b/i,
  /\bpractice with less help\b/i,
  /\bperform independently\b/i,
];

const RUBRIC_LIKE_REFERENCE_PATTERNS = [
  /^\s*(?:a|an|the)\s+(?:strong|good|complete|correct|accurate)\s+(?:answer|response|explanation)\b/i,
  /^\s*(?:the\s+)?learner\s+(?:should|must|needs?\s+to)\b/i,
  /^\s*(?:the\s+)?(?:answer|response|explanation)\s+(?:should|must|needs?\s+to)\b/i,
  /\b(?:strong|good|complete|correct|accurate)\s+(?:answer|response)\s+(?:should|must|needs?\s+to|includes?|states?|explains?|mentions?)\b/i,
];

const IGNORED_TOKENS = new Set([
  "about", "after", "again", "apply", "before", "build", "class", "complete", "concept", "course",
  "current", "different", "explain", "first", "from", "goal", "help", "idea", "learn", "learning",
  "lesson", "material", "practice", "prepare", "review", "session", "study", "test", "that", "their",
  "these", "this", "through", "topic", "understand", "using", "what", "when", "where", "which", "with",
  "your",
]);

export function validateSessionContentSpecificity({
  draft,
  goalTopic,
  sessionObjective,
}: {
  draft: GeneratedSessionDraft;
  goalTopic: string;
  sessionObjective: string;
}) {
  const activityText = draft.activities.map(activitySubjectText).join(" ");
  const placeholder = GENERIC_PLACEHOLDER_PATTERNS.find((pattern) => pattern.test(activityText));
  if (placeholder) {
    return "The lesson contains generic placeholder language instead of the actual subject content.";
  }

  const repeatedActivity = firstRepeated(
    draft.activities.map((activity) => normalize(`${activity.title} ${activity.body}`)),
  );
  if (repeatedActivity) {
    return "The lesson repeats the same activity instead of progressing through teaching, practice, and evidence.";
  }

  const targetTokens = meaningfulTokens(`${goalTopic} ${sessionObjective}`);
  const matchedTargetTokens = targetTokens.filter((token) => containsToken(activityText, token));
  const minimumTargetMatches = Math.min(2, targetTokens.length);
  if (minimumTargetMatches > 0 && matchedTargetTokens.length < minimumTargetMatches) {
    return "The lesson does not use enough of the named topic or objective to be trustworthy.";
  }

  for (const activity of draft.activities) {
    if (activity.type !== "multiple_choice" && activity.type !== "free_response") continue;
    if (activity.type === "free_response" && isRubricLikeReferenceAnswer(activity.correctAnswer ?? "")) {
      return `The free-response activity "${activity.title}" gives grading instructions instead of the actual subject answer.`;
    }
    const questionText = [
      activity.title,
      activity.body,
      activity.correctAnswer,
      activity.feedback,
      ...activity.choices,
    ].filter(Boolean).join(" ");
    const conceptTokens = meaningfulTokens(activity.concept ?? "");
    const relevantTokens = unique([...conceptTokens, ...targetTokens]);
    if (relevantTokens.length > 0 && !relevantTokens.some((token) => containsToken(questionText, token))) {
      return `The question "${activity.title}" is not visibly connected to its named concept or session objective.`;
    }
  }

  if (draft.methodBriefing.learningMode === "learn") {
    const teachingText = draft.activities
      .filter((activity) => activity.teaching)
      .map(activitySubjectText)
      .join(" ");
    const uncoveredIdeas = draft.coverage.essentialIdeas.filter((idea) => {
      const ideaTokens = meaningfulTokens(idea);
      return ideaTokens.length > 0
        && countTokenMatches(teachingText, ideaTokens) < minimumTeachingMatches(ideaTokens.length);
    });
    if (uncoveredIdeas.length > 0) {
      const list = uncoveredIdeas.map((idea) => `"${idea}"`).join("; ");
      return `These essential ideas are checked later but are not actually taught in the lesson model: ${list}. Teach every listed relationship explicitly, or move it to deferredContent and remove its evidence-map entry.`;
    }
  }

  const mismatchedEvidence = draft.coverage.evidenceMap.flatMap((mapping) => {
    const mappedActivities = draft.activities.filter((activity) => (
      activity.requiredForCompletion
      && (activity.type === "multiple_choice" || activity.type === "free_response")
      && conceptsOverlap(activity.concept ?? "", mapping.activityConcept)
    ));
    if (mappedActivities.length === 0) return [];

    // Do not count the concept label itself. The learner only demonstrates an
    // idea when the visible question, answer, and feedback actually address it.
    const evidenceText = mappedActivities.map(questionSubjectText).join(" ");
    const ideaTokens = meaningfulTokens(mapping.essentialIdea);
    if (
      ideaTokens.length > 0
      && countTokenMatches(evidenceText, ideaTokens) < minimumEvidenceMatches(ideaTokens.length)
    ) {
      return [`"${mapping.activityConcept}" does not test "${mapping.essentialIdea}"`];
    }
    return [];
  });
  if (mismatchedEvidence.length > 0) {
    return `The evidence map is inaccurate: ${mismatchedEvidence.join("; ")}. Rebuild every evidence-map entry and its required question together so each prompt, answer, and feedback directly tests the one essential idea it claims.`;
  }

  return null;
}

export function isRubricLikeReferenceAnswer(value: string) {
  const normalized = value.trim();
  return !normalized || RUBRIC_LIKE_REFERENCE_PATTERNS.some((pattern) => pattern.test(normalized));
}

function activitySubjectText(activity: GeneratedSessionDraft["activities"][number]) {
  return [
    activity.title,
    activity.body,
    activity.concept,
    activity.teaching?.keyIdea,
    activity.teaching?.explanation,
    activity.teaching?.example?.setup,
    ...(activity.teaching?.example?.steps ?? []),
    activity.teaching?.example?.takeaway,
    activity.teaching?.commonMistake?.mistake,
    activity.teaching?.commonMistake?.correction,
    activity.correctAnswer,
    activity.feedback,
    ...activity.choices,
  ].filter(Boolean).join(" ");
}

function questionSubjectText(activity: GeneratedSessionDraft["activities"][number]) {
  return [
    activity.title,
    activity.body,
    activity.correctAnswer,
    activity.feedback,
    ...activity.choices,
  ].filter(Boolean).join(" ");
}

function countTokenMatches(value: string, tokens: string[]) {
  return tokens.filter((token) => containsToken(value, token)).length;
}

function minimumTeachingMatches(tokenCount: number) {
  if (tokenCount <= 2) return 1;
  if (tokenCount <= 5) return 2;
  return 4;
}

function minimumEvidenceMatches(tokenCount: number) {
  if (tokenCount <= 2) return 1;
  if (tokenCount <= 5) return 2;
  // Longer learning claims often include connective wording that should not
  // force a valid discrimination question to repeat the entire sentence.
  // Three subject-token matches still rejects mere concept name-dropping while
  // accepting a prompt that states the defining operation in fresh language.
  return 3;
}

function conceptsOverlap(left: string, right: string) {
  const leftNormalized = normalize(left);
  const rightNormalized = normalize(right);
  return leftNormalized === rightNormalized
    || leftNormalized.includes(rightNormalized)
    || rightNormalized.includes(leftNormalized);
}

function meaningfulTokens(value: string) {
  return unique(value.toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .map((token) => token.length > 4 && token.endsWith("s") ? token.slice(0, -1) : token)
    .filter((token) => token.length > 3 && !IGNORED_TOKENS.has(token)));
}

function containsToken(value: string, token: string) {
  const normalized = value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, " ");
  return normalized.split(" ").some((candidate) => (
    tokensRelated(candidate, token)
  ));
}

function tokensRelated(candidate: string, token: string) {
  const singularCandidate = candidate.length > 4 && candidate.endsWith("s") ? candidate.slice(0, -1) : candidate;
  if (singularCandidate === token) return true;
  if (singularCandidate.length < 5 || token.length < 5) return false;
  const sharedPrefix = Math.min(singularCandidate.length, token.length, 6);
  return sharedPrefix >= 5
    && singularCandidate.slice(0, sharedPrefix) === token.slice(0, sharedPrefix);
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function normalize(value: string) {
  return value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function firstRepeated(values: string[]) {
  const seen = new Set<string>();
  for (const value of values) {
    if (!value) continue;
    if (seen.has(value)) return value;
    seen.add(value);
  }
  return null;
}
