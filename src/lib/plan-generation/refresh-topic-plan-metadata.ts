import type { LearningPlan } from "@/lib/domain";
import { topicWeight } from "./topic-plan-model";

/** A reviewed edit changes the displayed queue facts, without rerouting work
 * or rewriting the original profile decision history. */
export function refreshTopicPlanMetadata<T extends LearningPlan>(plan: T): T {
  if (!plan.planModel || !plan.knowledgeMap) return plan;
  const topics = plan.knowledgeMap.topics.filter(topic => !topic.removed);
  const constraints = plan.deadline ? plan.sessions.filter(session => session.status !== "complete" && session.status !== "skipped" && Date.parse(session.scheduledFor) + session.estimatedMinutes * 60_000 > Date.parse(plan.deadline!)).map(session => `${session.title}: the reviewed date falls after the deadline; move it or change availability.`) : [];
  return { ...plan, planModel: { ...plan.planModel, topicNotes: topics.map(topic => {
    const learns = plan.sessions.filter(session => session.status !== "skipped" && session.topicIds?.includes(topic.id) && session.learningMode === "learn").length;
    return { topicId: topic.id, topicWeight: topicWeight(topic, topics), learnBlockCount: learns,
      note: topic.deferred ? "This topic is outside the current queue." : learns > 1 ? `Split into ${learns} learning blocks at subtopic boundaries.` : learns === 1 ? "One focused learning block, followed by practice." : "Teaching skipped; start with an independent practice check." };
  }), constraints: [...new Set(constraints)].slice(0,40) } };
}
