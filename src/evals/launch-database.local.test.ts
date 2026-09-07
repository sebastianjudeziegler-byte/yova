import { describe, expect, test, vi } from "vitest";
import { getCoreLearningMethod } from "@/lib/learning/method-catalog";
import { sourceAttachmentSuccessor } from "@/lib/materials/attachment-routes";
import { reconcileMappedMaterialsIntoActivePlan } from "@/lib/materials/active-plan-attachment";
import { MaterialUnderstandingSchema } from "@/lib/knowledge-map/schema";
import { randomUUID } from "node:crypto";
import { composeNormalPlanEnvelopes } from "@/lib/plan-generation/normal-plan-envelopes";
import { buildNormalPlanFallbackFill } from "@/lib/plan-generation/normal-plan-provider-fill";
import { buildNormalPlanFromFixedEnvelope } from "@/lib/plan-generation/normal-plan-pipeline";
import { PlanGenerationRequestSchema } from "@/lib/plan-generation/schema";
import { commitPlanStudyRoutes } from "@/lib/study-route/activation";
import { buildProtectedPlanAdjustmentSessions, learningPlanSessionToAdjustableRow } from "@/lib/learning/content-based-plan-adjustment";
import { preparePlanAdjustmentStudyRoutes } from "@/lib/study-route/plan-adjustment";
vi.mock("server-only", () => ({}));

