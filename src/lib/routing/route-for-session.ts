import type { LearningPlan, LearningPlanSession, SessionCompletion } from "@/lib/domain";
import type { KeyPoint } from "@/lib/practice/compose-practice";
import { prerequisiteDepth } from "@/lib/practice/topic-difficulty";
import type { KnowledgeMapTopic } from "@/lib/knowledge-map/schema";
import { learnerReportedCoverage, measuredPlacementEvidence } from "@/lib/knowledge-map/topic-evidence";
import { classifyLearningTask } from "@/lib/learning/method-router";
import type { LearningTaskType } from "@/lib/learning/method-catalog";
import type { OnboardingAnswers } from "@/lib/onboarding/answers";
import { isProceduralTaskType, type RoutingEvidence, type RoutingInput } from "@/lib/routing/session-route";
import { baselineSourceForTopic } from "@/lib/session-shapes/source-context";

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

export function routingInputForSession({ plan, session, topic, answers, completions = [], now = new Date() }: {
  plan: Pick<LearningPlan, "topic" | "title" | "knowledgeMap" | "materials" | "sourceMode"> & { deadline?: string | null };
  session: Pick<LearningPlanSession, "topicIds" | "studyRoute" | "title" | "objective" | "learningMode">;
  topic: KnowledgeMapTopic | null;
  answers: OnboardingAnswers;
  /** Completion records, for Interleaved Review eligibility (Brief 1.5 item 3). */
  completions?: readonly SessionCompletion[];
  now?: Date;
}): RoutingInput {
  const taskType = taskTypeForSession(plan, session, topic);
  const topicOwnType = topic ? classifyLearningTask(`${topic.title}. ${topic.description}`).taskType : taskType;
  const hasSource = Boolean(baselineSourceForTopic(plan, topic).description);
  return {
    taskType,
    blockKind: session.learningMode === "learn" ? "learn" : "practice",
    evidence: routingEvidenceForTopic(topic),
    hasSource,
    topicHasProblems: taskType === "mixed_assessment" && isProceduralTaskType(topicOwnType),
    answers,
    daysToDeadline: daysUntil(plan.deadline ?? null, now),
    subtopicCount: topic?.subtopics.length ?? 0,
    prerequisiteDepth: topic ? prerequisiteDepth(topic.id, plan.knowledgeMap?.topics ?? []) : 0,
    passedRelatedTopicIds: passedRelatedTopicIds({ plan, topic, completions }),
  };
}

const DAY_MS = 24 * 60 * 60 * 1_000;

/** Days from now to the deadline, fractional; null without a deadline or once it has passed. */
function daysUntil(deadline: string | null, now: Date) {
  if (!deadline) return null;
  const at = Date.parse(deadline);
  if (!Number.isFinite(at) || at < now.getTime()) return null;
  return (at - now.getTime()) / DAY_MS;
}

/** The session's topic and every topic linked to it by a prerequisite, in map order, excluding removed topics. */
function relatedTopics(plan: Pick<LearningPlan, "knowledgeMap">, topic: KnowledgeMapTopic | null) {
  if (!topic) return [];
  return (plan.knowledgeMap?.topics ?? []).filter((candidate) => !candidate.removed && (
    candidate.id === topic.id
    || candidate.prerequisiteTopicIds.includes(topic.id)
    || topic.prerequisiteTopicIds.includes(candidate.id)
  ));
}

/** A completion passed a topic clean when every checked key point for that topic was secure. */
function passedCleanFor(completion: SessionCompletion, topicId: string) {
  const evidence = completion.conceptEvidence.filter((item) => item.topicId === topicId);
  return evidence.length > 0 && evidence.every((item) => item.outcome === "secure");
}

/** Related topics (this one included) that have each passed a practice round clean at least once. */
export function passedRelatedTopicIds({ plan, topic, completions }: {
  plan: Pick<LearningPlan, "knowledgeMap">;
  topic: KnowledgeMapTopic | null;
  completions: readonly SessionCompletion[];
}): string[] {
  return relatedTopics(plan, topic)
    .filter((candidate) => completions.some((completion) => passedCleanFor(completion, candidate.id)))
    .map((candidate) => candidate.id);
}

/**
 * The key points an Interleaved Review sweeps: those recorded in each passed
 * related topic's clean completion, ids unique across topics, at most eight.
 */
export function interleavedKeyPointsForSession({ plan, topic, completions }: {
  plan: Pick<LearningPlan, "knowledgeMap">;
  topic: KnowledgeMapTopic | null;
  completions: readonly SessionCompletion[];
}): KeyPoint[] {
  const passed = new Set(passedRelatedTopicIds({ plan, topic, completions }));
  const keyPoints: KeyPoint[] = [];
  const seen = new Set<string>();
  relatedTopics(plan, topic).filter((candidate) => passed.has(candidate.id)).forEach((candidate, topicIndex) => {
    const texts = completions
      .filter((completion) => passedCleanFor(completion, candidate.id))
      .flatMap((completion) => completion.conceptEvidence.filter((item) => item.topicId === candidate.id).map((item) => item.concept.trim()));
    let pointIndex = 0;
    for (const text of texts) {
      const key = text.toLocaleLowerCase();
      if (text.length < 8 || seen.has(key)) continue;
      seen.add(key);
      pointIndex += 1;
      keyPoints.push({ id: `t${topicIndex + 1}k${pointIndex}`, text: text.slice(0, 400), sourceTopicId: candidate.id });
    }
  });
  return keyPoints.slice(0, 8);
}
