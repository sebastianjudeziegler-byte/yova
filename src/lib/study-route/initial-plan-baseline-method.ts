import type { CanonicalMethodSelectionResult } from "@/lib/learning/canonical-method-selection";
import { CANONICAL_METHOD_SELECTION_POLICY_VERSION } from "@/lib/learning/canonical-method-selection";
import type { OnboardingAnswers } from "@/lib/onboarding/answers";
import type { LearningPlanSession } from "@/lib/domain";
import type { PlanGenerationRequest } from "@/lib/plan-generation/schema";
import { routeSession } from "@/lib/routing/session-route";
import { measuredPlacementEvidence, learnerReportedCoverage } from "@/lib/knowledge-map/topic-evidence";

/** The baseline ten-question profile and runtime share the same task-first
 * selector. This is a saved preference, never an invented explicit choice. */
export function initialPlanBaselineMethod(selection:CanonicalMethodSelectionResult,answers:OnboardingAnswers,request:PlanGenerationRequest,session:Pick<LearningPlanSession,"topicIds"|"learningMode">):CanonicalMethodSelectionResult {
  const topic=request.knowledgeMap?.topics.find(t=>session.topicIds?.includes(t.id));
  const evidence=topic&&learnerReportedCoverage(topic)?"learner_reported_covered":topic?measuredPlacementEvidence(topic)?.outcome??"not_assessed":"not_assessed";
  const baseline=routeSession({taskType:selection.taskType,blockKind:session.learningMode==="learn"?"learn":"practice",evidence,hasSource:Boolean(topic?.sourceReferences.some(ref=>ref.sectionRole==="content_source")),topicHasProblems:selection.taskType==="problem_solving",answers,subtopicCount:topic?.subtopics.length});
  if(!selection.eligibleMethodIds.includes(baseline.methodId))return selection;
  const effective = baseline.decisions.filter(decision=>decision.field==="produceStep"||decision.field==="methodId").at(-1);
  const reason=effective?.reason ?? `This task uses ${baseline.methodName} to check the knowledge independently.`;
  const refs=baseline.ruleIds.filter(id=>/^L[345]\.q/u.test(id)).map(id=>`onboarding-route:${id}`);
  return {...selection,selectedMethodId:baseline.methodId,selectedMethodName:baseline.methodName,authority:refs.length?"authorized_declaration":"task_baseline",changedFromBaseline:baseline.methodId!==selection.baselineMethodId,orderedMethodIds:[baseline.methodId,...selection.eligibleMethodIds.filter(id=>id!==baseline.methodId)],evidenceRefs:refs,learnerFacingReason:reason,ruleTrace:[...selection.ruleTrace.map(trace=>trace.ruleId===CANONICAL_METHOD_SELECTION_POLICY_VERSION?{...trace,result:`${refs.length?"authorized_declaration":"task_baseline"}:${baseline.methodId}`,reason,evidenceRefs:refs}:trace),{ruleId:"baseline_onboarding_v1",result:`direct_answers:${baseline.methodId}`,reason:"The baseline session policy applies directly chosen onboarding preferences independently of the canonical signal and history rollout.",evidenceRefs:refs}]};
}
