export type BuiltInSessionFallbackKind =
  | "outside_source"
  | "wwi_outbreak"
  | "cellular_respiration_sequence"
  | "product_rule"
  | "startup_funding"
  | "budget_and_compound_growth";

export type BuiltInSessionFallbackScope = {
  planTopic: string;
  studyMode: "inside_yova" | "outside_yova";
  sessionTitle: string;
  sessionObjective: string;
  contentTargets: string[];
};

type BuiltInFallbackCoverageActivity = {
  title?: string | null;
  body?: string | null;
  concept?: string | null;
  teaching?: {
    keyIdea?: string | null;
    explanation?: string | null;
  } | null;
  correctAnswer?: string | null;
  feedback?: string | null;
  /** Distractors are accepted in the shape so the coverage check can explicitly ignore them. */
  question?: string[] | null;
};

type BuiltInFallbackTimedActivity = {
  estimatedMinutes?: number | null;
  requiredForCompletion?: boolean | null;
};

export function builtInFallbackSupportsAdjustment(
  adjustment: { note?: string | null } | null | undefined,
) {
  return !adjustment?.note?.trim();
}

export function builtInTopicEvidenceId(input: {
  studyMode: BuiltInSessionFallbackScope["studyMode"];
  topicIds: string[];
  coversEntireScope: boolean;
}) {
  if (input.studyMode !== "inside_yova") return null;
  if (!input.coversEntireScope || input.topicIds.length !== 1) return null;
  return input.topicIds[0] ?? null;
}

export function builtInLessonCoversTarget(
  activities: BuiltInFallbackCoverageActivity[],
  target: string,
) {
  const lessonText = activities.map((activity) => [
    activity.title,
    activity.body,
    activity.concept,
    activity.teaching?.keyIdea,
    activity.teaching?.explanation,
    activity.correctAnswer,
    activity.feedback,
  ].filter(Boolean).join(" ")).join(" ");
  const targetTokens = fallbackSubjectTokens(target);
  if (targetTokens.length === 0) return false;
  const lessonTokens = fallbackSubjectTokens(lessonText);
  return targetTokens.every((targetToken) => lessonTokens.some((lessonToken) => (
    lessonToken === targetToken
    || (lessonToken.length >= 5 && targetToken.length >= 5
      && lessonToken.slice(0, 6) === targetToken.slice(0, 6))
  )));
}

export function builtInLessonFitsTime(
  activities: BuiltInFallbackTimedActivity[],
  availableMinutes: number,
) {
  const requiredMinutes = activities
    .filter((activity) => activity.requiredForCompletion !== false)
    .reduce((total, activity) => total + (activity.estimatedMinutes ?? 0), 0);
  const totalMinutes = activities
    .reduce((total, activity) => total + (activity.estimatedMinutes ?? 0), 0);
  return requiredMinutes <= availableMinutes && totalMinutes <= availableMinutes + 2;
}

/**
 * Built-in lessons are curated for a few exact scopes. Match against the
 * requested session, not merely the wider plan title, so an outage cannot
 * substitute a lesson from an earlier or neighboring part of the plan.
 */
export function builtInSessionFallbackKind(
  scope: BuiltInSessionFallbackScope,
): BuiltInSessionFallbackKind | null {
  if (scope.studyMode === "outside_yova") return "outside_source";

  const planTopic = normalize(scope.planTopic);
  const sessionScope = normalize([
    scope.sessionTitle,
    scope.sessionObjective,
    ...scope.contentTargets,
  ].join(" "));
  const hasExactRespirationTargets = scope.contentTargets.length > 0
    && scope.contentTargets.every((target) => {
      const normalizedTarget = normalize(target);
      return /\b(?:cellular respiration|respiration sequence|glycolysis|krebs|electron transport)\b/.test(normalizedTarget)
        && !/\bphotosynth(?:esis|etic)\b/.test(normalizedTarget);
    });
  const planIsRespirationOnly = /\b(?:cellular respiration|glycolysis|krebs|electron transport)\b/.test(planTopic)
    && !/\bphotosynth(?:esis|etic)\b/.test(planTopic);

  if (
    /\b(?:world war (?:i|one|1)|wwi)\b/.test(planTopic)
    && /\b(?:sarajevo|assassination|july crisis|outbreak|declaration(?:s)? of war)\b/.test(sessionScope)
    && !/\b(?:world war (?:ii|two|2)|wwii)\b/.test(sessionScope)
  ) return "wwi_outbreak";

  if (
    /\b(?:cellular respiration|glycolysis|krebs|electron transport)\b/.test(planTopic)
    && (hasExactRespirationTargets || (
      /\bcellular respiration\b/.test(sessionScope)
      && (
        /\b(?:glycolysis|krebs|electron transport|respiration sequence|stages? of cellular respiration)\b/.test(sessionScope)
        || planIsRespirationOnly
      )
      && (!/\bphotosynth(?:esis|etic)\b/.test(sessionScope) || planIsRespirationOnly)
    ))
  ) return "cellular_respiration_sequence";

  if (/\bproduct rule\b/.test(planTopic) && /\bproduct rule\b/.test(sessionScope)) {
    return "product_rule";
  }

  if (
    /\b(?:startup|founder|pre seed|term sheet|bootstrapp|dilution)\b/.test(planTopic)
    && startupScopeSignalCount(sessionScope) >= 2
  ) return "startup_funding";

  if (
    /\b(?:personal finance|budget(?:ing)?|compound (?:growth|interest))\b/.test(planTopic)
    && /\bcompound (?:growth|interest)\b/.test(`${planTopic} ${sessionScope}`)
    && /\bbudget(?:ing)?\b/.test(sessionScope)
    && /\b(?:interest|compound (?:growth|interest))\b/.test(sessionScope)
  ) return "budget_and_compound_growth";

  return null;
}

function startupScopeSignalCount(value: string) {
  return [
    /\bfunding (?:stage|stages|path|paths|round|rounds)\b/,
    /\binvestors?\b/,
    /\binstruments?\b/,
    /\bdilution\b/,
    /\bterm sheets?\b/,
    /\bbootstrapp(?:ing|ed)?\b/,
    /\b(?:pre seed|seed round|safe|convertible note|equity|debt)\b/,
  ].filter((pattern) => pattern.test(value)).length;
}

function fallbackSubjectTokens(value: string) {
  const ignored = new Set([
    "about", "after", "affect", "affects", "basic", "before", "between", "both", "build",
    "change", "changes", "common", "connect", "connected", "connecting", "each", "explain",
    "first", "from", "into", "major", "necessary", "relationship", "relationships", "session",
    "that", "their", "this", "through", "types", "using", "with",
  ]);
  return [...new Set(value.toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((token) => token.length > 3 && !ignored.has(token)))];
}

function normalize(value: string) {
  return value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
