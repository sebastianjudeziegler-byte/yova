import type { GeneratedPlanDraft, PlanGenerationRequest } from "@/lib/plan-generation/schema";
import type { PlanTaskFamily } from "@/evals/plan-cases";
import { getCoreLearningMethod } from "@/lib/learning/method-catalog";
import {
  buildLearningScienceRoutingBrief,
  classifyLearningTask,
  methodFitsSessionMode,
  methodIdFromText,
} from "@/lib/learning/method-router";
import { buildPlanContentBudget } from "@/lib/plan-generation/content-budget";
import { inferPlanScopeContract } from "@/lib/plan-generation/scope-contract";

export type PlanQualityCheck = {
  id: string;
  label: string;
  passed: boolean;
  points: number;
  earned: number;
  required: boolean;
  detail: string;
};

export type PlanQualityResult = {
  score: number;
  passed: boolean;
  checks: PlanQualityCheck[];
  requiredFailures: string[];
};

export function evaluatePlanDraft(
  draft: GeneratedPlanDraft,
  request: PlanGenerationRequest,
  taskFamily: PlanTaskFamily,
): PlanQualityResult {
  const combined = [
    draft.title,
    draft.topic,
    draft.rationale,
    ...draft.sessions.flatMap((session) => [session.title, session.objective, session.method, session.methodReason, session.amountLabel]),
  ].join(" ");
  const scheduledWindows = draft.sessions.map((session) => {
    const weekday = new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: request.timeZone })
      .format(new Date(session.scheduledFor));
    const matchingWindow = request.availability.find((slot) => slot.day.toLowerCase() === weekday.toLowerCase());
    return { session, weekday, matchingWindow };
  });
  const sessionsFitAvailability = scheduledWindows.every(({ session, matchingWindow }) => (
    Boolean(matchingWindow) && session.estimatedMinutes <= (matchingWindow?.minutes ?? 0)
  ));
  const hasDeadlineViolation = request.deadline
    ? draft.sessions.some((session) => new Date(session.scheduledFor).getTime() > new Date(request.deadline as string).getTime())
    : false;
  const uniqueObjectives = new Set(draft.sessions.map((session) => normalize(session.objective))).size;
  const progression = progressionSignals(draft);
  const sourceLanguageIsSafe = request.materialMode !== "upload"
    || !/your (notes|materials|sources?) (show|prove|confirm|suggest) (that )?you (struggle|prefer|learn|focus|procrastinate)/i.test(combined);
  const approachProgression = request.learningIntent === "learn"
    ? draft.sessions[0]?.learningMode === "learn"
      && (request.intent === "study_now" || draft.sessions.some((session) => session.learningMode === "study"))
    : draft.sessions[0]?.learningMode === "study";
  const scope = inferPlanScopeContract(request);
  const contentBudget = buildPlanContentBudget(request, scope);
  const expectedMinimumSessions = request.intent === "study_now"
    ? 1
    : Math.max(scope.minimumSessions, contentBudget.minimumSessions);
  const expectedMaximumSessions = request.intent === "study_now" ? 1 : scope.maximumSessions;
  const knownTopicIds = new Set(request.knowledgeMap?.topics.map((topic) => topic.id) ?? []);
  const scheduledTopicIds = new Set(draft.sessions.flatMap((session) => session.topicIds));
  const deferredTopicIds = new Set(draft.deferredTopics.map((topic) => topic.topicId));
  const accountedTopics = [...knownTopicIds].filter((topicId) => scheduledTopicIds.has(topicId) || deferredTopicIds.has(topicId)).length;
  const hasOnlyKnownTopics = [...scheduledTopicIds, ...deferredTopicIds].every((topicId) => knownTopicIds.has(topicId));
  const originalTask = classifyLearningTask(request.goal);
  const taskTypeOverride = originalTask.confidence === "clear"
    ? originalTask.taskType
    : null;
  const scientificallyAlignedMethods = draft.sessions.filter((session) => {
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
    return Boolean(
      methodId
      && getCoreLearningMethod(methodId).taskTypes.includes(routing.taskType)
      && methodFitsSessionMode(methodId, routing.taskType, session.learningMode),
    );
  }).length;

  const checks: PlanQualityCheck[] = [
    check(
      "session_count",
      "Plan size fits the requested scope",
      draft.sessions.length >= expectedMinimumSessions && draft.sessions.length <= expectedMaximumSessions,
      10,
      true,
      `${draft.sessions.length} sessions for ${scope.label.toLowerCase()}; expected ${expectedMinimumSessions}-${expectedMaximumSessions}`,
    ),
    check("time_fit", "Sessions fit supplied availability", sessionsFitAvailability, 15, true, scheduledWindows.map(({ session, weekday, matchingWindow }) => `${weekday}: ${session.estimatedMinutes}/${matchingWindow?.minutes ?? 0} min`).join("; ")),
    check("deadline_fit", "No work is scheduled after the deadline", !hasDeadlineViolation, 15, true, request.deadline ? `Deadline: ${request.deadline}` : "No fixed deadline"),
    check(
      "method_alignment",
      "Methods fit each session's actual task",
      scientificallyAlignedMethods === draft.sessions.length,
      20,
      true,
      `${scientificallyAlignedMethods} of ${draft.sessions.length} sessions pass YOVA's task-to-method router (${taskFamily.replace("_", " ")} evaluation case)`,
    ),
    check("learning_progression", "Plan progresses toward retrieval or application", progression.early && progression.later, 15, true, progression.detail),
    check("learning_approach", "Plan separates teaching from practice", approachProgression, 0, true, `Requested ${request.learningIntent}; session sequence: ${draft.sessions.map((session) => session.learningMode).join(" → ")}`),
    check(
      "coverage_map",
      "Every mapped topic is scheduled or explicitly deferred",
      knownTopicIds.size > 0 && accountedTopics === knownTopicIds.size && hasOnlyKnownTopics,
      0,
      true,
      `${accountedTopics} of ${knownTopicIds.size} topics accounted for; ${scheduledTopicIds.size} scheduled and ${deferredTopicIds.size} deferred`,
    ),
    check("explainability", "Every method has a meaningful reason", draft.sessions.every((session) => session.methodReason.trim().length >= 20), 10, false, "Method reasons are visible to the learner"),
    check("distinct_objectives", "Sessions are not repetitive", uniqueObjectives === draft.sessions.length, 5, false, `${uniqueObjectives} distinct objectives across ${draft.sessions.length} sessions`),
    check("no_personality_overclaim", "No fixed brain or learning-style claims", !/learns? best|learning style|brain type|because (you have|of your) adhd|visual learner|auditory learner|kinesthetic learner/i.test(combined), 5, true, "Checked all learner-facing plan text"),
    check("source_restraint", "Uploaded sources are not used to justify invented facts", sourceLanguageIsSafe, 5, true, request.materialMode === "upload" ? "Source-grounded rationale reviewed" : "No uploaded source"),
  ];

  const score = checks.reduce((total, item) => total + item.earned, 0);
  const requiredFailures = checks.filter((item) => item.required && !item.passed).map((item) => item.label);
  return { score, passed: score >= 80 && requiredFailures.length === 0, checks, requiredFailures };
}

function progressionSignals(draft: GeneratedPlanDraft) {
  const splitIndex = Math.max(1, Math.ceil(draft.sessions.length / 2));
  const earlyText = draft.sessions.slice(0, splitIndex).map(sessionText).join(" ");
  const laterText = draft.sessions.slice(splitIndex).map(sessionText).join(" ");
  const early = /explain|example|model|understand|retriev|recall|diagnos|outline|trace/i.test(earlyText);
  const later = /apply|practice|test|assess|solve|draft|write|implement|review|mixed|independent/i.test(laterText);
  return { early, later, detail: `Early foundation signal: ${early ? "yes" : "no"}; later application/review signal: ${later ? "yes" : "no"}` };
}

function sessionText(session: GeneratedPlanDraft["sessions"][number]) {
  return `${session.title} ${session.objective} ${session.method} ${session.methodReason}`;
}

function normalize(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function check(id: string, label: string, passed: boolean, points: number, required: boolean, detail: string): PlanQualityCheck {
  return { id, label, passed, points, earned: passed ? points : 0, required, detail };
}
