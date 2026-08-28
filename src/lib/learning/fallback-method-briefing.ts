import type {
  LearningPlan,
  LearningPlanSession,
  SessionMethodBriefing,
} from "@/lib/domain";
import {
  getCoreLearningMethod,
  type CoreMethodId,
  type LearningTaskType,
} from "@/lib/learning/method-catalog";
import {
  inferLearningTaskType,
  methodFitsSessionMode,
  methodIdFromText,
} from "@/lib/learning/method-router";
import type { SessionDeliveryPolicy } from "@/lib/personalization/session-delivery-policy";
import type { StudyRoute } from "@/lib/study-route/schema";

const DEFAULT_METHOD_BY_TASK: Record<LearningTaskType, CoreMethodId> = {
  memorization: "retrieval_practice",
  conceptual_learning: "self_explanation",
  problem_solving: "worked_example_fading",
  reading_to_quiz: "read_recall_review",
  writing_argumentation: "retrieval_based_outlining",
  programming: "scaffolded_coding",
  mixed_assessment: "practice_test_error_repair",
};

const DEFAULT_LEARN_METHOD_BY_TASK: Record<LearningTaskType, CoreMethodId> = {
  ...DEFAULT_METHOD_BY_TASK,
  mixed_assessment: "self_explanation",
};

export const GENERIC_INSIDE_FALLBACK_METHOD_NAME = "Objective check and application";

const OUTSIDE_SOURCE_PERSONALIZATION =
  "Your outside source remains the source of truth; YOVA provides the sequence and evidence check.";

export function buildFallbackMethodBriefing(
  plan: LearningPlan,
  session: LearningPlanSession,
  deliveryPolicy?: SessionDeliveryPolicy,
): SessionMethodBriefing {
  const taskType = inferLearningTaskType([
    plan.title,
    plan.topic,
    plan.kind,
    session.title,
    session.objective,
  ].join(" "));
  const namedMethodId = methodIdFromText(session.method);
  const defaultMethodId = session.learningMode === "learn"
    ? DEFAULT_LEARN_METHOD_BY_TASK[taskType]
    : DEFAULT_METHOD_BY_TASK[taskType];
  const namedMethodFits = Boolean(namedMethodId
    && getCoreLearningMethod(namedMethodId).taskTypes.includes(taskType)
    && methodFitsSessionMode(namedMethodId, taskType, session.learningMode));
  const methodId = namedMethodFits && namedMethodId
    ? namedMethodId
    : defaultMethodId;
  const method = getCoreLearningMethod(methodId);
  const completion = session.completionEvidence?.find((item) => item.trim()) ?? method.completion;
  const plannedReason = session.methodReason.trim();
  const fallbackPersonalization = [
    `The method follows the ${taskType.replaceAll("_", " ")} task in this learning goal.`,
    `The amount of work is bounded to the current ${session.estimatedMinutes}-minute window.`,
    plan.studyMode === "outside_yova"
      ? OUTSIDE_SOURCE_PERSONALIZATION
      : "YOVA provides the content sequence and removes support before the final check.",
  ];
  const policyPersonalization = deliveryPolicy?.learnerFacingReasons ?? [];
  const personalization = plan.studyMode === "outside_yova"
    ? uniquePersonalization([
        OUTSIDE_SOURCE_PERSONALIZATION,
        ...policyPersonalization,
        ...fallbackPersonalization,
      ]).slice(0, 3)
    : uniquePersonalization(
        policyPersonalization.length ? policyPersonalization : fallbackPersonalization,
      ).slice(0, 3);

  return {
    learningMode: session.learningMode,
    taskType,
    methodId,
    name: method.name,
    what: method.what,
    why: namedMethodId && !namedMethodFits ? method.why : plannedReason || method.why,
    how: method.how,
    completion,
    personalization,
  };
}

/**
 * A committed route has already performed method selection. Recovery may use
 * simpler deterministic content, but it must not invoke a second router and
 * relabel the same revision as a different learning method.
 */
export function buildCommittedRouteFallbackMethodBriefing(
  route: StudyRoute,
  deliveryPolicy?: SessionDeliveryPolicy,
): SessionMethodBriefing {
  const method = getCoreLearningMethod(route.approach.primaryMethodId);
  const routeReason = route.explanation.shortReason.trim();
  const completionDescription = route.execution.completionEvidence[0]?.description.trim()
    ?? method.completion;
  const why = routeReason.length >= 20
    ? routeReason
    : `${routeReason} This remains the committed method for the current session.`;
  const completion = completionDescription.length >= 15
    ? completionDescription
    : `${completionDescription} Complete the route's independent evidence check.`;
  const routeReasonForLearner = `This recovery keeps the committed ${route.approach.visibleMethodName} route instead of selecting a different method.`;
  const timeReason = `The work remains bounded to the route's ${route.timing.activeMinutes}-minute active window.`;

  return {
    learningMode: route.approach.mode === "learn" ? "learn" : "study",
    taskType: route.target.taskFamily,
    methodId: route.approach.primaryMethodId,
    name: route.approach.visibleMethodName,
    what: method.what,
    why,
    how: method.how,
    completion,
    personalization: uniquePersonalization([
      routeReasonForLearner,
      ...(deliveryPolicy?.learnerFacingReasons ?? []),
      timeReason,
    ]).slice(0, 3),
  };
}

function uniquePersonalization(reasons: readonly string[]) {
  const seen = new Set<string>();

  return reasons.flatMap((reason) => {
    const trimmed = reason.trim();
    const normalized = trimmed.replace(/\s+/g, " ").toLocaleLowerCase();
    if (!trimmed || seen.has(normalized)) return [];
    seen.add(normalized);
    return [trimmed];
  });
}

/**
 * Describes the topic-agnostic inside-YOVA outage workflow without implying
 * that YOVA supplied subject teaching or a verified model answer.
 */
export function buildGenericInsideFallbackMethodBriefing(
  plan: LearningPlan,
  session: LearningPlanSession,
  deliveryPolicy?: SessionDeliveryPolicy,
): SessionMethodBriefing {
  const base = buildFallbackMethodBriefing(plan, session, deliveryPolicy);
  const completion = session.completionEvidence?.find((item) => item.trim())
    ?? "Complete an unsupported attempt, compare it with the saved target, then explain or apply one idea.";

  return {
    ...base,
    methodId: "retrieval_practice",
    name: GENERIC_INSIDE_FALLBACK_METHOD_NAME,
    what: "Make an unsupported attempt, compare it with the objective and saved target criteria, then improve or apply the response.",
    why: "Live subject teaching was unavailable, so this safe built-in session uses only the objective and criteria already saved in the plan and does not invent a subject answer.",
    how: [
      "Read the saved objective, content targets, and completion evidence.",
      "Write one unsupported attempt before judging it.",
      "Keep that attempt visible while comparing it with the saved criteria.",
      "Explain the relationship more clearly or apply it to one concrete case.",
    ],
    completion,
    personalization: [
      "This safe built-in session uses only the objective and targets already saved in your plan.",
      "Your answer stays visible while you compare it with the completion criteria.",
      ...(deliveryPolicy?.learnerFacingReasons.slice(0, 1) ?? []),
    ],
  };
}
