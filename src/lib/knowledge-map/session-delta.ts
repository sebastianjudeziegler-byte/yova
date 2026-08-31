import type {
  ConceptEvidence,
  LearningPlanSession,
  SessionCompletionMode,
} from "@/lib/domain";
import type { PlanKnowledgeMap } from "@/lib/knowledge-map/schema";
import { learningStateConceptEvidence } from "@/lib/learning/concept-evidence";

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
  const plannedTopicIds = new Set(session.topicIds ?? []);
  const generatedTopicIds = session.resource?.topicIds;
  const hasAuthoritativeGeneratedScope = Boolean(
    generatedTopicIds?.length
    && generatedTopicIds.every((topicId) => plannedTopicIds.has(topicId)),
  );
  const sessionTopicIds = new Set(
    hasAuthoritativeGeneratedScope ? generatedTopicIds : session.topicIds ?? [],
  );
  const authoritativeEvidence = learningStateConceptEvidence(evidence);
  return map.topics.flatMap((topic) => {
    if (!sessionTopicIds.has(topic.id)) return [];
    const topicEvidence = authoritativeEvidence.filter((item) => item.topicId === topic.id);
    let next = topic.status;
    if (topicEvidence.length > 0 && topic.status !== "secure") next = "evidenced";
    else if (session.learningMode === "learn" && topic.status === "not_started") next = "taught";
    if (next === topic.status || next === "not_started") return [];
    return [{ topicId: topic.id, title: topic.title, from: topic.status, to: next }];
  });
}
