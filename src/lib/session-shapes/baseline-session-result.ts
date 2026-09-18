import type { SessionShape } from "@/lib/routing/session-route";
import type { ShapeAComparison } from "./shape-a";
import type { TopicWorkload, SingleTopicWorkload } from "@/lib/plan-generation/topic-plan-contract";

export type BaselineSegmentResult = {
  shape: SessionShape;
  methodName: string;
  ruleIds: string[];
  noteRuleId: string;
  correctAnswers: number;
  totalAnswers: number;
  keyPointOutcomes: Array<{ keyPointId: string; text: string; sourceTopicId?: string; outcome: "secure" | "needs_review" }>;
  topicDone: boolean;
  escalated: boolean;
  produced: string | null;
  comparison: ShapeAComparison | null;
  revision?: { produced: string; comparison: ShapeAComparison | null; status: "checked" | "unchecked" };
  comparisonUnavailable?: boolean;
  elapsedSeconds: number;
};

export type CompletedBaselineSegment = { segmentId: string; result: BaselineSegmentResult };
export type BaselineSessionResult = BaselineSegmentResult & { segments?: CompletedBaselineSegment[] };

export function baselineSegmentResultFits(workload: SingleTopicWorkload, result: BaselineSegmentResult): boolean {
  return Boolean(result && Number.isInteger(result.correctAnswers) && Number.isInteger(result.totalAnswers)
    && result.correctAnswers >= 0 && result.correctAnswers <= result.totalAnswers && result.totalAnswers >= workload.questionCount && result.totalAnswers <= 192
    && Number.isInteger(result.elapsedSeconds) && result.elapsedSeconds >= 0 && result.elapsedSeconds <= 21_600 && Array.isArray(result.keyPointOutcomes)
    && (workload.questionCount === 0 || result.keyPointOutcomes.length > 0)
    && result.keyPointOutcomes.every(outcome => outcome.sourceTopicId && workload.topicSubtopics.some(topic => topic.topicId === outcome.sourceTopicId)));
}

/** A whole block can finish only after every persisted segment actually ended.
 * Counts describe checked attempts, not mastery or verified learner ability. */
export function aggregateBaselineSegmentResults(workload: TopicWorkload, completed: readonly CompletedBaselineSegment[]): BaselineSessionResult | null {
  const planned = workload.segments;
  if (!planned || completed.length !== planned.length) return null;
  if (completed.some((entry, index) => entry.segmentId !== planned[index]?.segmentId || !baselineSegmentResultFits(planned[index]!.workload, entry.result))) return null;
  const first = completed[0]!.result;
  const outcomes = completed.flatMap(({ segmentId, result }, index) => {
    const allowedTopics = new Set(planned[index]!.workload.topicSubtopics.map(topic => topic.topicId));
    return result.keyPointOutcomes.filter(outcome => outcome.sourceTopicId && allowedTopics.has(outcome.sourceTopicId)).map(outcome => ({ ...outcome, keyPointId: `${segmentId}:${outcome.keyPointId}` }));
  });
  return {
    ...first,
    ruleIds: [...new Set(completed.flatMap(entry => entry.result.ruleIds))],
    correctAnswers: completed.reduce((sum, entry) => sum + entry.result.correctAnswers, 0),
    totalAnswers: completed.reduce((sum, entry) => sum + entry.result.totalAnswers, 0),
    elapsedSeconds: completed.reduce((sum, entry) => sum + entry.result.elapsedSeconds, 0),
    keyPointOutcomes: outcomes,
    topicDone: completed.every(entry => entry.result.topicDone),
    escalated: completed.some(entry => entry.result.escalated),
    // Feedback belongs to its activity. Do not present one activity's checked
    // correction as the assessment of the whole block.
    produced: null, comparison: null, revision: undefined,
    comparisonUnavailable: completed.some(entry => entry.result.comparisonUnavailable),
    segments: [...completed],
  };
}
