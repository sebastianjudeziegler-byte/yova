import type { PlanGenerationRequest } from "@/lib/plan-generation/schema";

export type PlanScopeBand = "focused_skill" | "unit_or_exam" | "broad_course";

export type PlanScopeContract = {
  band: PlanScopeBand;
  label: string;
  minimumSessions: number;
  recommendedSessions: number;
  maximumSessions: number;
  minimumTeachingSessions: number;
  explanation: string;
};

const FOCUSED_SKILL_PATTERN = /\b(product rule|quotient rule|chain rule|power rule|implicit differentiation|related rates?|one concept|single concept|specific concept|one chapter|one section|one skill)\b/i;
const BROAD_SCOPE_PATTERN = /\b(all|entire|full|complete)\s+(?:of\s+)?(?:calculus|algebra|geometry|statistics|biology|chemistry|physics|history|economics|finance|programming|coding)\b|\b(?:learn|master|understand)\s+(?:all\s+(?:of\s+)?)?(?:calculus|algebra|geometry|statistics|biology|chemistry|physics|history|economics|finance|programming|coding)\s*(?:from scratch|from the beginning|as a beginner)?\b|\b(?:calculus|algebra|geometry|statistics|biology|chemistry|physics|history|economics|finance|programming|coding)\s+(?:from scratch|from the beginning|course|curriculum|foundations)\b/i;
const MEDIUM_SCOPE_PATTERN = /\b(unit|exam|test|midterm|final|chapter|module|certification|ap\s|sat\s|act\s)\b/i;

export function inferPlanScopeContract(request: PlanGenerationRequest): PlanScopeContract {
  if (request.intent === "study_now") {
    return {
      band: "focused_skill",
      label: "One focused session",
      minimumSessions: 1,
      recommendedSessions: 1,
      maximumSessions: 1,
      minimumTeachingSessions: request.learningIntent === "learn" ? 1 : 0,
      explanation: "This request is for one useful session now, so YOVA should choose one bounded target and finish it coherently.",
    };
  }

  const context = `${request.goal} ${request.startingContext ?? ""}`.trim();
  const isFocused = FOCUSED_SKILL_PATTERN.test(context);
  const isBroad = !isFocused && BROAD_SCOPE_PATTERN.test(context);
  const isMedium = MEDIUM_SCOPE_PATTERN.test(context);
  const namesSeveralTopics = (request.goal.match(/,|\band\b|\bplus\b/gi)?.length ?? 0) >= 2;
  const novice = isNoviceRequest(request);

  if (isBroad) {
    return {
      band: "broad_course",
      label: "Broad learning pathway",
      minimumSessions: novice ? 10 : 8,
      recommendedSessions: novice ? 12 : 9,
      maximumSessions: 14,
      minimumTeachingSessions: novice ? 4 : 2,
      explanation: novice
        ? "The goal covers a full subject and the learner is starting near the beginning, so YOVA must build foundations across several modules before expecting independent performance."
        : "The goal covers a full subject, so YOVA should divide it into foundational modules, guided application, independent use, and cumulative review.",
    };
  }

  if ((isFocused || (!isMedium && !namesSeveralTopics))) {
    return {
      band: "focused_skill",
      label: "Focused skill plan",
      minimumSessions: 2,
      recommendedSessions: novice ? 4 : 3,
      maximumSessions: 6,
      minimumTeachingSessions: novice ? 1 : 0,
      explanation: novice
        ? "The goal is one bounded skill. YOVA should teach the model, demonstrate it, then use guided and independent practice without inflating it into a course."
        : "The goal is one bounded skill, so a short sequence of diagnosis, targeted practice, and delayed verification is enough.",
    };
  }

  return {
    band: "unit_or_exam",
    label: "Unit-sized plan",
    minimumSessions: novice ? 5 : 4,
    recommendedSessions: novice ? 7 : 5,
    maximumSessions: 10,
    minimumTeachingSessions: novice ? 2 : 1,
    explanation: novice
      ? "The goal contains several connected ideas. YOVA should first teach the organizing model, then cover the major parts before moving into retrieval and mixed application."
      : "The goal contains several connected ideas, so YOVA should diagnose them, repair the important gaps, and finish with mixed application and review.",
  };
}

export function isNoviceRequest(request: PlanGenerationRequest) {
  if (request.learningIntent === "learn") return true;
  const evidence = [
    request.startingContext ?? "",
    ...request.diagnosticResponses.map((response) => response.answer),
  ].join(" ");
  return /\b(completely new|know nothing|ground zero|from scratch|beginner|never learned|never seen|no idea|starting from (?:the )?beginning)\b/i.test(evidence);
}
