import { QUESTION_TYPES, scaleQuestionMix } from "@/lib/practice/question-mix";
import type { SessionRoute } from "@/lib/routing/session-route";
import type { TopicWorkload } from "./topic-plan-contract";

/** A projection of persisted work, never a second time or workload estimator.
 * Within single-point and transfer work, preserve the task's research mix. */
export function applyTopicWorkloadToRoute(route: SessionRoute, workload?: TopicWorkload): SessionRoute {
  if (!workload) return route;
  const zero = { recall: 0, application: 0, compare_contrast: 0, prediction: 0, misconception: 0 };
  const types = [
    ...scaleQuestionMix({ ...zero, recall: route.questionMix.recall, misconception: route.questionMix.misconception }, workload.recallQuestionCount),
    ...scaleQuestionMix({ ...zero, application: route.questionMix.application, compare_contrast: route.questionMix.compare_contrast, prediction: route.questionMix.prediction }, workload.transferQuestionCount),
  ];
  const questionMix = { ...zero };
  for (const type of QUESTION_TYPES) questionMix[type] = types.filter(item => item === type).length;
  return { ...route, timerMinutes: workload.estimatedMinutes, questionCap: Math.max(1, workload.questionCount), questionTarget: Math.max(1, workload.questionCount), questionMinimum: Math.min(route.questionMinimum, Math.max(1, workload.questionCount)), questionMix, ruleIds: [...route.ruleIds, ...workload.ruleIds.filter(id => !route.ruleIds.includes(id))] };
}
