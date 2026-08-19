import type {
  ConceptEvidence,
  LearningPlanSession,
  SessionCompletionMode,
} from "@/lib/domain";
import type { PlanKnowledgeMap } from "@/lib/knowledge-map/schema";

export type SessionMapDelta = {
  topicId: string;
  title: string;
  from: "not_started" | "taught" | "evidenced" | "secure";
  to: "taught" | "evidenced" | "secure";
};

export function buildSessionMapDelta(
  map: PlanKnowledgeMap | undefined,
  session: LearningPlanSession | null,
  evidence: ConceptEvidence[],
  completionMode: SessionCompletionMode = "guided",
): SessionMapDelta[] {
  if (completionMode === "unguided_practice") return [];
  if (!map || !session) return [];
  const sessionTopicIds = new Set(session.topicIds ?? []);
  return map.topics.flatMap((topic) => {
    if (!sessionTopicIds.has(topic.id)) return [];
    const topicEvidence = evidence.filter((item) => item.topicId === topic.id);
    let next = topic.status;
    if (topicEvidence.length > 0 && topic.status !== "secure") next = "evidenced";
    else if (session.learningMode === "learn" && topic.status === "not_started") next = "taught";
    if (next === topic.status || next === "not_started") return [];
    return [{ topicId: topic.id, title: topic.title, from: topic.status, to: next }];
  });
}
