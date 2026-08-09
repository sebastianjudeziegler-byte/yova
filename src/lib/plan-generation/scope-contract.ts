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

/** Scope is an explicit model judgment stored with the knowledge map. */
export function inferPlanScopeContract(request: PlanGenerationRequest): PlanScopeContract {
  if (request.knowledgeMap) return request.knowledgeMap.scopeJudgment;
  if (request.intent === "study_now") {
    return {
      band: "focused_skill",
      label: "One focused session",
      minimumSessions: 1,
      recommendedSessions: 1,
      maximumSessions: 1,
      minimumTeachingSessions: request.learningIntent === "learn" ? 1 : 0,
      explanation: "This request is explicitly for one bounded session now.",
    };
  }
  return {
    band: "unit_or_exam",
    label: "Unclassified learning plan",
    minimumSessions: 2,
    recommendedSessions: 4,
    maximumSessions: 8,
    minimumTeachingSessions: request.learningIntent === "learn" ? 1 : 0,
    explanation: "Live scope judgment is not available yet, so YOVA is using a conservative temporary range.",
  };
}

export function isNoviceRequest(request: PlanGenerationRequest) {
  if (request.learningIntent === "learn") return true;
  const academicChecks = request.diagnosticResponses.filter((response) => response.evaluation !== "self_report");
  return academicChecks.length > 0 && academicChecks.every((response) => response.evaluation === "incorrect");
}
