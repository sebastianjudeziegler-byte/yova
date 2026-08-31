import type {
  LearningPlan,
  LearningPlanSession,
  SessionCompletion,
  SessionInterruption,
} from "@/lib/domain";
import type { LearningTaskType } from "@/lib/learning/method-catalog";
import type { CoreMethodId } from "@/lib/learning/method-catalog";
import { completionCreatesTopicEvidence } from "@/lib/learning/session-completion-provenance";
import {
  inferKnowledgeStage,
  inferLearningTaskType,
  type KnowledgeStage,
} from "@/lib/learning/method-router";
import {
  METHOD_EVIDENCE_MINIMUM_CHECKED_ANSWERS,
  METHOD_EVIDENCE_MINIMUM_DISTINCT_STUDY_DAYS,
  METHOD_EVIDENCE_MINIMUM_SESSIONS,
  methodEvidenceComparisonContextForRoute,
  methodEvidenceComparisonKey,
  methodEvidenceMeetsMinimum,
} from "@/lib/study-route/method-evidence-policy";

export type MethodFamily =
  | "guided_explanation"
  | "retrieval"
  | "practice"
  | "assessment"
  | "focused_work";

export type MethodSignalStatus = "early_signal" | "promising" | "needs_support";

export type MethodSignal = {
  family: MethodFamily;
  label: string;
  taskType: LearningTaskType;
  knowledgeStage: KnowledgeStage;
  comparisonLabel: string;
  sessions: number;
  distinctStudyDays: number;
  checkedAnswers: number;
  correctAnswers: number;
  averageAccuracy: number | null;
  difficultRatings: number;
  easyRatings: number;
  interruptions: number;
  status: MethodSignalStatus;
  summary: string;
};

const methodLabels: Record<MethodFamily, string> = {
  guided_explanation: "Guided explanations",
  retrieval: "Retrieval practice",
  practice: "Application practice",
  assessment: "Quizzes and checks",
  focused_work: "Focused study",
};

const routeMethodFamilies: Record<CoreMethodId, MethodFamily> = {
  retrieval_practice: "retrieval",
  spaced_retrieval: "retrieval",
  self_explanation: "guided_explanation",
  worked_example_fading: "guided_explanation",
  interleaved_practice: "practice",
  read_recall_review: "guided_explanation",
  pretesting: "guided_explanation",
  concept_mapping: "guided_explanation",
  practice_problems: "practice",
  retrieval_based_outlining: "practice",
  scaffolded_coding: "practice",
  practice_test_error_repair: "assessment",
};

function methodFamily(session: LearningPlanSession): MethodFamily {
  const committedMethodId = session.studyRoute?.approach.primaryMethodId;
  if (committedMethodId) return routeMethodFamilies[committedMethodId];
  const method = methodText(session);

  if (/guided|explanation|explain|worked example|teach|understand/.test(method)) {
    return "guided_explanation";
  }
  if (/retriev|recall|flashcard|blurt/.test(method)) return "retrieval";
  if (/practice|application|problem|interleav|mixed/.test(method)) return "practice";
  if (/assessment|test|quiz|check/.test(method)) return "assessment";
  return "focused_work";
}

function methodText(session: LearningPlanSession) {
  return session.method.toLowerCase();
}

function signalStatus(
  sessions: number,
  distinctStudyDays: number,
  checkedAnswers: number,
  averageAccuracy: number | null,
  difficultRatings: number,
  canonicalComparable: boolean,
): MethodSignalStatus {
  if (
    !canonicalComparable
    || averageAccuracy === null
    || !methodEvidenceMeetsMinimum({
      sessions,
      checkedAnswers,
      distinctStudyDays,
    })
  ) return "early_signal";
  if (averageAccuracy < 55 || difficultRatings > sessions / 2) return "needs_support";
  if (averageAccuracy >= 80 && difficultRatings <= sessions / 2) return "promising";
  return "early_signal";
}

function signalSummary(
  status: MethodSignalStatus,
  sessions: number,
  distinctStudyDays: number,
  checkedAnswers: number,
  averageAccuracy: number | null,
  canonicalComparable: boolean,
) {
  if (!canonicalComparable) {
    return "Historical sessions without an exact committed route remain context only; YOVA will not use them for a strong method recommendation.";
  }
  if (sessions < METHOD_EVIDENCE_MINIMUM_SESSIONS) {
    return sessions === 1
      ? "One completed session is not enough to judge this method yet."
      : `${sessions} comparable sessions are still early evidence; YOVA waits for at least ${METHOD_EVIDENCE_MINIMUM_SESSIONS} before changing a method-level recommendation.`;
  }
  if (distinctStudyDays < METHOD_EVIDENCE_MINIMUM_DISTINCT_STUDY_DAYS) {
    return "These checks happened on too few separate study days to support a stable method recommendation.";
  }
  if (checkedAnswers < METHOD_EVIDENCE_MINIMUM_CHECKED_ANSWERS || averageAccuracy === null) {
    return "These sessions were completed, but YOVA needs comparable knowledge checks before evaluating the method.";
  }
  if (status === "promising") {
    return `Recent checks after these sessions averaged ${averageAccuracy}%. This is a promising signal, not proof that the method is always best.`;
  }
  if (status === "needs_support") {
    return "Recent results suggest this method may need more guidance or smaller steps before YOVA relies on it more.";
  }
  return "YOVA has some evidence for this method, but not enough yet to change your plans confidently.";
}

