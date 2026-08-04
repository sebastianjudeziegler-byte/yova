import { onboardingQuestions } from "@/lib/sample-data";

const MODEL_SAFE_QUESTION_INDEXES = [0, 1, 2, 3, 4, 5, 6, 7, 9] as const;

export function buildPlanProfileSummary(answers: string[]) {
  const facts = MODEL_SAFE_QUESTION_INDEXES.flatMap((index) => {
    const answer = answers[index]?.trim();
    if (!answer) return [];
    return [`${onboardingQuestions[index].prompt} ${answer}`];
  });

  if (!facts.length) {
    return "No established behavioral preferences yet. Use the task, starting check, and availability as the primary planning signals.";
  }

  return facts.join(" ").slice(0, 800);
}
