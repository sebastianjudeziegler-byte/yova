import { expect,it } from "vitest";
import { refreshTopicPlanMetadata } from "./refresh-topic-plan-metadata";
import { deltaFixture } from "@/evals/personalization-delta-fixture";
import { composeNormalPlanEnvelopes } from "./normal-plan-envelopes";
import { buildNormalPlanFallbackFill } from "./normal-plan-provider-fill";
import { buildNormalPlanFromFixedEnvelope } from "./normal-plan-pipeline";
it("refreshes dated conflicts and topic notes after a reviewed edit",()=>{
 const fixture=deltaFixture(2);const composition=composeNormalPlanEnvelopes({...fixture,learningIntentRecommendation:{intent:fixture.request.learningIntent,basis:"Use the accepted goal and topic evidence."}});
 const plan=buildNormalPlanFromFixedEnvelope({...fixture,composition,fill:buildNormalPlanFallbackFill({request:fixture.request,composition})});
 const changed={...plan,deadline:null,knowledgeMap:{...plan.knowledgeMap!,topics:plan.knowledgeMap!.topics.map((topic,index)=>({...topic,removed:index===1}))},planModel:{...plan.planModel!,constraints:["An old deadline constraint."]}};
 const refreshed=refreshTopicPlanMetadata(changed);
 expect(refreshed.planModel!.constraints).toEqual([]);expect(refreshed.planModel!.topicNotes).toHaveLength(plan.knowledgeMap!.topics.length-1);expect(changed.planModel.constraints).toHaveLength(1);
 expect(refreshTopicPlanMetadata({...plan,deadline:"2020-01-01T00:00:00Z"}).planModel!.constraints.length).toBeGreaterThan(0);
});
