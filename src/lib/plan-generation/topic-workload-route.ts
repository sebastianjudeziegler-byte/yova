import { QUESTION_TYPES, scaleQuestionMix, type QuestionMix } from "@/lib/practice/question-mix";
import type { SessionRoute } from "@/lib/routing/session-route";
import type { TopicWorkload } from "./topic-plan-contract";

/** A projection of persisted work, never a second time or workload estimator.
 * Within single-point and transfer work, preserve the task's research mix. */
export function applyTopicWorkloadToRoute(route: SessionRoute, workload?: TopicWorkload): SessionRoute {
  if (!workload) return route;
  const questionMix = questionMixForTopicWorkload(route.questionMix, workload);
  return { ...route, timerMinutes: workload.estimatedMinutes, questionCap: Math.max(1, workload.questionCount), questionTarget: Math.max(1, workload.questionCount), questionMinimum: Math.min(route.questionMinimum, Math.max(1, workload.questionCount)), questionMix, ruleIds: [...route.ruleIds, ...workload.ruleIds.filter(id => !route.ruleIds.includes(id))] };
}

/** Preserve task/profile question categories while enforcing the saved counts. */
export function questionMixForTopicWorkload(baseMix: QuestionMix, workload: Pick<TopicWorkload, "recallQuestionCount" | "transferQuestionCount">): QuestionMix {
  const zero = { recall: 0, application: 0, compare_contrast: 0, prediction: 0, misconception: 0 };
  const types = [
    ...scaleQuestionMix({ ...zero, recall: baseMix.recall + Number(baseMix.recall + baseMix.misconception === 0), misconception: baseMix.misconception }, workload.recallQuestionCount),
    ...scaleQuestionMix({ ...zero, application: baseMix.application + Number(baseMix.application + baseMix.compare_contrast + baseMix.prediction === 0), compare_contrast: baseMix.compare_contrast, prediction: baseMix.prediction }, workload.transferQuestionCount),
  ];
  const questionMix = { ...zero };
  for (const type of QUESTION_TYPES) questionMix[type] = types.filter(item => item === type).length;
  return questionMix;
}
