import { expect,it } from "vitest";
import { mkdirSync,writeFileSync } from "node:fs";
import { join } from "node:path";
import { deltaFixture } from "@/evals/personalization-delta-fixture";
import { emptyOnboardingAnswers,type OnboardingAnswerValues } from "@/lib/onboarding/answers";
import { composeNormalPlanEnvelopes } from "./normal-plan-envelopes";
import { buildNormalPlanFallbackFill } from "./normal-plan-provider-fill";
import { buildNormalPlanFromFixedEnvelope } from "./normal-plan-pipeline";

it("produces visibly different complete queues for two profiles using the same map and availability",()=>{
 const fixture=deltaFixture(2);const request={...fixture.request,deadline:"2026-11-28T20:00:00.000Z",availability:[{day:"Every day",window:"Morning",minutes:120},{day:"Every day",window:"Evening",minutes:120}],knowledgeMap:{...fixture.request.knowledgeMap!,topics:fixture.request.knowledgeMap!.topics.map(topic=>({...topic,subtopics:["Purpose","Inputs","Outputs","Mechanism","Relationships","Applications"]}))}};
 const values:OnboardingAnswerValues[]=[{energy_window:"morning",session_length:"minutes_10_15",focus_loss:"often",guidance:"exact_guidance",difficulty_help:"step_by_step",prove_knowing:"map_it",gist_detail:"gist_leaning",starting_pattern:"often_delay",support_needs:["shorter_sections","frequent_check_ins"],extra_context:"forget_during_tests"},{energy_window:"evening",session_length:"minutes_45_60",focus_loss:"rarely",guidance:"learner_choice",difficulty_help:"simple_explanation",prove_knowing:"explain_back",gist_detail:"detail_leaning",starting_pattern:"on_time",support_needs:["no_extra_support"],extra_context:"nothing_else"}];
 const examples=values.map((values,index)=>{
  const answers={...emptyOnboardingAnswers(),answers:values};const composition=composeNormalPlanEnvelopes({...fixture,request,durationContext:{...fixture.durationContext,onboardingAnswers:answers},learningIntentRecommendation:{intent:request.learningIntent,basis:"Teach the same accepted topics and check them independently."}});
  const plan=buildNormalPlanFromFixedEnvelope({...fixture,request,composition,methodContext:{...fixture.methodContext,baselineOnboardingAnswers:answers},fill:buildNormalPlanFallbackFill({request,composition})});
  return{profile:index===0?"Short focused blocks with frequent support":"Long independent blocks with learner-chosen dates",answers,plan};
 });
 expect(examples[0]!.plan.sessions.length).toBeGreaterThan(examples[1]!.plan.sessions.length);
 expect(examples[0]!.plan.sessions[0]!.method).not.toBe(examples[1]!.plan.sessions[0]!.method);
 expect(examples[0]!.plan.sessions[0]!.estimatedMinutes).toBeLessThan(examples[1]!.plan.sessions[0]!.estimatedMinutes);
 for(const {plan}of examples)expect(new Set(plan.sessions.flatMap(session=>session.topicIds??[])).size).toBe(6);
 const out=process.env.YOVA_PLAN_AUDIT_OUTPUT;
 if(out){mkdirSync(out,{recursive:true});writeFileSync(join(out,"profile-queues.json"),JSON.stringify(examples,null,2)+"\n");writeFileSync(join(out,"PROFILE-QUEUES.md"),"# Same topic map, different learning profiles\n\nDeterministic local fixture; full live provider and browser evidence is a separate CI gate. Both plans use the same six topics, six subtopics each, dates, goal and sources. The exported JSON contains both complete generated plans.\n\n"+examples.map(({profile,answers,plan})=>`## ${profile}\n\n${plan.title}\n\n${plan.planModel!.personalizationSentence}\n\n${plan.sessions.length} blocks; ${plan.planModel!.scheduleMode}.\n\nProfile: ${JSON.stringify(answers.answers)}\n\n| Block | Topic | Method | Work | Estimate | Date |\n|---|---|---|---|---:|---|\n`+plan.sessions.map(s=>`| ${s.sequence} | ${plan.knowledgeMap!.topics.find(t=>t.id===s.topicIds?.[0])!.title} | ${s.method} | ${s.workload!.questionCount} questions; ${s.workload!.produceSteps} production step | ${s.estimatedMinutes} min | ${s.workload!.suggestedDate?s.scheduledFor:"Learner chooses"} |`).join("\n")).join("\n\n"));}
});
