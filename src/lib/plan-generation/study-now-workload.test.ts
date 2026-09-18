import { describe, expect, it } from "vitest";
import { immediateTopicWorkload } from "./topic-plan-model";
import { deltaFixture } from "@/evals/personalization-delta-fixture";
import { emptyOnboardingAnswers } from "@/lib/onboarding/answers";
import { parseStudyNowDurationDecision } from "@/lib/study-route/duration-plan-integration";

describe("Study Now workload",()=>{
 it("sizes a forty minute active-recall session from substantive work rather than three short five-question rounds",()=>{
  const fixture=deltaFixture(1);const topic=fixture.request.knowledgeMap!.topics[0]!;
  const work=immediateTopicWorkload({request:fixture.request,topic,learn:false,answers:{...emptyOnboardingAnswers(),answers:{session_length:"minutes_45_60"}},ceilingMinutes:40});
  expect(work.questionCount).toBeGreaterThan(20);
  expect(work.questionCount).toBeLessThanOrEqual(32);
  expect(work.estimatedMinutes).toBeGreaterThanOrEqual(32);
  expect(work.estimatedMinutes).toBeLessThanOrEqual(40);
  expect(work.practicePlaceholder).toBe(false);
  expect(work.suggestedDate).toBe(false);
 });
 it("accepts actual content estimates only with explicit deterministic workload provenance",()=>{
  const decision={timing:{activeMinutes:34,elapsedMinutes:34,hardMaximumMinutes:40,durationSource:"profile_recommendation" as const},ruleTrace:[{ruleId:"plan.workload.content_estimate",result:"24_questions_34_minutes",reason:"Counts substantive questions and answer reveals.",evidenceRefs:[]}],routerVersion:"topic_workload_v1",profileVersion:"authorized_profile:test"};
  expect(parseStudyNowDurationDecision(decision,40).timing.activeMinutes).toBe(34);
  expect(()=>parseStudyNowDurationDecision({...decision,routerVersion:"legacy_duration"},40)).toThrow("normal-session duration");
 });
});
