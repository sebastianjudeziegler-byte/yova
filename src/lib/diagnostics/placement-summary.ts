import { measuredPlacementEvidence } from "@/lib/knowledge-map/topic-evidence";
import type { PlanKnowledgeMap } from "@/lib/knowledge-map/schema";
import type { DiagnosticResponse } from "@/lib/plan-generation/schema";

/** Intent routing reads authenticated map evidence, never client correctness flags. */
export function diagnosticResponsesFromMap(map: PlanKnowledgeMap | undefined, declarations: readonly DiagnosticResponse[] = []): DiagnosticResponse[] {
  const scored = map?.topics.flatMap(topic => { const evidence = measuredPlacementEvidence(topic); return evidence ? [{
    questionId: topic.id, topicId: topic.id, question: `Placement evidence for ${topic.title}`,
    answer: "Server-scored placement check",
    evaluation: evidence.outcome === "demonstrated" ? "correct" as const : "incorrect" as const,
  }] : []; }).slice(0, 12) ?? [];
  // A learner may explicitly ask to start with teaching or practice. That is
  // useful input, but never upgrades a topic's placement evidence.
  return [...scored, ...declarations.filter(response=>response.evaluation==="self_report").slice(0,12-scored.length)];
}
