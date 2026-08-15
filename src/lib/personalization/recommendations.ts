import type {
  LearningPlan,
  SessionCompletion,
  SessionInterruption,
} from "@/lib/domain";
import { summarizeConfidenceCalibration } from "@/lib/learning/confidence-calibration";
import {
  deepProfileAnswerCount,
  expandedLearnerContextFromAnswers,
} from "@/lib/personalization/learner-profile";
import { resolveLearnerPersonalization } from "@/lib/personalization/personalization-evidence";
import { buildMethodSignals } from "@/lib/personalization/method-signals";

export type PersonalizationRecommendation = {
  id: string;
  title: string;
  explanation: string;
  evidence: string;
  action: "improve_profile" | "open_learning" | "start_session" | "none";
  actionLabel: string | null;
  priority: number;
};

export function buildPersonalizationRecommendations({
  answers,
  plans,
  completions,
  interruptions,
}: {
  answers: string[];
  plans: LearningPlan[];
  completions: SessionCompletion[];
  interruptions: SessionInterruption[];
}) {
  const recommendations: PersonalizationRecommendation[] = [];
  const deepAnswers = deepProfileAnswerCount(answers);
  const expanded = expandedLearnerContextFromAnswers(answers);
  const personalization = resolveLearnerPersonalization({
    answers,
    plans,
    completions,
    interruptions,
  });
  const behaviorEnabled = personalization.state.controls.behavior;
  const legacyMethodEvidenceAllowed = behaviorEnabled
    && personalization.state.pausedSignalIds.length === 0
    && personalization.state.corrections.length === 0;

  if (
    personalization.state.controls.selfReport
    && personalization.state.controls.optionalQuestions
    && deepAnswers < 3
  ) {
    recommendations.push({
      id: "add-learning-context",
      title: "Give YOVA more context about how learning tends to break down for you",
      explanation: "A few optional answers can change how explanations begin, how quickly support fades, and what YOVA checks before moving on.",
      evidence: `${deepAnswers} of 5 deeper profile signals supplied`,
      action: "improve_profile",
      actionLabel: "Deepen your profile",
      priority: 100,
    });
  }

  if (plans.some((plan) => plan.status === "active" && plan.sourceMode === "yova_generated" && !(plan.materials?.length))) {
    recommendations.push({
      id: "add-goal-context",
      title: "Add context when your goal has specific requirements",
      explanation: "YOVA can create content from a topic alone. A study guide, notes, examples, rubric, or a short description of what matters will make the scope more specific.",
      evidence: "At least one active goal currently relies on its title and topic",
      action: "open_learning",
      actionLabel: "Review active goals",
      priority: 70,
    });
  }

  const behaviorInterruptions = interruptions.filter((interruption) => (
    !personalization.state.excludedEvidenceRefs.includes(interruption.id)
  ));
  const recentInterruptions = behaviorInterruptions.slice(-4);
  const smallerOpeningApproved = personalization.decisions.some((decision) => (
    decision.artifact === "session_opening"
    && decision.setting === "first_action"
    && decision.value === "small_active_start"
  ));
  if (
    behaviorEnabled
    && recentInterruptions.length >= 2
    && !expanded.observationCorrection
    && smallerOpeningApproved
  ) {
    recommendations.push({
      id: "reduce-switching",
      title: "Use a smaller first action and fewer switches",
      explanation: "Multiple recent sessions ended before all required work was attempted. YOVA should preserve the learning target while making the entry and resume points smaller.",
      evidence: `${recentInterruptions.length} recent interrupted sessions`,
      action: "none",
      actionLabel: null,
      priority: 90,
    });
  }

  const calibration = summarizeConfidenceCalibration(
    completions.flatMap((completion) => completion.confidenceEvidence),
  );
  const calibrationSignal = personalization.signals.find((signal) => (
    signal.key === "calibration_risk"
    && !signal.paused
    && signal.evidenceLabel !== "Mixed evidence"
  ));
  if (
    behaviorEnabled
    && /overconfidence/i.test(calibrationSignal?.value ?? "")
    && (calibration.pattern === "possible_misconception" || calibration.pattern === "mixed")
  ) {
    recommendations.push({
      id: "repair-confident-miss",
      title: "Repair the confident miss with a contrasting application",
      explanation: "A high-confidence incorrect answer needs more than repetition. YOVA should briefly rebuild the idea, contrast it with the tempting model, and check a different application.",
      evidence: `${calibration.highConfidenceMisses} high-confidence ${calibration.highConfidenceMisses === 1 ? "miss" : "misses"}`,
      action: "none",
      actionLabel: null,
      priority: 95,
    });
  } else if (
    behaviorEnabled
    && /underconfidence/i.test(calibrationSignal?.value ?? "")
    && calibration.pattern === "underestimated_knowledge"
  ) {
    recommendations.push({
      id: "confirm-underestimated-knowledge",
      title: "Confirm what you can already do before reteaching it",
      explanation: "You produced a correct answer while feeling unsure. A new independent application is more useful than repeating the entire explanation.",
      evidence: `${calibration.lowConfidenceSuccesses} correct low-confidence ${calibration.lowConfidenceSuccesses === 1 ? "answer" : "answers"}`,
      action: "none",
      actionLabel: null,
      priority: 85,
    });
  }

  const methodSignals = legacyMethodEvidenceAllowed
    ? buildMethodSignals(plans, completions, behaviorInterruptions)
    : [];
  const methodNeedingSupport = methodSignals.find((signal) => signal.status === "needs_support");
  const promisingMethod = methodSignals.find((signal) => signal.status === "promising");
  if (methodNeedingSupport) {
    recommendations.push({
      id: `restore-support-${methodNeedingSupport.family}`,
      title: `Keep ${methodNeedingSupport.label.toLowerCase()}, but restore support first`,
      explanation: "The method still fits the task, but recent checks suggest its execution needs a clearer model, smaller first step, or more guided practice before independence.",
      evidence: `${methodNeedingSupport.sessions} comparable sessions in ${methodNeedingSupport.comparisonLabel} · ${methodNeedingSupport.averageAccuracy ?? 0}% check accuracy`,
      action: "start_session",
      actionLabel: "Use the adjusted next session",
      priority: 88,
    });
  } else if (promisingMethod) {
    recommendations.push({
      id: `fade-support-${promisingMethod.family}`,
      title: `Cautiously fade support during ${promisingMethod.label.toLowerCase()}`,
      explanation: "Repeated results are promising enough to make the next attempt more independent or add a transfer challenge. This is still task-specific evidence, not a permanent learning-style label.",
      evidence: `${promisingMethod.sessions} comparable sessions in ${promisingMethod.comparisonLabel} · ${promisingMethod.averageAccuracy}% check accuracy`,
      action: "start_session",
      actionLabel: "Try the next step",
      priority: 75,
    });
  }

  if (
    behaviorEnabled
    && completions.length === 0
    && plans.some((plan) => plan.status === "active")
  ) {
    recommendations.push({
      id: "collect-first-evidence",
      title: "Complete one guided session so YOVA can compare your profile with real work",
      explanation: "Onboarding creates a starting hypothesis. Answer accuracy, support use, completion, and feedback are what let YOVA adjust responsibly.",
      evidence: "No completed-session evidence yet",
      action: "start_session",
      actionLabel: "Start the recommended session",
      priority: 80,
    });
  }

  if (personalization.state.controls.selfReport && expanded.observationCorrection) {
    recommendations.push({
      id: "learner-correction-active",
      title: "Your correction is part of YOVA's decision context",
      explanation: "YOVA will treat your note as context and compare it with future task-specific evidence instead of turning an observation into a permanent label.",
      evidence: "Learner correction supplied",
      action: "improve_profile",
      actionLabel: "Review your correction",
      priority: 96,
    });
  }

  return recommendations
    .sort((left, right) => right.priority - left.priority)
    .slice(0, 4);
}
