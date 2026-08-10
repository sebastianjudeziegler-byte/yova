import { onboardingQuestions } from "@/lib/sample-data";
import {
  DEEP_PROFILE_QUESTIONS,
  expandedLearnerContextFromAnswers,
  functionalSupportNeedFromAnswer,
} from "@/lib/personalization/learner-profile";

const MODEL_SAFE_QUESTION_INDEXES = [0, 1, 2, 3, 4, 5, 6, 7, 9] as const;

export function buildPlanProfileSummary(answers: string[]) {
  const facts = MODEL_SAFE_QUESTION_INDEXES.flatMap((index) => {
    const answer = answers[index]?.trim();
    if (!answer) return [];
    return [`${onboardingQuestions[index].prompt} ${answer}`];
  });
  const functionalSupportNeed = functionalSupportNeedFromAnswer(answers[8]);
  if (functionalSupportNeed) {
    facts.push(`${onboardingQuestions[8].prompt} ${functionalSupportNeed}`);
  }
  for (const question of DEEP_PROFILE_QUESTIONS) {
    const answer = answers[question.answerIndex]?.trim();
    if (answer) facts.push(`${question.prompt} ${answer}`);
  }
  const expanded = expandedLearnerContextFromAnswers(answers);
  if (expanded.freeformContext) facts.push(`Learner-provided context: ${expanded.freeformContext}`);
  if (expanded.observationCorrection) facts.push(`Learner correction to YOVA's observations: ${expanded.observationCorrection}`);

  if (!facts.length) {
    return "No established behavioral preferences yet. Use the task, starting check, and availability as the primary planning signals.";
  }

  return facts.join(" ").slice(0, 1_600);
}
