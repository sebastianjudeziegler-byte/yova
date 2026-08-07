import type {
  LearningPlan,
  LearningPlanSession,
  SessionCompletion,
  SessionInterruption,
} from "@/lib/domain";
import { summarizeConceptEvidence } from "@/lib/learning/concept-evidence";
import { summarizeConfidenceCalibration } from "@/lib/learning/confidence-calibration";
import { expandedLearnerContextFromAnswers } from "@/lib/personalization/learner-profile";

export type SessionDecisionSignal = {
  kind: "task" | "learner" | "evidence" | "source";
  label: string;
  title: string;
  detail: string;
  strength: "starting_context" | "observed" | "direct";
};

export function buildSessionDecisionSignals({
  plan,
  session,
  answers,
  completions,
  interruptions,
}: {
  plan: LearningPlan;
  session: LearningPlanSession;
  answers: string[];
  completions: SessionCompletion[];
  interruptions: SessionInterruption[];
}): SessionDecisionSignal[] {
  const signals: SessionDecisionSignal[] = [taskSignal(session)];
  const learnerSignal = profileSignal(answers, session.learningMode);
  if (learnerSignal) signals.push(learnerSignal);
  signals.push(evidenceSignal(session, completions, interruptions, answers));
  signals.push(sourceSignal(plan));
  return signals.slice(0, 4);
}

function taskSignal(session: LearningPlanSession): SessionDecisionSignal {
  return session.learningMode === "learn"
    ? {
      kind: "task",
      label: "Task decision",
      title: "Build an accurate model before testing it",
      detail: `${session.method} was selected because this session is still building understanding. YOVA should reduce support only after an accurate attempt appears.`,
      strength: "direct",
    }
    : {
      kind: "task",
      label: "Task decision",
      title: "Start with evidence, then repair only the gap",
      detail: `${session.method} was selected because this session is checking or strengthening knowledge that has already been introduced.`,
      strength: "direct",
    };
}

function profileSignal(answers: string[], learningMode: LearningPlanSession["learningMode"]): SessionDecisionSignal | null {
  const expanded = expandedLearnerContextFromAnswers(answers);
  const selected = learningMode === "learn"
    ? expanded.processingPreference
    : expanded.memoryChallenge;
  const title = selected ?? answers[0]?.trim() ?? null;
  if (!title) return null;

  const detail = learningMode === "learn" && expanded.processingPreference
    ? "This changes how the explanation begins. It does not override the task-appropriate method, and YOVA will compare it with the learner's actual work."
    : learningMode === "study" && expanded.memoryChallenge
      ? "This changes what YOVA checks for during practice and review. It remains a learner-reported starting hypothesis until session evidence supports it."
      : "This changes the size and clarity of the first action. It is not treated as evidence about ability or knowledge.";

  return {
    kind: "learner",
    label: "Your context",
    title,
    detail,
    strength: "starting_context",
  };
}

function evidenceSignal(
  session: LearningPlanSession,
  completions: SessionCompletion[],
  interruptions: SessionInterruption[],
  answers: string[],
): SessionDecisionSignal {
  if (session.adaptationNote) {
    return {
      kind: "evidence",
      label: "Prior evidence",
      title: "The previous result changed this session",
      detail: session.adaptationNote.explanation,
      strength: "observed",
    };
  }

  const calibration = summarizeConfidenceCalibration(
    completions.flatMap((completion) => completion.confidenceEvidence),
  );
  if (calibration.pattern === "possible_misconception" || calibration.pattern === "mixed") {
    return {
      kind: "evidence",
      label: "Prior evidence",
      title: "A confident miss needs a different application",
      detail: "YOVA will briefly rebuild the tempting mix-up, then check the correction in a different form instead of repeating the same answer.",
      strength: "observed",
    };
  }

  const concepts = summarizeConceptEvidence(completions);
  const needsReview = concepts.find((concept) => concept.status === "needs_review");
  if (needsReview) {
    return {
      kind: "evidence",
      label: "Prior evidence",
      title: `${needsReview.concept} needs another independent check`,
      detail: `The latest observed result needs review. YOVA will bring it back before treating the concept as stable.`,
      strength: "observed",
    };
  }
  const showingStrength = concepts.find((concept) => concept.status === "showing_strength");
  if (showingStrength) {
    return {
      kind: "evidence",
      label: "Prior evidence",
      title: `${showingStrength.concept} is showing strength`,
      detail: `${showingStrength.secureAttempts} successful independent checks let YOVA reduce routine review while preserving a later transfer check.`,
      strength: "observed",
    };
  }

  const correction = expandedLearnerContextFromAnswers(answers).observationCorrection;
  const recentInterruptions = interruptions.slice(-4);
  if (recentInterruptions.length >= 2 && !correction) {
    return {
      kind: "evidence",
      label: "Recent behavior",
      title: "Make the entry smaller without lowering the target",
      detail: `${recentInterruptions.length} recent sessions ended early. YOVA will reduce switching and preserve a clear resume point, but will not treat this as evidence about ability.`,
      strength: "observed",
    };
  }

  return {
    kind: "evidence",
    label: "Evidence status",
    title: completions.length ? "Keep collecting comparable results" : "No completed-session evidence yet",
    detail: completions.length
      ? "The existing results do not justify a stronger change. YOVA will preserve the task-first route and learn from the next check."
      : "The learner profile shapes the starting delivery, but answers and independent performance will matter more after this session.",
    strength: completions.length ? "observed" : "starting_context",
  };
}

function sourceSignal(plan: LearningPlan): SessionDecisionSignal {
  const materialCount = plan.materials?.length ?? 0;
  if (materialCount > 0) {
    return {
      kind: "source",
      label: "Learning source",
      title: `${materialCount} private ${materialCount === 1 ? "source" : "sources"} define the scope`,
      detail: "YOVA will anchor the session to those materials and add general AI teaching only when the supplied source leaves an important gap.",
      strength: "direct",
    };
  }
  return {
    kind: "source",
    label: "Context recommendation",
    title: "More specific context will make this session sharper",
    detail: "YOVA can create the lesson from the topic alone. Add a study guide, slides, notes, rubric, or a short description whenever the exact scope matters.",
    strength: "direct",
  };
}
