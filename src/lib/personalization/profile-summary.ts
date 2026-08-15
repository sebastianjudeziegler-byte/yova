import { onboardingQuestions } from "@/lib/sample-data";
import {
  DEEP_PROFILE_QUESTIONS,
  expandedLearnerContextFromAnswers,
  statedOnboardingAnswerForRuntime,
} from "@/lib/personalization/learner-profile";
import { readPersonalizationStateFromAnswers } from "@/lib/personalization/personalization-state";

const MODEL_SAFE_QUESTION_INDEXES = [0, 1, 2, 3, 4, 5, 6, 7, 9] as const;

export function buildPlanProfileSummary(answers: string[]) {
  const state = readPersonalizationStateFromAnswers(answers);
  const expanded = expandedLearnerContextFromAnswers(answers);
  const facts = state.controls.selfReport ? MODEL_SAFE_QUESTION_INDEXES.flatMap((index) => {
    const answer = statedOnboardingAnswerForRuntime(answers, index, state);
    if (!answer) return [];
    return [`${onboardingQuestions[index].prompt} ${answer}`];
  }) : [];
  if (expanded.functionalSupportNeed) {
    facts.push(`${onboardingQuestions[8].prompt} ${expanded.functionalSupportNeed}`);
  }
  const deepAnswers = [
    expanded.processingPreference,
    expanded.memoryChallenge,
    expanded.supportPreference,
    expanded.workspacePreference,
  ];
  for (const [index, question] of DEEP_PROFILE_QUESTIONS.entries()) {
    const answer = deepAnswers[index];
    if (answer) facts.push(`${question.prompt} ${answer}`);
  }
  if (expanded.freeformContext) facts.push(`Learner-provided context: ${expanded.freeformContext}`);
  if (expanded.observationCorrection) facts.push(`Learner correction to YOVA's observations: ${expanded.observationCorrection}`);

  if (!facts.length) {
    return "No established behavioral preferences yet. Use the task, starting check, and availability as the primary planning signals.";
  }

  return facts.join(" ").slice(0, 1_600);
}
