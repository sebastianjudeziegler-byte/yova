import type { KnowledgeMapTopic } from '@/lib/knowledge-map/schema';
import { classifyLearningTask } from '@/lib/learning/method-router';
import { selectCanonicalStudyMethod } from '@/lib/learning/canonical-method-selection';

/** Re-enter newly included scope through task and knowledge eligibility. */
export function deferredTopicSessionFields(topic: KnowledgeMapTopic, planTopic: string) {
  const encountered = topic.initialEvidence?.outcome === 'demonstrated'
    || topic.status !== 'not_started';
  const learningMode = encountered ? 'study' as const : 'learn' as const;
  const task = classifyLearningTask(`${planTopic} ${topic.title} ${topic.description}`);
  const decision = selectCanonicalStudyMethod({
    taskType: task.taskType,
    knowledgeStage: topic.status === 'secure' ? 'retrieval_ready' : encountered ? 'developing' : 'novice',
    learningMode,
  });
  const independentAction = task.taskType === 'problem_solving'
    ? `Solve a new problem involving ${topic.title} and check the result`
    : `Explain or apply ${topic.title} independently in a new example`;
  return {
    title: `${encountered ? 'Check' : 'Learn'} ${topic.title}`,
    objective: encountered
      ? `${independentAction}, then repair any gap the attempt reveals.`
      : `Learn ${topic.title} with a clear model and guided attempt, then try independently.`,
    method: decision.selectedMethodName,
    method_rationale: `${decision.learnerFacingReason} This topic is now included in your plan.`,
    step_data: {
      learningMode,
      topicIds: [topic.id],
      contentTargets: [topic.title],
      completionEvidence: [independentAction],
    },
  };
}