export function buildMethodSignals(
  plans: LearningPlan[],
  completions: SessionCompletion[],
  interruptions: SessionInterruption[],
): MethodSignal[] {
  const sessionsById = new Map<string, { plan: LearningPlan; session: LearningPlanSession }>();
  for (const plan of plans) {
    for (const session of plan.sessions) sessionsById.set(session.id, { plan, session });
  }

  type SignalAccumulator = Omit<
    MethodSignal,
    "label" | "status" | "summary" | "averageAccuracy" | "comparisonLabel" | "distinctStudyDays"
  > & {
    canonicalComparable: boolean;
    studyDays: Set<string>;
    latestObservedAt: string;
  };
  const grouped = new Map<string, SignalAccumulator>();
  const usedRouteRevisions = new Set<string>();
  const orderedCompletions = completions
    .filter(completionCreatesTopicEvidence)
    .sort((left, right) => (
      right.completedAt.localeCompare(left.completedAt)
      || left.id.localeCompare(right.id)
    ));
  for (const completion of orderedCompletions) {
    const source = sessionsById.get(completion.planSessionId);
    if (!source) continue;
    const { plan, session } = source;
    if (!eventMatchesCommittedRoute(completion.routeRevisionId, session)) continue;
    const routeRevisionId = session.studyRoute?.identity.routeRevisionId;
    if (routeRevisionId && usedRouteRevisions.has(routeRevisionId)) continue;
    if (routeRevisionId) usedRouteRevisions.add(routeRevisionId);
    const scope = methodSignalScope(plan, session);
    const { family, comparison, key, canonicalComparable } = scope;
    const current = grouped.get(key) ?? {
      family,
      taskType: comparison.taskType,
      knowledgeStage: comparison.knowledgeStage,
      sessions: 0,
      checkedAnswers: 0,
      correctAnswers: 0,
      difficultRatings: 0,
      easyRatings: 0,
      interruptions: 0,
      canonicalComparable,
      studyDays: new Set<string>(),
      latestObservedAt: completion.completedAt,
    };
    current.sessions += 1;
    current.checkedAnswers += Math.max(0, completion.totalAnswers);
    current.correctAnswers += Math.max(0, Math.min(completion.correctAnswers, completion.totalAnswers));
    if (completion.feedback === "too_difficult") current.difficultRatings += 1;
    if (completion.feedback === "too_easy") current.easyRatings += 1;
    current.studyDays.add(completion.completedAt.slice(0, 10));
    if (completion.completedAt > current.latestObservedAt) {
      current.latestObservedAt = completion.completedAt;
    }
    grouped.set(key, current);
  }

  for (const interruption of interruptions) {
    const source = sessionsById.get(interruption.planSessionId);
    if (!source) continue;
    const { plan, session } = source;
    if (!eventMatchesCommittedRoute(interruption.routeRevisionId, session)) continue;
    const current = grouped.get(methodSignalScope(plan, session).key);
    if (current) current.interruptions += 1;
  }

  // Exact methods and unlike route contexts never pool. The learner-facing
  // family card shows only the strongest one of those coherent cohorts.
  const cohortsByDisplayScope = new Map<string, SignalAccumulator[]>();
  for (const signal of grouped.values()) {
    const key = `${signal.family}:${signal.taskType}:${signal.knowledgeStage}`;
    const current = cohortsByDisplayScope.get(key) ?? [];
    current.push(signal);
    cohortsByDisplayScope.set(key, current);
  }
  const displayCohorts = [...cohortsByDisplayScope.values()].map((cohorts) => (
    [...cohorts].sort(compareSignalCohortStrength)[0]!
  ));

  return displayCohorts
    .map((signal): MethodSignal => {
      const averageAccuracy = signal.checkedAnswers > 0
        ? Math.round((signal.correctAnswers / signal.checkedAnswers) * 100)
        : null;
      const distinctStudyDays = signal.studyDays.size;
      const status = signalStatus(
        signal.sessions,
        distinctStudyDays,
        signal.checkedAnswers,
        averageAccuracy,
        signal.difficultRatings,
        signal.canonicalComparable,
      );
      return {
        family: signal.family,
        taskType: signal.taskType,
        knowledgeStage: signal.knowledgeStage,
        sessions: signal.sessions,
        checkedAnswers: signal.checkedAnswers,
        correctAnswers: signal.correctAnswers,
        difficultRatings: signal.difficultRatings,
        easyRatings: signal.easyRatings,
        interruptions: signal.interruptions,
        label: methodLabels[signal.family],
        comparisonLabel: comparisonLabel(signal.taskType, signal.knowledgeStage),
        distinctStudyDays,
        averageAccuracy,
        status,
        summary: signalSummary(
          status,
          signal.sessions,
          distinctStudyDays,
          signal.checkedAnswers,
          averageAccuracy,
          signal.canonicalComparable,
        ),
      };
    })
    .sort((left, right) => right.sessions - left.sessions || left.label.localeCompare(right.label));
}

