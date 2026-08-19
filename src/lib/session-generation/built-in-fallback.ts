import type { SessionLearningMode } from "@/lib/domain";
import type { GuidedSessionStep } from "@/lib/learning/session-evidence";

export type BuiltInSessionFallbackKind =
  | "outside_source"
  | "generic_inside"
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

export type OutsideYovaFallbackInput = {
  topic: string;
  objective: string;
  method: string;
  methodReason?: string | null;
  learningMode: SessionLearningMode;
  availableMinutes: number;
};

export type OutsideYovaFallbackLesson = {
  kind: "outside_source";
  learningMode: SessionLearningMode;
  availableMinutes: number;
  externalWorkMinutes: number;
  activities: GuidedSessionStep[];
};

export type GenericInsideYovaFallbackInput = {
  objective: string;
  contentTargets: readonly string[];
  completionEvidence: readonly string[];
  learningMode: SessionLearningMode;
  availableMinutes: number;
};

export type GenericInsideYovaFallbackLesson = {
  kind: "generic_inside";
  availableMinutes: number;
  /** Exact persisted targets presented back to the learner for comparison. */
  coveredTargets: string[];
  activities: GuidedSessionStep[];
};

export type BuiltInFallbackAdjustmentContext = {
  outsideFallback?: OutsideYovaFallbackLesson | null;
};

export type BuiltInFallbackAdjustment = {
  familiarity?: "as_planned" | "already_know" | "need_teaching" | "challenge_me";
  availableMinutes?: number | null;
  knownTargets?: readonly string[];
  note?: string | null;
};

export type BuiltInFallbackEligibility = {
  planStatus: unknown;
  sourceMode: unknown;
  responseStatus: number | null;
  failureKind?: "guided_session_allowance_exhausted" | null;
  adjustment: BuiltInFallbackAdjustment | null | undefined;
  outsideFallback?: OutsideYovaFallbackLesson | null;
};