describe.skipIf(!process.env.YOVA_LOCAL_PG_MODULE)("launch database regression on isolated PostgreSQL", () => {
  test.each(["adjust", "attach-existing", "attach-new", "unrated-checkpoint", "forged-placement", "server-placement", "ten-minute-plan", "forged-revision-evidence", "placement-replay", "release-readiness", "direct-placement"])("%s preserves an activated routed plan", async (operation) => {
    const { Client } = await import(process.env.YOVA_LOCAL_PG_MODULE!);
    const client = new Client({ host: "127.0.0.1", port: Number(process.env.YOVA_LOCAL_PG_PORT ?? 55439), user: "postgres", password: "local-yova-test-only", database: "yova_utf8" });
    await client.connect();
    try {
      await client.query("begin; set local statement_timeout='8s'");
      await client.query("grant usage on schema auth to authenticated");
      const userId = randomUUID();
      await client.query("insert into auth.users(id,email) values($1,$2)", [userId, `${userId}@example.com`]);
      await client.query("select set_config('request.jwt.claim.sub',$1,true), set_config('request.jwt.claim.role','service_role',true)", [userId]);
      const request = PlanGenerationRequestSchema.parse({ intent: "plan", goal: "Learn osmosis, diffusion and active transport for a biology exam", learningIntent: "learn", materialMode: "none", materials: [], studyMode: "inside", timeZone: "Europe/London", profileSummary: "No established learning preferences.", availability: ["Monday","Wednesday","Friday"].map(day=>({day,window:"Afternoon",minutes:25})), diagnosticResponses: [] });
      const now = new Date();
      if (operation === "ten-minute-plan") {
        request.availability = [{day:"Every day",window:"Evening",minutes:10}];
        request.deadline = new Date(now.getTime()+24*60*60_000).toISOString();
      }
      request.knowledgeMap = {
        version: 1,
        scopeJudgment: { band: "focused_skill", label: "Cell transport", minimumSessions: 3, recommendedSessions: 5, maximumSessions: 8, minimumTeachingSessions: 1, explanation: "Learn each cell transport process and practise distinguishing them." },
        topics: ["Osmosis", "Diffusion", "Active transport"].map(title => ({ id: randomUUID(), title, description: `Explain how ${title.toLowerCase()} moves substances across a cell membrane.`, subtopics: [], prerequisiteTopicIds: [], status: "not_started", initialEvidence: null, sourceReferences: [], origin: "ai_generated", deferred: null })),
        placementCheck: { status: "skipped", completedAt: null, demonstratedTopicIds: [], gapTopicIds: [] }, curriculum: null,
      };
      const composition = composeNormalPlanEnvelopes({ request, now, learningIntentRecommendation: { intent: "learn", basis: "The learner is starting cell transport." }, durationContext: { profileVersion: "authorized_duration_profile_v1+duration_outcomes_empty", profile: { sustainableMinutes: 25, startingFrictionRisk: null, fatigueRisk: null, preferredWindow: null, evidenceRefs: { sustainableMinutes: ["profile:sustainable-duration"], startingFrictionRisk: [], fatigueRisk: [], preferredWindow: [] } }, recentOutcomes: [] } });
      const generated = buildNormalPlanFromFixedEnvelope({ request, composition, fill: buildNormalPlanFallbackFill({ request, composition }), now, methodContext: { profileVersion: "authorized_method_profile_v1+method_outcomes_empty", personalization: { decisions: [], methodTie: { state: { controls: { experiments: false }, activeExperiment: null, experimentHistory: [] }, signals: [] } }, observedEvidence: [] } });
      const plan = commitPlanStudyRoutes({...generated, status: "active"},now.toISOString());
      const payload = { ...plan, generationInputs: request };
      const minted = await client.query("select public.mint_plan_activation_permit_v1($1::jsonb,$2::uuid,$3::timestamptz) as id", [JSON.stringify(payload),userId,new Date().toISOString()]);
      await client.query("select set_config('request.jwt.claim.role','authenticated',true)");
      await client.query("select public.save_generated_plan_with_routes($1::jsonb,$2::uuid)",[JSON.stringify(payload),minted.rows[0].id]);
      if (operation === "ten-minute-plan") {
        expect(plan.sessions).toHaveLength(1);
        expect(plan.sessions[0]!.estimatedMinutes).toBe(10);
        expect(plan.sessions[0]!.objective).toMatch(/Osmosis/i);
        const stored = (await client.query("select estimated_minutes,committed_route_revision_id from public.plan_sessions where id=$1",[plan.sessions[0]!.id])).rows[0];
        expect(stored.estimated_minutes).toBe(10);
        expect(stored.committed_route_revision_id).toBe(plan.sessions[0]!.studyRoute!.identity.routeRevisionId);
        console.log(`Ten-minute first step activates: ${plan.sessions[0]!.title}. ${plan.rationale}`);
        return;
      }
      if (operation === "direct-placement") {
        await client.query("set local role authenticated");
        const forged = {...plan.knowledgeMap,topics:plan.knowledgeMap!.topics.map(topic=>({...topic,status:"evidenced"}))};
        await expect(client.query("update public.plans set knowledge_map=$2::jsonb where id=$1",[plan.id,JSON.stringify(forged)])).rejects.toMatchObject({code:"42501"});
        return;
      }
      if (operation === "forged-placement") {
        await client.query("set local role authenticated");
        await expect(client.query("select public.update_plan_diagnostic_knowledge_map_v1($1::uuid,$2::jsonb)", [plan.id,JSON.stringify({...plan.knowledgeMap,topics:plan.knowledgeMap!.topics.map(topic=>({...topic,status:"evidenced"}))})])).rejects.toMatchObject({code:"42501"});
        return;
      }
      if (operation === "server-placement") {
        const map = plan.knowledgeMap!;
        const demonstrated = {...map,placementCheck:{status:"completed",completedAt:now.toISOString(),demonstratedTopicIds:[map.topics[0]!.id],gapTopicIds:[]},topics:map.topics.map((topic,index)=>index===0?{...topic,status:"evidenced",initialEvidence:{source:"placement_check",outcome:"demonstrated",observedAt:now.toISOString()}}:topic)};
        await client.query("select set_config('request.jwt.claim.role','service_role',true)");
        await client.query("set local role service_role");
        const saved = await client.query("select public.save_server_scored_plan_diagnostic_v1($1,$2,$3::jsonb,$4::jsonb) as value", [plan.id,userId,JSON.stringify(map),JSON.stringify(demonstrated)]);
        expect(saved.rows[0].value).toBe(true);
        await client.query("savepoint stale_placement");
        await expect(client.query("select public.save_server_scored_plan_diagnostic_v1($1,$2,$3::jsonb,$4::jsonb)", [plan.id,userId,JSON.stringify(map),JSON.stringify(demonstrated)])).rejects.toMatchObject({message:"plan_diagnostic_map_changed"});
        await client.query("rollback to savepoint stale_placement");
        await client.query("savepoint changed_scope");
        await expect(client.query("select public.save_server_scored_plan_diagnostic_v1($1,$2,$3::jsonb,$4::jsonb)", [plan.id,userId,JSON.stringify(demonstrated),JSON.stringify({...demonstrated,topics:demonstrated.topics.slice(1)})])).rejects.toMatchObject({message:"placement_cannot_change_topic_scope"});
        await client.query("rollback to savepoint changed_scope");
        await client.query("reset role");
        const actual = (await client.query("select knowledge_map from public.plans where id=$1",[plan.id])).rows[0].knowledge_map;
        expect(actual).toEqual(demonstrated);
        console.log(`Server-scored ${actual.topics[0].title} is saved as Quick verification; other topics and all sessions keep their scope.`);
        return;
      }
      if (operation === "release-readiness") {
        await client.query("select set_config('request.jwt.claim.role','service_role',true)");
        await client.query("set local role service_role");
        const value = (await client.query("select public.signed_in_generation_readiness_v4() as value")).rows[0].value;
        expect(value).toMatchObject({contractVersion:"20260907160001",ready:true,placementEvidenceBoundary:true,unansweredCompletionFeedback:true});
        const abuse = (await client.query("select public.public_launch_abuse_readiness_v1() as value")).rows[0].value;
        expect(abuse.untrustedInsertQuotas).toBe(true);
        await client.query("set local role authenticated");
        await expect(client.query("select public.signed_in_generation_readiness_v4()")).rejects.toMatchObject({code:"42501"});
        return;
      }
      if (operation === "placement-replay") {
        const args = [userId,"a".repeat(64),"b".repeat(64),new Date(Date.now()+30*60_000).toISOString()];
        const sql = "select public.claim_placement_scoring_v1($1,$2,$3,$4) as claimed";
        await client.query("set local role authenticated");
        await client.query("savepoint client_receipt");
        await expect(client.query(sql,args)).rejects.toMatchObject({code:"42501"});
        await client.query("rollback to savepoint client_receipt");
        await client.query("reset role");
        await client.query("select set_config('request.jwt.claim.role','service_role',true)");
        await client.query("set local role service_role");
        expect((await client.query(sql,args)).rows[0].claimed).toBe(true);
        expect((await client.query(sql,args)).rows[0].claimed).toBe(true);
        expect((await client.query(sql,[args[0],args[1],"c".repeat(64),args[3]])).rows[0].claimed).toBe(false);
        console.log("The same answers can be retried after a lost response; changed answers require a fresh placement check.");
        return;
      }
      if (operation === "unrated-checkpoint") {
        const session = plan.sessions[0]!;
        const timestamp = now.toISOString();
        const resource = {
          schemaVersion: 17, model: "isolated-checkpoint-fixture", generatedAt: timestamp,
          rationale: session.methodReason, topicIds: session.topicIds,
          coverage: {}, methodBriefing: {}, deliveryPolicy: {},
          activities: ["Explain the model", "Check the model", "Reflect on the check"].map(title => ({title})),
        };
        await client.query("update public.plan_sessions set status='ready', step_data=step_data || jsonb_build_object('generatedSession',$2::jsonb) where id=$1", [session.id,JSON.stringify(resource)]);
        const checkpoint = {
          version: 2, runId: randomUUID(), planSessionId: session.id,
          routeRevisionId: session.studyRoute!.identity.routeRevisionId,
          status: "awaiting_finish", startedAt: new Date(now.getTime()-60000).toISOString(),
          savedAt: timestamp, completedAt: timestamp, completionFeedback: null,
          activeSeconds: 60, plannedMinutes: session.estimatedMinutes,
          completedSteps: 1, totalSteps: 1, resumeStep: 1,
          resourceFingerprint: "sr1:0123456789abcdef", resourceGeneratedAt: timestamp,
          evidence: {correctAnswers:1,totalAnswers:1,conceptEvidence:[],confidenceEvidence:[],observedGap:"No gap observed yet.",completedImmediateRepairs:0},
        };
        await client.query("set local role authenticated");
        const saved = (await client.query("select public.save_active_session_checkpoint_with_route($1::jsonb) as value", [JSON.stringify(checkpoint)])).rows[0].value;
        expect(saved.completionFeedback).toBeNull();
        expect(saved.evidence).toEqual(checkpoint.evidence);
        await client.query("reset role");
        const reloaded = (await client.query("select step_data->'activeSessionCheckpoint' as value from public.plan_sessions where id=$1",[session.id])).rows[0].value;
        expect(reloaded.completionFeedback).toBeNull();
        await client.query("set local role authenticated");
        console.log("Learner resumes SESSION COMPLETE with no challenge rating; 1 of 1 observed answers remain saved.");
        await client.query("savepoint invalid_rating");
        await expect(client.query("select public.save_active_session_checkpoint_with_route($1::jsonb)", [JSON.stringify({...checkpoint,completionFeedback:"invented"})])).rejects.toMatchObject({message:"An awaiting-finish checkpoint is not valid."});
        await client.query("rollback to savepoint invalid_rating");
        await client.query("select public.complete_plan_session_with_route($1::jsonb)", [JSON.stringify({
          completionVariant:"guided", completionMode:"guided", attemptId:checkpoint.runId,
          planSessionId:session.id, routeRevisionId:checkpoint.routeRevisionId,
          startedAt:checkpoint.startedAt,completedAt:timestamp,plannedMinutes:session.estimatedMinutes,actualMinutes:1,
          correctAnswers:1,totalAnswers:1,feedback:null,observedGap:"No gap observed yet.",
          conceptEvidence:[],confidenceEvidence:[],nextSessionAdjustment:null,nextSessionStudyRoute:null,followUpSession:null,continuationSession:null,
        })]);
        await client.query("reset role");
        const attempt = (await client.query("select user_feedback,correct_answers,total_answers from public.session_attempts where id=$1",[checkpoint.runId])).rows[0];
        expect(attempt).toMatchObject({user_feedback:null,correct_answers:1,total_answers:1});
        console.log("Finish saves one completed session, one observed correct answer, and an unanswered challenge rating.");
        return;
      }
      if (operation !== "adjust" && operation !== "forged-revision-evidence") {
        const completed = plan.sessions[0]!;
        await client.query("update public.plan_sessions set status='complete' where id=$1", [completed.id]);
        const before = (await client.query("select to_jsonb(s) as value from public.plan_sessions s where id=$1", [completed.id])).rows[0].value;
        const pending = plan.sessions.slice(1);
        const pendingTopicIds = pending.flatMap(session => session.topicIds ?? []);
        const topic = plan.knowledgeMap!.topics.find(topic => pendingTopicIds.includes(topic.id))!;
        const materialId = randomUUID(); const chunkId = randomUUID();
        const text = "Water moves across a selectively permeable membrane toward the higher concentration of dissolved solutes.";
        const understanding = MaterialUnderstandingSchema.parse({ version: 1, role: "content_source", roleReason: "These notes explain the target with a concrete worked example.", mixedSections: [], chunkCount: 1, mappedAt: now.toISOString(), topics: [{ ...topic, id: randomUUID(), ...(operation === "attach-new" ? { title: "Membrane proteins and carrier saturation", description: "Explain why transport carriers saturate at high substrate concentrations.", subtopics: [] } : {}), prerequisiteTopicIds: [], status: "not_started", initialEvidence: null, origin: "material", deferred: null, sourceReferences: [{ materialId, chunkId, chunkIndex: 0, startCharacter: 0, endCharacter: text.length, locationLabel: "Paragraph 1", sectionRole: "content_source" }] }] });
        await client.query("insert into public.material_uploads(id,user_id,filename,storage_path,mime_type,byte_size,processing_status,extracted_text,metadata) values($1,$2,'notes.txt',$3,'text/plain',$4,'ready',$5,$6::jsonb)", [materialId, userId, `${userId}/${materialId}/notes.txt`, text.length, text, JSON.stringify({ mappingStatus: "ready", materialUnderstanding: understanding })]);
        await client.query("insert into public.material_chunks(id,user_id,material_id,chunk_index,char_start,char_end,location_label,section_role,chunk_text) values($1,$2,$3,0,0,$4,'Paragraph 1','content_source',$5)", [chunkId,userId,materialId,text.length,text]);
        const knowledgeMap = reconcileMappedMaterialsIntoActivePlan({ knowledgeMap: plan.knowledgeMap!, understandings: [understanding], unfinishedTopicIds: pendingTopicIds });
        const studyRoutes = pending.map(session => sourceAttachmentSuccessor(session.studyRoute!, [materialId], now.toISOString()));
        const payload = { planId: plan.id, materialIds: [materialId], knowledgeMap, studyRoutes };
        await client.query("set local role authenticated");
        const attached = (await client.query("select public.attach_materials_to_plan($1::jsonb) as value", [JSON.stringify(payload)])).rows[0].value;
        expect(attached.studyRoutes).toHaveLength(pending.length);
        expect(attached.materials).toHaveLength(1);
        expect(attached.knowledgeMap).toEqual(knowledgeMap);
        await client.query("reset role");
        expect((await client.query("select to_jsonb(s) as value from public.plan_sessions s where id=$1", [completed.id])).rows[0].value).toEqual(before);
        await client.query("set local role authenticated");
        await client.query("savepoint source_guard");
        const tampered = structuredClone(payload);
        tampered.studyRoutes[0]!.target.desiredOutcome = "Replace the learner's accepted target without asking.";
        await expect(client.query("select public.attach_materials_to_plan($1::jsonb)", [JSON.stringify(tampered)])).rejects.toMatchObject({ message: "material_attachment_source_only_revision_required" });
        await client.query("rollback to savepoint source_guard");
        const retry = { ...payload, studyRoutes: attached.studyRoutes };
        expect((await client.query("select public.attach_materials_to_plan($1::jsonb) as value", [JSON.stringify(retry)])).rows[0].value.materials).toHaveLength(1);
        if (operation === "attach-new") {
          const nextPlan = { ...plan, sourceMode: "user_materials" as const, materials: attached.materials, knowledgeMap, sessions: plan.sessions.map((session, index) => index === 0 ? { ...session, status: "complete" as const } : { ...session, studyRoute: attached.studyRoutes.find((route: {identity: {sessionId: string}}) => route.identity.sessionId === session.id) }) };
          const added = knowledgeMap.topics.at(-1)!;
          const id = randomUUID();
          const extra = { id, sequence: plan.sessions.length + 1, title: `Learn ${added.title}`, objective: `Build an accurate model of ${added.title}, then produce one independent check tied to this topic.`, method: getCoreLearningMethod("self_explanation").name, method_rationale: "This topic was outside the original time budget, so YOVA will teach it before asking for independent evidence.", scheduled_for: new Date(Date.now() + 14 * 86400000).toISOString(), estimated_minutes: 25, status: "upcoming" as const, step_data: { learningMode: "learn", topicIds: [added.id], contentTargets: [added.title, ...added.subtopics.slice(0,3)], completionEvidence: [`Explain ${added.title} accurately and complete one independent check`] } };
          const sessions = preparePlanAdjustmentStudyRoutes({ plan: nextPlan, replacementSessions: buildProtectedPlanAdjustmentSessions([...nextPlan.sessions.slice(1).map(learningPlanSessionToAdjustableRow), extra], 25, 2), nextStudyMode: plan.studyMode, changedAt: new Date().toISOString(), reason: "Include the new source topic in future sessions.", newSessionOriginIds: { [id]: pending.at(-1)!.id } });
          const revisedMap = { ...knowledgeMap, topics: knowledgeMap.topics.map(topic => topic.id === added.id ? {...topic, deferred: null} : topic) };
          const included = await client.query("select public.adjust_learning_plan_with_routes($1::jsonb) as value", [JSON.stringify({ planId: plan.id, deadline: null, studyMode: plan.studyMode, futureSessionMinutes: 25, includeDeferred: true, sessions, knowledgeMap: revisedMap })]);
          expect(included.rows[0].value.sessions.some((session: {topicIds: string[]}) => session.topicIds.includes(added.id))).toBe(true);
        }
        await client.query("set constraints all immediate");
        return;
      }
      const sessions = preparePlanAdjustmentStudyRoutes({plan,replacementSessions:buildProtectedPlanAdjustmentSessions(plan.sessions.map(learningPlanSessionToAdjustableRow),15,1),nextStudyMode:plan.studyMode,changedAt:new Date().toISOString(),reason:"Use fifteen-minute study sessions."});
      await client.query("set local role authenticated");
      if (operation === "forged-revision-evidence") {
        const forgedMap = {...plan.knowledgeMap,topics:plan.knowledgeMap!.topics.map(topic=>({...topic,status:"evidenced",initialEvidence:{source:"placement_check",outcome:"demonstrated",observedAt:now.toISOString()}}))};
        await client.query("savepoint forged_revision");
        await expect(client.query("select public.adjust_learning_plan_with_routes($1::jsonb)",[JSON.stringify({planId:plan.id,deadline:null,studyMode:plan.studyMode,futureSessionMinutes:15,sessions,knowledgeMap:forgedMap})])).rejects.toMatchObject({message:"plan_revision_cannot_change_evidence"});
        await client.query("rollback to savepoint forged_revision");
        await client.query("reset role");
        expect((await client.query("select knowledge_map from public.plans where id=$1",[plan.id])).rows[0].knowledge_map).toEqual(plan.knowledgeMap);
        // Even a previously demonstrated topic cannot donate its evidence to a
        // renamed target while retaining the same identifier.
        await client.query("update public.plans set knowledge_map=$2::jsonb where id=$1",[plan.id,JSON.stringify(forgedMap)]);
        const renamed = {...forgedMap,topics:forgedMap.topics.map((topic,index)=>index===0?{...topic,title:"Chemiosmosis"}:topic)};
        await client.query("set local role authenticated");
        await client.query("savepoint transferred_evidence");
        await expect(client.query("select public.adjust_learning_plan_with_routes($1::jsonb)",[JSON.stringify({planId:plan.id,deadline:null,studyMode:plan.studyMode,futureSessionMinutes:15,sessions,knowledgeMap:renamed})])).rejects.toMatchObject({message:"plan_revision_cannot_change_evidence"});
        await client.query("rollback to savepoint transferred_evidence");
        console.log("Revising a plan cannot turn Teach and check into Quick verification or transfer Osmosis evidence to Chemiosmosis.");
        return;
      }
      const adjusted = await client.query("select public.adjust_learning_plan_with_routes($1::jsonb) as result", [JSON.stringify({planId:plan.id,deadline:null,studyMode:plan.studyMode,futureSessionMinutes:15,sessions,knowledgeMap:plan.knowledgeMap})]);
      expect(adjusted.rows[0].result.sessions.every((session: {estimatedMinutes:number})=>session.estimatedMinutes<=15)).toBe(true);
      await client.query("set constraints all immediate");
    } finally { await client.query("rollback"); await client.end(); }
  },20000);
});
