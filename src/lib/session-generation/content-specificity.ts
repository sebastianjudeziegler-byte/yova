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
    const uncoveredIdea = draft.coverage.essentialIdeas.find((idea) => {
      const ideaTokens = meaningfulTokens(idea);
      return ideaTokens.length > 0 && !ideaTokens.some((token) => containsToken(teachingText, token));
    });
    if (uncoveredIdea) {
      return `The essential idea "${uncoveredIdea}" is checked later but is not actually taught in the lesson model.`;
    }
  }

  return null;
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
    candidate === token
    || (candidate.length > 4 && candidate.endsWith("s") ? candidate.slice(0, -1) : candidate) === token
  ));
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
