import type { LearningPlan, LearningPlanSession } from "@/lib/domain";
import type { KnowledgeMapTopic } from "@/lib/knowledge-map/schema";
import { learnerReportedCoverage, measuredPlacementEvidence } from "@/lib/knowledge-map/topic-evidence";
import { classifyLearningTask } from "@/lib/learning/method-router";
import type { LearningTaskType } from "@/lib/learning/method-catalog";
import type { OnboardingAnswers } from "@/lib/onboarding/answers";
import { isProceduralTaskType, type RoutingEvidence, type RoutingInput } from "@/lib/routing/session-route";

/**
 * Builds the finite routing input for one plan session. Task type comes from
 * the topic (the committed route's task family when the session has one,
 * otherwise the topic text), evidence from the topic's placement record, the
 * block kind from the session's learning mode, and the source from whether
 * the topic has any mapped material. No profile answer reaches Layer 1.
 */
export function sessionTopic(plan: Pick<LearningPlan, "knowledgeMap">, session: Pick<LearningPlanSession, "topicIds">): KnowledgeMapTopic | null {
  const topics = plan.knowledgeMap?.topics ?? [];
  for (const topicId of session.topicIds ?? []) {
    const topic = topics.find((candidate) => candidate.id === topicId && !candidate.removed);
    if (topic) return topic;
  }
  return null;
}

export function routingEvidenceForTopic(topic: KnowledgeMapTopic | null): RoutingEvidence {
  if (!topic) return "not_assessed";
  if (learnerReportedCoverage(topic)) return "learner_reported_covered";
  const placement = measuredPlacementEvidence(topic);
  if (placement?.outcome === "demonstrated") return "demonstrated";
  if (placement?.outcome === "gap") return "gap";
  return "not_assessed";
}

export function taskTypeForSession(plan: Pick<LearningPlan, "topic" | "title">, session: Pick<LearningPlanSession, "studyRoute" | "title" | "objective">, topic: KnowledgeMapTopic | null): LearningTaskType {
  const routed = session.studyRoute?.target.taskFamily;
  if (routed) return routed;
  const text = topic ? `${topic.title}. ${topic.description}` : `${session.title}. ${session.objective}`;
  return classifyLearningTask(`${text} ${plan.topic}`).taskType;
}

export function routingInputForSession({ plan, session, topic, answers }: {
  plan: Pick<LearningPlan, "topic" | "title" | "knowledgeMap" | "materials" | "sourceMode">;
  session: Pick<LearningPlanSession, "topicIds" | "studyRoute" | "title" | "objective" | "learningMode">;
  topic: KnowledgeMapTopic | null;
  answers: OnboardingAnswers;
}): RoutingInput {
  const taskType = taskTypeForSession(plan, session, topic);
  const topicOwnType = topic ? classifyLearningTask(`${topic.title}. ${topic.description}`).taskType : taskType;
  const hasSource = Boolean(
    topic && (
      topic.sourceReferences.some((reference) => (plan.materials ?? []).some((material) => material.id === reference.materialId && material.textContent))
      || (topic.attachedSources?.length ?? 0) > 0
    ),
  ) || (plan.sourceMode === "user_materials" && (plan.materials ?? []).some((material) => material.textContent));
  return {
    taskType,
    blockKind: session.learningMode === "learn" ? "learn" : "practice",
    evidence: routingEvidenceForTopic(topic),
    hasSource,
    topicHasProblems: taskType === "mixed_assessment" && isProceduralTaskType(topicOwnType),
    answers,
  };
}
