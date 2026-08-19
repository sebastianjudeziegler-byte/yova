import { getCoreLearningMethod } from "@/lib/learning/method-catalog";
import {
  buildLearningScienceRoutingBrief,
  classifyLearningTask,
  methodIdFromText,
} from "@/lib/learning/method-router";
import type {
  GeneratedPlanDraft,
  PlanGenerationRequest,
} from "@/lib/plan-generation/schema";
import { buildPlanContentBudget, contentBudgetForMinutes } from "@/lib/plan-generation/content-budget";
import { inferPlanScopeContract } from "@/lib/plan-generation/scope-contract";
import type { PlanQualityIssueCode } from "@/lib/analytics/generation-observation";

const ACTIVE_EVIDENCE_PATTERN = /\b(answer|apply|attempt|build|calculate|choose|classify|compare|complete|construct|create|debug|demonstrate|distinguish|draft|evaluate|explain|formulate|identify|implement|label|map|outline|perform|produce|recall|retrieve|revise|select|solve|summarize|test|trace|write)\b/i;
const OVERCLAIM_PATTERN = /learns? best|learning style|brain type|visual learner|auditory learner|kinesthetic learner|because (?:you have|of your) adhd|diagnos(?:is|ed|e)\b/i;
const RAW_FORMATTING_PATTERN = /[\u2013\u2014]|\*\*|__|(^|\s)#{1,6}\s/m;

export function validateGeneratedPlanQuality(
  draft: GeneratedPlanDraft,
  request: PlanGenerationRequest,
): string | null {
  return inspectGeneratedPlanQuality(draft, request)?.detail ?? null;
}

export type PlanQualityIssue = {
  code: PlanQualityIssueCode;
  detail: string;
};

