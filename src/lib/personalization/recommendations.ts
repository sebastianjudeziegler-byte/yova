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

  if (deepAnswers < 3) {
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

  const recentInterruptions = interruptions.slice(-4);
  if (recentInterruptions.length >= 2 && !expanded.observationCorrection) {
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
  if (calibration.pattern === "possible_misconception" || calibration.pattern === "mixed") {
    recommendations.push({
      id: "repair-confident-miss",
      title: "Repair the confident miss with a contrasting application",
      explanation: "A high-confidence incorrect answer needs more than repetition. YOVA should briefly rebuild the idea, contrast it with the tempting model, and check a different application.",
      evidence: `${calibration.highConfidenceMisses} high-confidence ${calibration.highConfidenceMisses === 1 ? "miss" : "misses"}`,
      action: "none",
      actionLabel: null,
      priority: 95,
    });
  } else if (calibration.pattern === "underestimated_knowledge") {
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

  if (completions.length === 0 && plans.some((plan) => plan.status === "active")) {
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

  if (expanded.observationCorrection) {
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
