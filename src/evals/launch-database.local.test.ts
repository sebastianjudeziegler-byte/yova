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
  test.each(["adjust", "attach-existing", "attach-new"])("%s preserves an activated routed plan", async (operation) => {
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
      if (operation !== "adjust") {
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
      const adjusted = await client.query("select public.adjust_learning_plan_with_routes($1::jsonb) as result", [JSON.stringify({planId:plan.id,deadline:null,studyMode:plan.studyMode,futureSessionMinutes:15,sessions,knowledgeMap:plan.knowledgeMap})]);
      expect(adjusted.rows[0].result.sessions.every((session: {estimatedMinutes:number})=>session.estimatedMinutes<=15)).toBe(true);
      await client.query("set constraints all immediate");
    } finally { await client.query("rollback"); await client.end(); }
  },20000);
});
