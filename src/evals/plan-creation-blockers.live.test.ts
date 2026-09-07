import { writeFileSync } from "node:fs";
import { describe, expect, test, vi } from "vitest";
import { auditNow, auditDuration, shortDeadlineRequest } from "@/evals/plan-creation-blocker-cases";
import { generateMapDiagnostic, applyDiagnosticAnswers } from "@/lib/diagnostics/map-diagnostic";
import { generatePlanKnowledgeMap } from "@/lib/knowledge-map/generate-plan-map";
import { composeNormalPlanEnvelopes } from "@/lib/plan-generation/normal-plan-envelopes";
import { buildNormalPlanFallbackFill } from "@/lib/plan-generation/normal-plan-provider-fill";
import { buildNormalPlanFromFixedEnvelope } from "@/lib/plan-generation/normal-plan-pipeline";
import { generateNormalPlanFillWithOpenAI } from "@/lib/openai/normal-plan-fill-generator";
import { generateProductionSessionWithOpenAI } from "@/lib/openai/session-generation-strategy";
import { commitPlanStudyRoutes } from "@/lib/study-route/activation";
import { buildPreviewSessionContext } from "@/lib/session-generation/preview-context";
import { toSessionResource } from "@/lib/session-generation/resource";
import { CachedGeneratedSessionSchema } from "@/lib/session-generation/schema";
import { buildSessionCacheContext } from "@/lib/server/session-cache-context";
import { sessionCacheContractKey } from "@/lib/session-generation/cache-contract";
import { sessionResourceHasDeferredPlanTargets } from "@/lib/learning/session-continuation";

vi.mock("server-only",()=>({}));
const methodContext = {profileVersion:"audit_method_v1",personalization:{decisions:[],methodTie:{state:{controls:{experiments:false},activeExperiment:null,experimentHistory:[]},signals:[]}},observedEvidence:[]};

describe.skipIf(process.env.YOVA_RUN_LIVE_PLAN_BLOCKERS !== "1")("live provider launch canaries",()=>{
  test("real placement questions and a map-only scope correction preserve demonstrated ATP",async()=>{
    const request = shortDeadlineRequest(3);
    const diagnostic = await generateMapDiagnostic(request.knowledgeMap!,request.goal);
    expect(diagnostic.questions.filter(question=>question.topicId===request.knowledgeMap!.topics[0]!.id)).toHaveLength(2);
    const scored = applyDiagnosticAnswers(request.knowledgeMap!,diagnostic.questions,diagnostic.questions.map(question=>question.topicId===request.knowledgeMap!.topics[0]!.id?question.correctAnswer:"I don't know yet"),false);
    expect(scored.map.topics[0]!.initialEvidence?.outcome).toBe("demonstrated");
    const corrected = await generatePlanKnowledgeMap({...request,knowledgeMap:scored.map,mapCorrection:"Add fermentation as a new final topic. Keep every existing topic's wording, scope and identity unchanged."});
    const retained = corrected.map.topics.find(topic=>topic.id===scored.map.topics[0]!.id);
    expect(retained?.initialEvidence).toEqual(scored.map.topics[0]!.initialEvidence);
    expect(corrected.map.topics.some(topic=>/fermentation/i.test(topic.title))).toBe(true);
    const revised = {...request,knowledgeMap:corrected.map};
    const composition = composeNormalPlanEnvelopes({request:revised,now:auditNow,durationContext:auditDuration(60),learningIntentRecommendation:{intent:"learn",basis:"Teach untested topics and verify demonstrated ATP."}});
    const fill = await generateNormalPlanFillWithOpenAI({request:revised,composition,now:auditNow});
    const plan = buildNormalPlanFromFixedEnvelope({request:revised,composition,now:auditNow,fill:fill.fill,methodContext});
    expect(plan.sessions.find(session=>session.topicIds?.includes(retained!.id))?.learningMode).toBe("study");
    console.info(JSON.stringify({case:"live-correction",questions:diagnostic.questions,learnerView:{title:plan.title,rationale:plan.rationale,knownTopic:retained!.title,knownTopicLabel:"Quick verification",sessions:plan.sessions.map(({title,method,methodReason,objective,completionEvidence})=>({title,method,methodReason,objective,completionEvidence}))}}));
  },150_000);

  test("a ten-minute triage generates a runnable lesson on its saved topic",async()=>{
    const request = shortDeadlineRequest(1);
    const now = new Date("2026-09-07T19:35:00Z");
    const composition = composeNormalPlanEnvelopes({request,now,durationContext:auditDuration(60),learningIntentRecommendation:{intent:"learn",basis:"The learner is starting from scratch."}});
    const generatedPlan = buildNormalPlanFromFixedEnvelope({request,composition,now,fill:buildNormalPlanFallbackFill({request,composition}),methodContext});
    const plan = commitPlanStudyRoutes({...generatedPlan,status:"active"},now.toISOString());
    const session = plan.sessions[0]!;
    const context = {...buildPreviewSessionContext({plan,session,onboardingAnswers:[],completions:[],interruptions:[]}),materials:[]};
    const generated = await generateProductionSessionWithOpenAI(context);
    writeFileSync("docs/audits/2026-09-07-plan-creation/consolidated/evidence/live-ten-minute-provider.json",JSON.stringify({plan,generated},null,2));
    const resource = toSessionResource(CachedGeneratedSessionSchema.parse({
      ...generated.draft, schemaVersion:generated.deliveryInstructions?17:15,
      routeRevisionId:session.studyRoute!.identity.routeRevisionId,
      routingContext:generated.routingContext,supportPlan:generated.supportPlan,
      deliveryPolicy:generated.deliveryPolicy,
      ...(generated.deliveryInstructions?{deliveryInstructions:generated.deliveryInstructions}:{}),
      model:generated.model,generatedAt:new Date().toISOString(),
      cacheContext:buildSessionCacheContext({plannedMinutes:session.estimatedMinutes,adjustment:null,routeRevisionId:session.studyRoute!.identity.routeRevisionId,contractKey:sessionCacheContractKey({...context.session,reviewType:context.session.reviewType??null,reviewConcept:context.session.reviewConcept??null,knowledgeTopics:context.knowledgeTopics})}),
    }));
    expect(session.estimatedMinutes).toBe(10);
    expect(sessionResourceHasDeferredPlanTargets({...session,resource})).toBe(false);
    expect(resource.topicIds).toEqual(session.topicIds);
    expect(generated.draft.activities.filter(activity=>activity.requiredForCompletion).reduce((sum,activity)=>sum+activity.estimatedMinutes,0)).toBeLessThanOrEqual(10);
    console.info(JSON.stringify({case:"live-ten-minute",title:session.title,method:session.method,objective:session.objective,resource}));
    writeFileSync("docs/audits/2026-09-07-plan-creation/consolidated/evidence/live-ten-minute.json",JSON.stringify({plan,resource},null,2));
  },120_000);
});