type BuiltInFallbackCoverageActivity = {
  title?: string | null;
  body?: string | null;
  concept?: string | null;
  teaching?: {
    keyIdea?: string | null;
    explanation?: string | null;
    example?: {
      setup?: string | null;
      steps?: string[] | null;
      takeaway?: string | null;
    } | null;
    commonMistake?: {
      /** Misconception text is accepted in the shape so coverage can explicitly ignore it. */
      mistake?: string | null;
      correction?: string | null;
    } | null;
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
  adjustment: BuiltInFallbackAdjustment | null | undefined,
  context: BuiltInFallbackAdjustmentContext = {},
) {
  if (!adjustment) return true;
  if (adjustment.note?.trim()) return false;
  if ((adjustment.knownTargets?.length ?? 0) > 0) return false;

  if (adjustment.familiarity === undefined || adjustment.familiarity === "as_planned") {
    return true;
  }

  // "Need teaching" is safe only when the exact outside-source fallback for
  // this adjusted request was built in learn mode and contains the method
  // coaching it promises. Other starting-point changes still require a newly
  // generated session.
  return adjustment.familiarity === "need_teaching"
    && outsideFallbackFulfillsTeaching(context.outsideFallback)
    && (adjustment.availableMinutes == null
      || context.outsideFallback?.availableMinutes === adjustment.availableMinutes);
}

/**
 * A built-in lesson is an offline recovery for a provider outage or a
 * specifically classified durable usage allowance. It is never an auth,
 * lifecycle, or source-grounding fallback. Other client errors fail closed
 * because a 404/409 can mean the plan was deleted or archived in flight.
 */
export function canUseBuiltInSessionFallback({
  planStatus,
  sourceMode,
  responseStatus,
  failureKind,
  adjustment,
  outsideFallback,
}: BuiltInFallbackEligibility) {
  if (planStatus !== "active") return false;
  if (sourceMode !== "yova_generated") return false;
  const durableAllowanceExhausted = failureKind === "guided_session_allowance_exhausted";
  if (durableAllowanceExhausted) {
    if (responseStatus !== 429) return false;
  } else if (responseStatus !== null && ![502, 503, 504].includes(responseStatus)) {
    return false;
  }
  return builtInFallbackSupportsAdjustment(adjustment, {
    outsideFallback,
  });
}

/**
 * Builds the outage-safe workflow for a session that intentionally happens in
 * the learner's own source. The returned minutes are the learner-facing time
 * contract: the outside-work instruction names exactly the minutes allocated
 * to it, and all activity estimates add up to the available time.
 */
export function buildOutsideYovaFallbackLesson(
  input: OutsideYovaFallbackInput,
): OutsideYovaFallbackLesson | null {
  if (!Number.isInteger(input.availableMinutes) || input.availableMinutes < 10) {
    return null;
  }

  const topic = boundedPhrase(input.topic, "this topic", 90);
  const objective = boundedPhrase(input.objective, `make progress on ${topic}`, 120);
  const method = boundedPhrase(input.method, "active recall with a source check", 80);
  const methodReason = boundedPhrase(
    input.methodReason ?? "it turns source review into an attempt you can check and improve",
    "it turns source review into an attempt you can check and improve",
    130,
  );
  const coachingMinutes = input.learningMode === "learn" ? 3 : 2;
  const returnMinutes = 2;
  const externalWorkMinutes = input.availableMinutes - coachingMinutes - returnMinutes;
  const methodTitle = boundedPhrase(`How to use ${method}`, "How to use the selected method", 120);

  const coaching: GuidedSessionStep = input.learningMode === "learn"
    ? {
      topicId: null,
      methodPhase: "model",
      estimatedMinutes: coachingMinutes,
      requiredForCompletion: true,
      type: "instruction",
      concept: null,
      label: "METHOD COACHING",
      title: methodTitle,
      body: `Learn the short method sequence first. It will keep your work on ${topic} focused when you move to your own source.`,
      teaching: {
        keyIdea: `Use ${method} to produce an answer before you judge it.`,
        explanation: `${method} fits this session because ${lowercaseOpening(methodReason)}. Start from the objective, make one concrete attempt in the source, and mark the first gap you notice. That sequence gives you something specific to bring back instead of ending with more pages read but no clear result.`,
        example: {
          setup: `Use one bounded source section to work toward this objective: ${objective}.`,
          steps: [
            "Turn the objective into one question or result you can produce.",
            "Use the source, then write the answer or worked result in your own words.",
            "Mark the first uncertain idea or step before returning to YOVA.",
          ],
          takeaway: "Bring back your own attempt plus one specific gap, not a copied page of notes.",
        },
        commonMistake: null,
      },
      question: null,
      correctAnswer: null,
      feedback: null,
    }
    : {
      topicId: null,
      methodPhase: "orient",
      estimatedMinutes: coachingMinutes,
      requiredForCompletion: true,
      type: "instruction",
      concept: null,
      label: "METHOD CHECK",
      title: methodTitle,
      body: `Use ${method} for this objective because ${lowercaseOpening(methodReason)}. Produce one answer or worked result, then mark the first gap instead of rereading without a target.`,
      teaching: null,
      question: null,
      correctAnswer: null,
      feedback: null,
    };

  const activities: GuidedSessionStep[] = [
    coaching,
    {
      topicId: null,
      methodPhase: "read_source",
      estimatedMinutes: externalWorkMinutes,
      requiredForCompletion: true,
      type: "instruction",
      concept: null,
      label: "OUTSIDE WORK",
      title: `Work in your source for ${externalWorkMinutes} minutes`,
      body: `Open your textbook, class notes, or other trusted source for ${topic}. Read the smallest useful section, then write an answer or worked result for this objective: ${objective}. Work there for ${externalWorkMinutes} minutes and bring your notes back to YOVA for the check.`,
      teaching: null,
      question: null,
      correctAnswer: null,
      feedback: null,
    },
    {
      topicId: null,
      methodPhase: "explain",
      estimatedMinutes: returnMinutes,
      requiredForCompletion: true,
      type: "free_response",
      concept: null,
      label: "RETURN CHECK",
      title: "Bring back one result and one gap",
      body: `Without reopening the source, write the answer or worked result you produced for ${objective}. Then name the first point you would check again.`,
      teaching: null,
      question: null,
      correctAnswer: "A complete return includes one answer or worked result in your own words and one specific idea, step, relationship, or example that needs another pass.",
      feedback: "Check that you produced something of your own and identified a precise next gap, rather than only reporting that you read the source.",
    },
  ];

  return {
    kind: "outside_source",
    learningMode: input.learningMode,
    availableMinutes: input.availableMinutes,
    externalWorkMinutes,
    activities,
  };
}

/**
 * Builds a topic-agnostic outage fallback for an inside-YOVA session. This
 * workflow never invents subject knowledge: the learner's persisted objective,
 * targets, and completion evidence are the comparison frame for two required
 * attempts. The guided-session UI keeps each typed answer visible while it
 * reveals that frame, so the learner can compare meaning without YOVA claiming
 * that a generic rubric is a subject-specific model answer.
 */
export function buildGenericInsideYovaFallbackLesson(
  input: GenericInsideYovaFallbackInput,
): GenericInsideYovaFallbackLesson | null {
  // This topic-agnostic workflow can support practice, but it cannot supply
  // the accurate first model promised by a teaching-first session. Returning
  // null keeps learn-mode on the honest recovery path unless a curated,
  // subject-specific teaching fallback matched first.
  if (input.learningMode === "learn") return null;

  if (!Number.isInteger(input.availableMinutes) || input.availableMinutes < 10) {
    return null;
  }

  const objective = compactFallbackText(input.objective) || "Make a clear attempt at the session objective";
  const contentTargets = uniqueFallbackItems(input.contentTargets);
  const completionEvidence = uniqueFallbackItems(input.completionEvidence);
  const targetFrame = contentTargets.length > 0
    ? contentTargets.map((target, index) => `${index + 1}. ${target}`).join(" ")
    : `1. ${objective}`;
  const evidenceFrame = completionEvidence.length > 0
    ? completionEvidence.map((evidence, index) => `${index + 1}. ${evidence}`).join(" ")
    : "1. Explain the main idea accurately or apply it to one concrete case.";
  const orientationMinutes = 2;
  const attemptMinutes = Math.ceil((input.availableMinutes - orientationMinutes) / 2);
  const applicationMinutes = input.availableMinutes - orientationMinutes - attemptMinutes;

  const activities: GuidedSessionStep[] = [
    {
      topicId: null,
      methodPhase: "orient",
      estimatedMinutes: orientationMinutes,
      requiredForCompletion: true,
      type: "instruction",
      concept: null,
      label: "SESSION TARGET",
      title: "Use the session target as your comparison frame",
      body: `Objective: ${objective}. Content targets: ${targetFrame} Completion evidence: ${evidenceFrame}`,
      teaching: null,
      question: null,
      correctAnswer: null,
      feedback: null,
    },
    {
      topicId: null,
      methodPhase: "retrieve",
      estimatedMinutes: attemptMinutes,
      requiredForCompletion: true,
      type: "free_response",
      concept: null,
      label: "MEMORY ATTEMPT",
      title: "Make an unsupported attempt first",
      body: "Without notes, hints, or outside help, write what you currently understand. Include the relationships, steps, reasoning, or worked result that the objective calls for. Submit the attempt even if it is incomplete.",
      teaching: null,
      question: null,
      correctAnswer: `Keep your own answer visible and compare it with the stated objective and each content target: ${targetFrame}`,
      feedback: "Mark which target your answer addressed clearly and which target needs another pass. Compare the meaning and reasoning, not exact wording.",
    },
    {
      topicId: null,
      methodPhase: "transfer",
      estimatedMinutes: applicationMinutes,
      requiredForCompletion: true,
      type: "free_response",
      concept: null,
      label: "EXPLAIN OR APPLY",
      title: "Turn the comparison into a stronger response",
      body: "Now write a clearer explanation of how the main ideas connect, or apply one target to a concrete example, problem, or case. Use the gap you noticed in your first attempt before completing the session.",
      teaching: null,
      question: null,
      correctAnswer: `A complete response should provide this session evidence: ${evidenceFrame}`,
      feedback: "Check that the response explains a relationship or performs an application, rather than only listing terms or restating the objective.",
    },
  ];

  return {
    kind: "generic_inside",
    availableMinutes: input.availableMinutes,
    coveredTargets: contentTargets,
    activities,
  };
}

/**
 * Generic inside lessons do not claim subject knowledge. Their coverage
 * contract is narrower and exact: a persisted target is covered when that
 * same saved target is explicitly presented in the comparison frame. Keep
 * curated templates on `builtInLessonCoversTarget`, whose semantic token
 * check prevents an unrelated subject lesson from being accepted.
 */
export function genericInsideFallbackCoversTarget(
  fallback: GenericInsideYovaFallbackLesson,
  target: string,
) {
  const savedTarget = compactFallbackText(target);
  if (!savedTarget || !fallback.coveredTargets.includes(savedTarget)) return false;

  const targetFrame = fallback.activities.find((activity) => (
    activity.type === "instruction"
    && activity.methodPhase === "orient"
    && activity.label === "SESSION TARGET"
  ));
  return compactFallbackText(targetFrame?.body ?? "").includes(savedTarget);
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
    activity.teaching?.example?.setup,
    ...(activity.teaching?.example?.steps ?? []),
    activity.teaching?.example?.takeaway,
    activity.teaching?.commonMistake?.correction,
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

function outsideFallbackFulfillsTeaching(
  fallback: OutsideYovaFallbackLesson | null | undefined,
) {
  if (!fallback || fallback.kind !== "outside_source" || fallback.learningMode !== "learn") {
    return false;
  }
  if (fallback.availableMinutes < 10 || fallback.activities.length < 3 || fallback.activities.length > 4) {
    return false;
  }
  if (!builtInLessonFitsTime(fallback.activities, fallback.availableMinutes)) return false;
  if (fallback.externalWorkMinutes < 1) return false;
  const totalMinutes = fallback.activities.reduce(
    (total, activity) => total + (activity.estimatedMinutes ?? 0),
    0,
  );
  const hasMatchingOutsideWork = fallback.activities.some((activity) => (
    activity.type === "instruction"
    && activity.methodPhase === "read_source"
    && activity.estimatedMinutes === fallback.externalWorkMinutes
  ));
  const hasReturnCheck = fallback.activities.some((activity) => (
    activity.type === "free_response" && activity.requiredForCompletion !== false
  ));
  if (totalMinutes !== fallback.availableMinutes || !hasMatchingOutsideWork || !hasReturnCheck) {
    return false;
  }

  return fallback.activities.some((activity) => (
    activity.type === "instruction"
    && (activity.teaching?.explanation.length ?? 0) >= 80
    && Boolean(activity.teaching?.example || activity.teaching?.commonMistake)
  ));
}

function boundedPhrase(value: string, fallback: string, maximumCharacters: number) {
  const compact = value.trim().replace(/\s+/g, " ") || fallback;
  if (compact.length <= maximumCharacters) return compact.replace(/[.!?]+$/u, "");

  const clipped = compact.slice(0, maximumCharacters + 1);
  const boundary = clipped.lastIndexOf(" ");
  const candidate = (boundary >= Math.floor(maximumCharacters * 0.6)
    ? clipped.slice(0, boundary)
    : compact.slice(0, maximumCharacters)).trim();
  return candidate.replace(/[,:;.!?\s]+$/u, "") || fallback;
}

function uniqueFallbackItems(values: readonly string[]) {
  return [...new Set(values.map(compactFallbackText).filter(Boolean))];
}

function compactFallbackText(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function lowercaseOpening(value: string) {
  return value ? `${value.charAt(0).toLocaleLowerCase()}${value.slice(1)}` : value;
}

function normalize(value: string) {
  return value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
