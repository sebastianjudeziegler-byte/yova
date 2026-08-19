import type {
  LearningPlan,
  LearningPlanSession,
  SessionCompletion,
  SessionInterruption,
} from "@/lib/domain";
import type { LearningTaskType } from "@/lib/learning/method-catalog";
import { completionCreatesTopicEvidence } from "@/lib/learning/session-completion-provenance";
import {
  inferKnowledgeStage,
  inferLearningTaskType,
  type KnowledgeStage,
} from "@/lib/learning/method-router";

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

function methodFamily(session: LearningPlanSession): MethodFamily {
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
  checkedAnswers: number,
  averageAccuracy: number | null,
  difficultRatings: number,
): MethodSignalStatus {
  if (sessions < 2 || checkedAnswers < 2 || averageAccuracy === null) return "early_signal";
  if (averageAccuracy < 60 || difficultRatings > sessions / 2) return "needs_support";
  if (averageAccuracy >= 75 && difficultRatings <= sessions / 2) return "promising";
  return "early_signal";
}

function signalSummary(
  status: MethodSignalStatus,
  sessions: number,
  checkedAnswers: number,
  averageAccuracy: number | null,
) {
  if (sessions < 2) {
    return "One completed session is not enough to judge this method yet.";
  }
  if (checkedAnswers < 2 || averageAccuracy === null) {
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

  const grouped = new Map<string, Omit<MethodSignal, "label" | "status" | "summary" | "averageAccuracy" | "comparisonLabel">>();
  for (const completion of completions.filter(completionCreatesTopicEvidence)) {
    const source = sessionsById.get(completion.planSessionId);
    if (!source) continue;
    const { plan, session } = source;
    const family = methodFamily(session);
    const comparison = personalizationComparisonContext(plan, session);
    const key = `${family}:${comparison.taskType}:${comparison.knowledgeStage}`;
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
    };
    current.sessions += 1;
    current.checkedAnswers += Math.max(0, completion.totalAnswers);
    current.correctAnswers += Math.max(0, Math.min(completion.correctAnswers, completion.totalAnswers));
    if (completion.feedback === "too_difficult") current.difficultRatings += 1;
    if (completion.feedback === "too_easy") current.easyRatings += 1;
    grouped.set(key, current);
  }

  for (const interruption of interruptions) {
    const source = sessionsById.get(interruption.planSessionId);
    if (!source) continue;
    const { plan, session } = source;
    const family = methodFamily(session);
    const comparison = personalizationComparisonContext(plan, session);
    const current = grouped.get(`${family}:${comparison.taskType}:${comparison.knowledgeStage}`);
    if (current) current.interruptions += 1;
  }

  return [...grouped.values()]
    .map((signal): MethodSignal => {
      const averageAccuracy = signal.checkedAnswers > 0
        ? Math.round((signal.correctAnswers / signal.checkedAnswers) * 100)
        : null;
      const status = signalStatus(
        signal.sessions,
        signal.checkedAnswers,
        averageAccuracy,
        signal.difficultRatings,
      );
      return {
        ...signal,
        label: methodLabels[signal.family],
        comparisonLabel: comparisonLabel(signal.taskType, signal.knowledgeStage),
        averageAccuracy,
        status,
        summary: signalSummary(status, signal.sessions, signal.checkedAnswers, averageAccuracy),
      };
    })
    .sort((left, right) => right.sessions - left.sessions || left.label.localeCompare(right.label));
}

export function personalizationComparisonContext(
  plan: LearningPlan,
  session: LearningPlanSession,
) {
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