function methodSignalScope(
  plan: LearningPlan,
  session: LearningPlanSession,
) {
  const family = methodFamily(session);
  const comparison = personalizationComparisonContext(plan, session);
  const route = session.studyRoute;
  if (
    route?.identity.lifecycleStatus === "committed"
    && route.identity.planId === plan.id
    && route.identity.sessionId === session.id
    && route.timing.activeMinutes === session.estimatedMinutes
  ) {
    try {
      return {
        family,
        comparison,
        canonicalComparable: true,
        key: [
          family,
          route.approach.primaryMethodId,
          methodEvidenceComparisonKey(methodEvidenceComparisonContextForRoute(route)),
        ].join(":"),
      };
    } catch {
      // Invalid historical routes remain visible as early context only.
    }
  }
  return {
    family,
    comparison,
    canonicalComparable: false,
    key: `${family}:legacy_unscoped:${comparison.taskType}:${comparison.knowledgeStage}`,
  };
}

function compareSignalCohortStrength(
  left: {
    sessions: number;
    checkedAnswers: number;
    studyDays: Set<string>;
    latestObservedAt: string;
    canonicalComparable: boolean;
  },
  right: {
    sessions: number;
    checkedAnswers: number;
    studyDays: Set<string>;
    latestObservedAt: string;
    canonicalComparable: boolean;
  },
) {
  return Number(right.canonicalComparable) - Number(left.canonicalComparable)
    || right.sessions - left.sessions
    || right.checkedAnswers - left.checkedAnswers
    || right.studyDays.size - left.studyDays.size
    || right.latestObservedAt.localeCompare(left.latestObservedAt);
}

export function personalizationComparisonContext(
  plan: LearningPlan,
  session: LearningPlanSession,
) {
  const route = session.studyRoute;
  if (route) {
    const deferredIds = new Set(route.execution.deferredTargets.map((target) => target.targetId));
    const activeStages = route.target.targetStates
      .filter((target) => !deferredIds.has(target.targetId))
      .map((target) => target.stage);
    const knowledgeStage: KnowledgeStage = activeStages.includes("novice")
      ? "novice"
      : activeStages.includes("developing")
        ? "developing"
        : "retrieval_ready";
    return {
      taskType: route.target.taskFamily,
      knowledgeStage,
    };
  }
  const comparisonText = [plan.title, plan.topic, session.title, session.objective, session.method].join(" ");
  return {
    taskType: session.resource?.routingContext?.taskType
      ?? session.resource?.methodBriefing?.taskType
      ?? inferLearningTaskType(comparisonText),
    knowledgeStage: session.resource?.routingContext?.knowledgeStage
      ?? (session.learningMode === "learn"
        ? "novice" as const
        : inferKnowledgeStage([], comparisonText)),
  };
}

function eventMatchesCommittedRoute(
  routeRevisionId: string | null | undefined,
  session: LearningPlanSession,
) {
  const committedRouteRevisionId = session.studyRoute?.identity.routeRevisionId;
  return !committedRouteRevisionId || routeRevisionId === committedRouteRevisionId;
}

function comparisonLabel(taskType: LearningTaskType, knowledgeStage: KnowledgeStage) {
  const taskLabels: Record<LearningTaskType, string> = {
    memorization: "memorization",
    conceptual_learning: "concept learning",
    problem_solving: "problem solving",
    reading_to_quiz: "reading and recall",
    writing_argumentation: "writing and argumentation",
    programming: "programming",
    mixed_assessment: "mixed assessment",
  };
  const stage = knowledgeStage === "novice"
    ? "initial learning"
    : knowledgeStage === "retrieval_ready"
      ? "independent retrieval"
      : "developing knowledge";
  return `${taskLabels[taskType]} · ${stage}`;
}
