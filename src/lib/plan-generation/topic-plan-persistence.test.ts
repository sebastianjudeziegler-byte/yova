import { describe,expect,it } from "vitest";
import { readFileSync } from "node:fs";
import { TopicPlanModelSchema, TopicWorkloadSchema } from "./topic-plan-contract";
import { composeNormalPlanEnvelopes } from "./normal-plan-envelopes";
import { buildNormalPlanFallbackFill } from "./normal-plan-provider-fill";
import { buildNormalPlanFromFixedEnvelope } from "./normal-plan-pipeline";
import { deltaFixture } from "@/evals/personalization-delta-fixture";
import { emptyOnboardingAnswers } from "@/lib/onboarding/answers";
import { routeSession } from "@/lib/routing/session-route";
import { GeneratedLearningPlanSchema } from "./schema";

describe("topic plan persistence boundary",()=>{
  it("carries profile rules, original learning goal and exact workload through live plan materialization",()=>{
    const fixture=deltaFixture(2);
    const composition=composeNormalPlanEnvelopes({...fixture,learningIntentRecommendation:{intent:"learn",basis:"The learner is starting the unit."}});
    const plan=buildNormalPlanFromFixedEnvelope({...fixture,composition,fill:buildNormalPlanFallbackFill({request:fixture.request,composition})});
    const parsed=GeneratedLearningPlanSchema.parse(JSON.parse(JSON.stringify(plan)));
    expect(TopicPlanModelSchema.parse(parsed.planModel).learningGoal).toBe(fixture.request.goal);
    for(const [i,session]of parsed.sessions.entries())expect(TopicWorkloadSchema.parse(session.workload)).toEqual(composition.envelopes[i]!.workload);
  });
  it("shows the same Q6 method as the actual baseline runtime without inventing a learner choice",()=>{
    const fixture=deltaFixture(2);
    const answers={...emptyOnboardingAnswers(),answers:{prove_knowing:"map_it"}};
    const composition=composeNormalPlanEnvelopes({...fixture,durationContext:{...fixture.durationContext,onboardingAnswers:answers},learningIntentRecommendation:{intent:"learn",basis:"Start the accepted unit."}});
    const plan=buildNormalPlanFromFixedEnvelope({...fixture,composition,methodContext:{...fixture.methodContext,baselineOnboardingAnswers:answers},fill:buildNormalPlanFallbackFill({request:fixture.request,composition})});
    const first=plan.sessions[0]!;
    const expected=routeSession({taskType:first.studyRoute!.target.taskFamily,blockKind:"learn",evidence:"not_assessed",hasSource:false,topicHasProblems:false,answers});
    expect(first.method).toBe(expected.methodName);
    expect(first.studyRoute?.agency.selectedBy).toBe("yova");
    expect(first.studyRoute?.provenance.ruleTrace.some(rule=>rule.evidenceRefs.some(ref=>ref.includes("q6.map_it")))).toBe(true);
  });
  it("preserves workload in protected activation and revision context while keeping legacy activation bounded",()=>{
    const sql=readFileSync("supabase/migrations/20260917160001_topic_plan_workloads.sql","utf8");
    expect(sql).toContain("'workload', session -> 'workload'");
    expect(sql).toContain("'workload',s.step_data->'workload'");
    expect(sql).toContain("topic_plan_v2");
    expect(sql).toContain("then 200 else 14 end");
    expect(sql).toContain("then 400 else 28 end");
    expect(sql).toContain("signed_in_generation_readiness_v6");
  });
});
