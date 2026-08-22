import { resolveKnowledgeMapSubjectBoundary } from "@/lib/knowledge-map/subject-boundary";
import type { PlanGenerationRequest } from "@/lib/plan-generation/schema";

/** Resolve untrusted or previously generated map labels before they shape a plan. */
export function resolvePlanRequestSubjectBoundary(
  request: PlanGenerationRequest,
): PlanGenerationRequest {
  if (!request.knowledgeMap) return request;
  const knowledgeMap = resolveKnowledgeMapSubjectBoundary(request.knowledgeMap, request.goal);
  return knowledgeMap === request.knowledgeMap ? request : { ...request, knowledgeMap };
}