export function inspectGeneratedPlanQuality(
  draft: GeneratedPlanDraft,
  request: PlanGenerationRequest,
): PlanQualityIssue | null {
  const issues: Array<{ code: PlanQualityIssueCode; detail: string }> = [];
  const addIssue = (code: PlanQualityIssueCode, detail: string) => {
    issues.push({ code, detail });
  };
  const scope = inferPlanScopeContract(request);
  const contentBudget = buildPlanContentBudget(request, scope);
  const originalTask = classifyLearningTask(request.goal);
  const taskTypeOverride = originalTask.confidence === "clear"
    ? originalTask.taskType
    : null;

  if (request.intent === "study_now" && draft.sessions.length !== 1) {
    addIssue("session_count", "A study-now request must produce exactly one focused session.");
  }

  if (request.intent === "plan" && draft.sessions.length < scope.minimumSessions) {
    addIssue("session_count", `${scope.label} needs at least ${scope.minimumSessions} sessions so the requested scope is not superficially compressed.`);
  }
  if (request.intent === "plan" && draft.sessions.length < contentBudget.minimumSessions) {
    addIssue("session_count", `The supplied material and session length need at least ${contentBudget.minimumSessions} sessions so the content is not compressed.`);
  }
  if (request.intent === "plan" && draft.sessions.length > scope.maximumSessions) {
    addIssue("session_count", `${scope.label} should use no more than ${scope.maximumSessions} sessions in YOVA Lite.`);
  }

  const teachingSessions = draft.sessions.filter((session) => session.learningMode === "learn").length;
  const placementCompleted = request.knowledgeMap?.placementCheck.status === "completed";
  const placementRequiresTeaching = request.knowledgeMap?.topics.some(
    (topic) => topic.initialEvidence?.outcome !== "demonstrated",
  ) ?? true;
  if (
    request.intent === "plan"
    && teachingSessions < scope.minimumTeachingSessions
    && (!placementCompleted || placementRequiresTeaching)
  ) {
    addIssue("teaching_progression", `${scope.label} needs at least ${scope.minimumTeachingSessions} teaching-first sessions before or between unsupported practice.`);
  }

  if (!placementCompleted && draft.sessions[0]?.learningMode !== request.learningIntent) {
    addIssue("teaching_progression", `The first session must use the requested ${request.learningIntent} starting approach.`);
  }

  if (
    request.intent === "plan"
    && request.learningIntent === "learn"
    && (!placementCompleted || placementRequiresTeaching)
    && draft.sessions.length > 1
    && !draft.sessions.slice(1).some((session) => session.learningMode === "study")
  ) {
    addIssue("teaching_progression", "A multi-session learning plan must eventually move from teaching into retrieval, application, or assessment.");
  }

  const objectiveKeys = draft.sessions.map((session) => normalize(session.objective));
  if (new Set(objectiveKeys).size !== objectiveKeys.length) {
    addIssue("objective_uniqueness", "Every session needs a distinct objective rather than repeating the same work across the plan.");
  }

  const deadline = request.deadline ? new Date(request.deadline).getTime() : null;
  const weekdayFormatter = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    timeZone: request.timeZone,
  });
  const dateFormatter = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: request.timeZone,
  });
  const scheduledMinutesByDate = new Map<string, { weekday: string; minutes: number }>();

  for (const [index, session] of draft.sessions.entries()) {
    if (deadline !== null && new Date(session.scheduledFor).getTime() > deadline) {
      addIssue("schedule_fit", `Session ${index + 1} is scheduled after the learner's deadline.`);
    }

    const availableMinutes = request.intent === "study_now"
      ? request.availability[0]?.minutes
      : maximumMinutesForWeekday(
        weekdayFormatter.format(new Date(session.scheduledFor)),
        request.availability,
      );
    if (!availableMinutes) {
      addIssue("schedule_fit", `Session ${index + 1} is scheduled on a day the learner did not make available.`);
    } else if (session.estimatedMinutes > availableMinutes) {
      addIssue("schedule_fit", `Session ${index + 1} needs ${session.estimatedMinutes} minutes, but the learner only made ${availableMinutes} minutes available.`);
    }
    const scheduledDate = new Date(session.scheduledFor);
    const dateKey = dateFormatter.format(scheduledDate);
    const scheduledDay = scheduledMinutesByDate.get(dateKey) ?? {
      weekday: weekdayFormatter.format(scheduledDate),
      minutes: 0,
    };
    scheduledDay.minutes += session.estimatedMinutes;
    scheduledMinutesByDate.set(dateKey, scheduledDay);

    const sessionBudget = contentBudgetForMinutes(session.estimatedMinutes);
    if (session.contentTargets.length > sessionBudget.maximumContentTargets) {
      addIssue("session_content_budget", `Session ${index + 1} is ${session.estimatedMinutes} minutes but contains ${session.contentTargets.length} content targets; its limit is ${sessionBudget.maximumContentTargets}.`);
    }
    if (session.completionEvidence.length > sessionBudget.maximumCompletionChecks) {
      addIssue("session_content_budget", `Session ${index + 1} is ${session.estimatedMinutes} minutes but requires ${session.completionEvidence.length} separate completion checks; its limit is ${sessionBudget.maximumCompletionChecks}.`);
    }
    if (!session.completionEvidence.every(isActiveCompletionEvidence)) {
      addIssue("completion_evidence", `Session ${index + 1} must define completion through something the learner produces or attempts, not time spent or passive exposure.`);
    }

    const routing = buildLearningScienceRoutingBrief({
      learningIntent: request.learningIntent,
      sessionLearningMode: session.learningMode,
      goalTitle: `${request.goal}. ${draft.title}`,
      goalTopic: `${request.startingContext ?? ""}. ${draft.topic}`,
      goalKind: draft.kind,
      sessionTitle: session.title,
      sessionObjective: session.objective,
      plannedMethod: session.method,
      plannedMethodReason: session.methodReason,
      learnerProfile: null,
      recentResults: [],
      interruptionCount: 0,
      taskTypeOverride,
    });
    const methodId = methodIdFromText(session.method);
    if (!methodId) {
      addIssue("method_routing", `Session ${index + 1} must name an approved YOVA learning method instead of a generic activity label.`);
    } else if (!getCoreLearningMethod(methodId).taskTypes.includes(routing.taskType)) {
      addIssue("method_routing", `Session ${index + 1} uses ${getCoreLearningMethod(methodId).name}, which does not fit its ${routing.taskType.replaceAll("_", " ")} task.`);
    }
  }

  if (request.intent === "plan") {
    for (const [date, scheduled] of scheduledMinutesByDate) {
      const availableMinutes = totalMinutesForWeekday(scheduled.weekday, request.availability);
      if (availableMinutes !== null && scheduled.minutes > availableMinutes) {
        addIssue("schedule_fit", `${date} contains ${scheduled.minutes} planned minutes, but the learner only made ${availableMinutes} total minutes available that day.`);
      }
    }
  }

  if (request.knowledgeMap) {
    const knownTopicIds = new Set(request.knowledgeMap.topics.map((topic) => topic.id));
    if (draft.sessions.some((session) => (session.topicIds ?? []).length === 0)) {
      addIssue("knowledge_map_coverage", "Every session must reference at least one knowledge-map topic id.");
    }
    const coveredTopicIds = new Set(draft.sessions.flatMap((session) => session.topicIds ?? []));
    const deferredTopicIds = new Set((draft.deferredTopics ?? []).map((topic) => topic.topicId));
    const unknown = [...coveredTopicIds, ...deferredTopicIds].filter((id) => !knownTopicIds.has(id));
    if (unknown.length) addIssue("knowledge_map_coverage", "The plan references topic ids that are not in the knowledge map.");
    const duplicated = [...deferredTopicIds].filter((id) => coveredTopicIds.has(id));
    if (duplicated.length) addIssue("knowledge_map_coverage", "A topic cannot be both scheduled and deferred.");
    const unaccounted = [...knownTopicIds].filter((id) => !coveredTopicIds.has(id) && !deferredTopicIds.has(id));
    if (unaccounted.length) {
      addIssue("knowledge_map_coverage", `${unaccounted.length} knowledge-map ${unaccounted.length === 1 ? "topic is" : "topics are"} neither scheduled nor explicitly deferred.`);
    }
    if (request.knowledgeMap.placementCheck.status === "skipped" && request.knowledgeMap.topics.some((topic) => topic.initialEvidence !== null)) {
      addIssue("placement_contract", "A skipped placement check must not create initial topic evidence.");
    }
    const gapTopicIds = request.knowledgeMap.topics.filter((topic) => topic.initialEvidence?.outcome === "gap").map((topic) => topic.id);
    for (const topicId of gapTopicIds) {
      if (!draft.sessions.some((session) => session.learningMode === "learn" && session.topicIds.includes(topicId))) {
        addIssue("placement_contract", "Every confirmed placement gap must receive teaching-first coverage.");
        break;
      }
    }
    // `learningMode` describes the first job of the whole session, not the
    // treatment of every topic id inside it. A demonstrated prerequisite may
    // legitimately be checked briefly inside a teaching-first session for a
    // connected gap. All map topics are already required to be scheduled or
    // explicitly deferred above; the generated session's per-topic practice
    // contract enforces light verification for demonstrated evidence.
  }

  const learnerFacingText = [
    draft.title,
    draft.topic,
    draft.rationale,
    ...draft.sessions.flatMap((session) => [
      session.title,
      session.objective,
      session.method,
      session.methodReason,
      session.amountLabel,
      ...session.contentTargets,
      ...session.completionEvidence,
    ]),
  ].join(" ");
  if (OVERCLAIM_PATTERN.test(learnerFacingText)) {
    addIssue("unsupported_claim", "The plan makes an unsupported fixed learning-style, brain-type, or diagnosis claim.");
  }
  if (RAW_FORMATTING_PATTERN.test(learnerFacingText)) {
    addIssue("interface_format", "The plan must use clean interface text without raw Markdown, em dashes, or en dashes.");
  }

  return issues.length > 0
    ? {
        code: issues[0].code,
        detail: issues.slice(0, 8).map((issue) => issue.detail).join(" "),
      }
    : null;
}

export function isActiveCompletionEvidence(value: string) {
  return ACTIVE_EVIDENCE_PATTERN.test(value);
}

function maximumMinutesForWeekday(
  weekday: string,
  availability: PlanGenerationRequest["availability"],
) {
  const matches = availability
    .filter((slot) => slot.day.toLowerCase() === weekday.toLowerCase() || slot.day.toLowerCase() === "every day")
    .map((slot) => slot.minutes);
  return matches.length > 0 ? Math.max(...matches) : null;
}

function totalMinutesForWeekday(
  weekday: string,
  availability: PlanGenerationRequest["availability"],
) {
  const matches = availability
    .filter((slot) => slot.day.toLowerCase() === weekday.toLowerCase() || slot.day.toLowerCase() === "every day")
    .map((slot) => slot.minutes);
  return matches.length > 0 ? matches.reduce((total, minutes) => total + minutes, 0) : null;
}

function normalize(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}
