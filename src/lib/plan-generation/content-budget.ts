import type { PlanGenerationRequest } from "@/lib/plan-generation/schema";
import { inferPlanScopeContract, isNoviceRequest, type PlanScopeContract } from "@/lib/plan-generation/scope-contract";

export type SessionContentBudget = {
  minutes: number;
  preferredContentTargets: number;
  maximumContentTargets: number;
  maximumCompletionChecks: number;
  maximumLearnerFacingWords: number;
  guidance: string;
};

export type PlanContentBudget = {
  materialWordCount: number;
  mappedTopicTitles: string[];
  estimatedInstructionalUnits: number;
  requiredTopicCount: number;
  minimumSessions: number;
  recommendedSessions: number;
  typicalSession: SessionContentBudget;
  reason: string;
};

export function contentBudgetForMinutes(minutes: number): SessionContentBudget {
  if (minutes <= 15) return { minutes, preferredContentTargets: 1, maximumContentTargets: 2, maximumCompletionChecks: 2, maximumLearnerFacingWords: 450, guidance: "Keep the session to one main idea when possible, with no more than two tightly connected targets, two evidence checks, and 450 learner-facing words." };
  if (minutes <= 30) return { minutes, preferredContentTargets: 2, maximumContentTargets: 3, maximumCompletionChecks: 3, maximumLearnerFacingWords: 850, guidance: "Use one coherent concept cluster, normally two targets, followed by no more than three evidence checks and no more than 850 learner-facing words." };
  if (minutes <= 45) return { minutes, preferredContentTargets: 3, maximumContentTargets: 4, maximumCompletionChecks: 4, maximumLearnerFacingWords: 1_200, guidance: "Use up to three substantial targets when they form one coherent lesson, with active evidence for each target and no more than 1,200 learner-facing words." };
  return { minutes, preferredContentTargets: 4, maximumContentTargets: 5, maximumCompletionChecks: 4, maximumLearnerFacingWords: 1_600, guidance: "Use at most four substantial targets in the normal case and no more than 1,600 learner-facing words. Preserve a coherent lesson rather than filling the full window with extra information." };
}

/** The arithmetic stays deterministic; the topic count and scope band do not. */
export function buildPlanContentBudget(
  request: PlanGenerationRequest,
  scope: PlanScopeContract = inferPlanScopeContract(request),
): PlanContentBudget {
  const materialText = request.materials.map((material) => material.textContent ?? "").filter(Boolean).join("\n");
  const materialWordCount = materialText.match(/[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu)?.length ?? 0;
  const activeTopics = request.knowledgeMap?.topics.filter((topic) => !topic.deferred) ?? [];
  const mappedTopicTitles = activeTopics.map((topic) => topic.title);
  const estimatedInstructionalUnits = Math.max(1, activeTopics.length);
  const typicalMinutes = median(request.availability.map((slot) => slot.minutes)) ?? 25;
  const typicalSession = contentBudgetForMinutes(typicalMinutes);
  const coverageSessions = Math.ceil(estimatedInstructionalUnits / typicalSession.preferredContentTargets);
  const minimumSessions = request.intent === "study_now" ? 1 : clamp(Math.max(scope.minimumSessions, coverageSessions), scope.minimumSessions, scope.maximumSessions);
  const recommendedSessions = request.intent === "study_now" ? 1 : clamp(Math.max(scope.recommendedSessions, minimumSessions), minimumSessions, scope.maximumSessions);
  const noviceReason = isNoviceRequest(request)
    ? "The learner is starting near the beginning, so teaching and guided use need room before independent review."
    : "The learner has some prior evidence, so YOVA can check knowledge before targeted repair.";
  return {
    materialWordCount,
    mappedTopicTitles,
    estimatedInstructionalUnits,
    requiredTopicCount: activeTopics.length,
    minimumSessions,
    recommendedSessions,
    typicalSession,
    reason: `${activeTopics.length} ordered knowledge-map ${activeTopics.length === 1 ? "topic" : "topics"} define the required coverage. ${noviceReason} With a typical ${typicalMinutes}-minute window, YOVA should normally cover ${typicalSession.preferredContentTargets} ${typicalSession.preferredContentTargets === 1 ? "topic" : "topics"} per session and preserve the rest for later sessions.`,
  };
}

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? null;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}
