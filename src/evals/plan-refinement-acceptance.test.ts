import { expect, test } from "vitest";
import { auditDuration, auditNow, shortDeadlineRequest } from "@/evals/plan-creation-blocker-cases";
import { composeNormalPlanEnvelopes } from "@/lib/plan-generation/normal-plan-envelopes";
import { buildNormalPlanFallbackFill } from "@/lib/plan-generation/normal-plan-provider-fill";

const learningIntentRecommendation = {intent:"learn" as const,basis:"The learner is starting this topic from scratch."};

test("separate sessions leave the learner a reset before the next session", () => {
  const request = shortDeadlineRequest(11);
  const plan = composeNormalPlanEnvelopes({request, now:auditNow, durationContext:auditDuration(25),learningIntentRecommendation});
  const sessions = [...plan.envelopes].sort((a,b)=>a.scheduledFor.localeCompare(b.scheduledFor));
  for (let index=1;index<sessions.length;index+=1) {
    const previous=sessions[index-1]!;
    const next=sessions[index]!;
    const resetMinutes=(Date.parse(next.scheduledFor)-Date.parse(previous.scheduledFor))/60_000-previous.timing.activeMinutes;
    expect(resetMinutes, `${previous.scheduledFor}: ${previous.timing.activeMinutes} minutes, then ${next.scheduledFor}`).toBeGreaterThanOrEqual(5);
  }
});

test("a fallback session title ends on a whole word", () => {
  const request=shortDeadlineRequest(11);
  const title="Understanding how mitochondrial electron transport establishes the proton gradient that drives ATP synthesis through chemiosmosis";
  request.knowledgeMap!.topics=[{...request.knowledgeMap!.topics[0]!,title}];
  request.knowledgeMap!.scopeJudgment={band:"focused_skill",label:"ATP synthesis",minimumSessions:2,recommendedSessions:2,maximumSessions:4,minimumTeachingSessions:1,explanation:"Understand the proton gradient and check how it drives ATP synthesis."};
  const composition=composeNormalPlanEnvelopes({request,now:auditNow,durationContext:auditDuration(25),learningIntentRecommendation});
  const fill=buildNormalPlanFallbackFill({request,composition});
  const learnerTitle=fill.sessions[composition.envelopes[0]!.envelopeId]!.title;
  const lastWord=learnerTitle.replace(/…$/,"").split(/\s+/).at(-1);
  expect([...title.split(/\s+/),"more"],learnerTitle).toContain(lastWord);
  expect(learnerTitle.length).toBeLessThanOrEqual(90);
});
