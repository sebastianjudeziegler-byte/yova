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

const ACTIVE_EVIDENCE_PATTERN = /\b(answer|apply|attempt|build|calculate|choose|classify|compare|complete|construct|create|debug|demonstrate|distinguish|draft|evaluate|explain|formulate|identify|implement|label|map|outline|perform|produce|recall|retrieve|revise|select|solve|summarize|test|trace|write)\b/i;
const OVERCLAIM_PATTERN = /learns? best|learning style|brain type|visual learner|auditory learner|kinesthetic learner|because (?:you have|of your) adhd|diagnos(?:is|ed|e)\b/i;
const RAW_FORMATTING_PATTERN = /[\u2013\u2014]|\*\*|__|(^|\s)#{1,6}\s/m;

export function validateGeneratedPlanQuality(
  draft: GeneratedPlanDraft,
  request: PlanGenerationRequest,
): string | null {
  const issues: string[] = [];
  const scope = inferPlanScopeContract(request);
  const contentBudget = buildPlanContentBudget(request, scope);
  const originalTask = classifyLearningTask(request.goal);
  const taskTypeOverride = originalTask.confidence === "clear"
    ? originalTask.taskType
    : null;

  if (request.intent === "study_now" && draft.sessions.length !== 1) {
    issues.push("A study-now request must produce exactly one focused session.");
  }

  if (request.intent === "plan" && draft.sessions.length < scope.minimumSessions) {
    issues.push(`${scope.label} needs at least ${scope.minimumSessions} sessions so the requested scope is not superficially compressed.`);
  }
  if (request.intent === "plan" && draft.sessions.length < contentBudget.minimumSessions) {
    issues.push(`The supplied material and session length need at least ${contentBudget.minimumSessions} sessions so the content is not compressed.`);
  }
  if (request.intent === "plan" && draft.sessions.length > scope.maximumSessions) {
    issues.push(`${scope.label} should use no more than ${scope.maximumSessions} sessions in YOVA Lite.`);
  }

  const teachingSessions = draft.sessions.filter((session) => session.learningMode === "learn").length;
  if (request.intent === "plan" && teachingSessions < scope.minimumTeachingSessions) {
    issues.push(`${scope.label} needs at least ${scope.minimumTeachingSessions} teaching-first sessions before or between unsupported practice.`);
  }

  if (draft.sessions[0]?.learningMode !== request.learningIntent) {
    issues.push(`The first session must use the requested ${request.learningIntent} starting approach.`);
  }

  if (
    request.intent === "plan"
    && request.learningIntent === "learn"
    && draft.sessions.length > 1
    && !draft.sessions.slice(1).some((session) => session.learningMode === "study")
  ) {
    issues.push("A multi-session learning plan must eventually move from teaching into retrieval, application, or assessment.");
  }

  const objectiveKeys = draft.sessions.map((session) => normalize(session.objective));
  if (new Set(objectiveKeys).size !== objectiveKeys.length) {
    issues.push("Every session needs a distinct objective rather than repeating the same work across the plan.");
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
      issues.push(`Session ${index + 1} is scheduled after the learner's deadline.`);
    }

    const availableMinutes = request.intent === "study_now"
      ? request.availability[0]?.minutes
      : maximumMinutesForWeekday(
        weekdayFormatter.format(new Date(session.scheduledFor)),
        request.availability,
      );
    if (!availableMinutes) {
      issues.push(`Session ${index + 1} is scheduled on a day the learner did not make available.`);
    } else if (session.estimatedMinutes > availableMinutes) {
      issues.push(`Session ${index + 1} needs ${session.estimatedMinutes} minutes, but the learner only made ${availableMinutes} minutes available.`);
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
      issues.push(`Session ${index + 1} is ${session.estimatedMinutes} minutes but contains ${session.contentTargets.length} content targets; its limit is ${sessionBudget.maximumContentTargets}.`);
    }
    if (session.completionEvidence.length > sessionBudget.maximumCompletionChecks) {
      issues.push(`Session ${index + 1} is ${session.estimatedMinutes} minutes but requires ${session.completionEvidence.length} separate completion checks; its limit is ${sessionBudget.maximumCompletionChecks}.`);
    }
    if (!session.completionEvidence.every(isActiveCompletionEvidence)) {
      issues.push(`Session ${index + 1} must define completion through something the learner produces or attempts, not time spent or passive exposure.`);
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
      issues.push(`Session ${index + 1} must name an approved YOVA learning method instead of a generic activity label.`);
    } else if (!getCoreLearningMethod(methodId).taskTypes.includes(routing.taskType)) {
      issues.push(`Session ${index + 1} uses ${getCoreLearningMethod(methodId).name}, which does not fit its ${routing.taskType.replaceAll("_", " ")} task.`);
    }
  }

  if (request.intent === "plan") {
    for (const [date, scheduled] of scheduledMinutesByDate) {
      const availableMinutes = totalMinutesForWeekday(scheduled.weekday, request.availability);
      if (availableMinutes !== null && scheduled.minutes > availableMinutes) {
        issues.push(`${date} contains ${scheduled.minutes} planned minutes, but the learner only made ${availableMinutes} total minutes available that day.`);
      }
    }
  }

  if (request.intent === "plan") {
    const distinctTargets = new Set(
      draft.sessions
        .flatMap((session) => session.contentTargets)
        .map(normalize)
        .filter(Boolean),
    ).size;
    if (distinctTargets < contentBudget.minimumDistinctTargets) {
      issues.push(`The plan maps only ${distinctTargets} distinct content targets, but this scope needs at least ${contentBudget.minimumDistinctTargets}.`);
    }
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
    issues.push("The plan makes an unsupported fixed learning-style, brain-type, or diagnosis claim.");
  }
  if (RAW_FORMATTING_PATTERN.test(learnerFacingText)) {
    issues.push("The plan must use clean interface text without raw Markdown, em dashes, or en dashes.");
  }

  return issues.length > 0 ? issues.slice(0, 8).join(" ") : null;
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
