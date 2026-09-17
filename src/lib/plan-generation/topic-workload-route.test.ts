import { describe,expect,it } from "vitest";
import { applyTopicWorkloadToRoute, questionMixForTopicWorkload } from "./topic-workload-route";
import { immediateTopicWorkload } from "./topic-plan-model";
import { routeSession } from "@/lib/routing/session-route";
import { emptyOnboardingAnswers } from "@/lib/onboarding/answers";
import { deltaFixture } from "@/evals/personalization-delta-fixture";

describe("workload projection preserves task-first question routing",()=>{
 it("retains prediction and misconception slots when scaling a reading task",()=>{
  const answers=emptyOnboardingAnswers();const route=routeSession({taskType:"reading_to_quiz",blockKind:"practice",evidence:"not_assessed",hasSource:false,topicHasProblems:false,answers});
  const work={version:"topic_workload_v1" as const,topicSubtopics:[],questionCount:20,recallQuestionCount:12,transferQuestionCount:8,produceSteps:0,sourceReadMinutes:0,estimatedMinutes:25,ceilingMinutes:30,practicePlaceholder:true,practiceRound:1,suggestedDate:true,ruleIds:[]};
  const projected=applyTopicWorkloadToRoute(route,work);
  expect(projected.questionMix).toEqual({recall:8,misconception:4,application:4,prediction:4,compare_contrast:0});
  expect(Object.values(projected.questionMix).reduce((sum,n)=>sum+n,0)).toBe(20);
 });
 it("sizes memorization work from its recall-focused task mix",()=>{
  const fixture=deltaFixture(2);const topic={...fixture.request.knowledgeMap!.topics[0]!,title:"Biology vocabulary definitions",description:"Memorize and recall the biology vocabulary definitions.",subtopics:[]};
  const work=immediateTopicWorkload({request:{...fixture.request,goal:"Memorize biology vocabulary definitions for a quiz."},topic,learn:false,ceilingMinutes:60});
  expect(work.transferQuestionCount).toBe(0);expect(work.recallQuestionCount).toBe(work.questionCount);
  expect(work.questionCount).toBe(32);expect(work.estimatedMinutes).toBe(33);
 });
 it("does not move saved recall or transfer work between categories when a posted mix omits a whole group",()=>{
  const mix=questionMixForTopicWorkload({recall:0,misconception:0,application:0,prediction:0,compare_contrast:0},{recallQuestionCount:4,transferQuestionCount:6});
  expect(mix.recall+mix.misconception).toBe(4);
  expect(mix.application+mix.prediction+mix.compare_contrast).toBe(6);
 });

});
