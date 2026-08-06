import type {
  LearningPlan,
  LearningPlanSession,
  SessionCompletion,
  SessionInterruption,
} from "@/lib/domain";

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
  const sessionsById = new Map<string, LearningPlanSession>();
  for (const plan of plans) {
    for (const session of plan.sessions) sessionsById.set(session.id, session);
  }

  const grouped = new Map<MethodFamily, Omit<MethodSignal, "label" | "status" | "summary" | "averageAccuracy">>();
  for (const completion of completions) {
    const session = sessionsById.get(completion.planSessionId);
    if (!session) continue;
    const family = methodFamily(session);
    const current = grouped.get(family) ?? {
      family,
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
    grouped.set(family, current);
  }

  for (const interruption of interruptions) {
    const session = sessionsById.get(interruption.planSessionId);
    if (!session) continue;
    const family = methodFamily(session);
    const current = grouped.get(family);
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
        averageAccuracy,
        status,
        summary: signalSummary(status, signal.sessions, signal.checkedAnswers, averageAccuracy),
      };
    })
    .sort((left, right) => right.sessions - left.sessions || left.label.localeCompare(right.label));
}
