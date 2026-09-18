import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { DELTA_NOW, deltaFixture, deterministicDeltaPlan } from "@/evals/personalization-delta-fixture";
import type { LearningPlan, SessionCompletion } from "@/lib/domain";
import { emptyOnboardingAnswers } from "@/lib/onboarding/answers";
import { composeNormalPlanEnvelopes, type NormalPlanEnvelopeInput } from "@/lib/plan-generation/normal-plan-envelopes";
import { buildNormalPlanFallbackFill } from "@/lib/plan-generation/normal-plan-provider-fill";
import { buildNormalPlanFromFixedEnvelope } from "@/lib/plan-generation/normal-plan-pipeline";
import { PlanGenerationRequestSchema } from "@/lib/plan-generation/schema";
import { ShapeSlotRequestSchema } from "@/lib/session-shapes/slots-schema";
import { hydrateShapeSlotContext } from "@/lib/server/shape-slot-context";

vi.mock("server-only", () => ({}));
const clients = vi.hoisted(() => ({ learner: null as unknown as SupabaseClient, admin: null as unknown as SupabaseClient }));
vi.mock("@/lib/supabase/client", () => ({ createSupabaseBrowserClient: () => clients.learner }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => clients.learner }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => clients.admin }));
vi.mock("@/lib/supabase/config", async original => ({ ...await original<object>(), isSupabaseConfigured: () => true }));
import { commitPlanStudyRoutes } from "@/lib/study-route/activation";
import { persistPlanForAuthenticatedUser } from "@/lib/supabase/plan-repository";
import { completeAuthenticatedPlanSession, loadAuthenticatedLearningState, readAuthenticatedSessionCompletionReceipt } from "@/lib/supabase/learning-state-repository";
import { syncBaselineCompletion } from "./baseline-completion-sync";
import { loadQueuedSessionCompletions } from "./session-completion-outbox";

const url = process.env.YOVA_MIGRATED_SUPABASE_URL;
const publicKey = process.env.YOVA_MIGRATED_SUPABASE_PUBLISHABLE_KEY;
const secretKey = process.env.YOVA_MIGRATED_SUPABASE_SECRET_KEY;
const container = process.env.YOVA_MIGRATED_DB_CONTAINER;
const configured = Boolean(url && publicKey && secretKey && container);
describe.runIf(process.env.YOVA_REQUIRE_MIGRATED_ROUTE_TEST)("completion database is required in the migrated gate", () => {
  it("has every required connection", () => expect(configured).toBe(true));
});

describe.skipIf(!configured)("baseline Finish against the migrated database", () => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) };
  let userId: string;
  let offline = false;
  let dropReply = false;
  /** Start time while a case is tracing completion requests, otherwise 0. */
  let tracingTransport = 0;
  let writes = 0;
  let inspectingReload = false;
  const reloadFailures: Array<{ path: string; status: number; code: string | null; message: string | null }> = [];
  const uuidMap = new Map<string, string>();
  const fresh = <T,>(value: T): T => JSON.parse(JSON.stringify(value).replace(/[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}/gi, id => {
    if (!uuidMap.has(id)) uuidMap.set(id, randomUUID());
    return uuidMap.get(id)!;
  }));
  // These original transport-recovery cases deliberately use short, single-
  // topic blocks. The separate tests below exercise packed 60-minute blocks.
  const fixture = fresh({ request: deltaFixture(1).request, plan: deterministicDeltaPlan(1) });
  const plan = commitPlanStudyRoutes({ ...fixture.plan, status: "active" }, DELTA_NOW.toISOString());
  const completion = (index: number): SessionCompletion => {
    const session = plan.sessions[index]!;
    expect(session.workload?.segments).toBeUndefined();
    return { id: session.id, planId: plan.id, planSessionId: session.id, routeRevisionId: session.studyRoute!.identity.routeRevisionId,
      startedAt: "2026-09-17T10:00:00.000Z", completedAt: "2026-09-17T10:10:00.000Z", plannedMinutes: session.estimatedMinutes,
      actualMinutes: 10, correctAnswers: 2, totalAnswers: 2, feedback: null, observedGap: "No remaining gap identified.", completionMode: "guided", conceptEvidence: [], confidenceEvidence: [] };
  };
  function rows(id: string) {
    if (!/^[a-f\d-]{36}$/i.test(id)) throw new Error("Invalid test id");
    return execFileSync("docker", ["exec", "-i", container!, "psql", "-U", "postgres", "-d", "postgres", "-X", "-At", "-v", "ON_ERROR_STOP=1"], { encoding: "utf8", input: `select count(*) from public.session_attempts where id='${id}' and completed_at is not null;` }).trim();
  }
  /**
   * Samples what the database is doing while a case waits, then stops on
   * cleanup. Repeated samples separate one long-running statement from the same
   * statement being started again: a new transaction start or a query age that
   * keeps resetting means the request is being re-issued, not blocked. Only
   * wait states, ages, blocking PIDs and a fixed RPC classification are output;
   * raw SQL, arguments, auth headers and learner text are never printed.
   */
  function watchDatabaseWaits(stage: string | (() => string), atMs = [5_000, 15_000, 25_000]) {
    const started = Date.now();
    const timers = atMs.map(delay => setTimeout(() => {
      const label = { stage: typeof stage === "function" ? stage() : stage, elapsedMs: Date.now() - started };
      try {
        const activity = execFileSync("docker", ["exec", "-i", container!, "psql", "-U", "postgres", "-d", "postgres", "-X", "-At", "-v", "ON_ERROR_STOP=1"], {
          encoding: "utf8", timeout: 2_000, maxBuffer: 32_768,
          input: `set statement_timeout = '1500ms';
select coalesce(jsonb_agg(to_jsonb(activity)), '[]'::jsonb) from (
  select pid, state, wait_event_type, wait_event,
    pg_blocking_pids(pid) as blocking_pids,
    floor(extract(epoch from clock_timestamp() - query_start)) as active_seconds,
    floor(extract(epoch from clock_timestamp() - xact_start)) as transaction_seconds,
    floor(extract(epoch from clock_timestamp() - backend_start)) as connection_seconds,
    case when position('complete_plan_session_with_route' in query) > 0 then 'completion_rpc'
      when position('save_generated_plan_with_routes' in query) > 0 then 'activation_rpc'
      when position('mint_plan_activation_permit_v1' in query) > 0 then 'activation_permit_rpc'
      else 'other' end as query_class
  from pg_stat_activity
  where pid <> pg_backend_pid() and backend_type = 'client backend'
    and (state = 'active' or state like 'idle in transaction%')
  order by pid
) as activity;`,
        }).trim().split("\n").at(-1);
        console.error("Migrated completion database waits", JSON.stringify(label), activity);
      } catch {
        console.error("Migrated completion database wait diagnostic unavailable within two seconds", JSON.stringify(label));
      }
    }, delay));
    return () => timers.forEach(clearTimeout);
  }
  async function persistSegmentedPlan() {
    const input: NormalPlanEnvelopeInput = {
      now: new Date("2026-09-17T08:00:00Z"),
      learningIntentRecommendation: { intent: "learn", basis: "Use the accepted topic evidence." },
      durationContext: {
        profileVersion: "migrated-test:segments",
        profile: { sustainableMinutes: 60, preferredWindow: null, fatigueRisk: null, startingFrictionRisk: null, evidenceRefs: { sustainableMinutes: [], preferredWindow: [], fatigueRisk: [], startingFrictionRisk: [] } },
        recentOutcomes: [],
        onboardingAnswers: { ...emptyOnboardingAnswers(), answers: { session_length: "minutes_45_60", prove_knowing: "answer_questions" } },
      },
      request: PlanGenerationRequestSchema.parse({
        intent: "plan", learningIntent: "learn", goal: "Memorize the French vocabulary terms and definitions for a recall quiz.",
        materialMode: "none", materials: [], studyMode: "inside", timeZone: "UTC", diagnosticResponses: [], profileSummary: "Use my saved learner profile.",
        availability: [{ day: "Every day", window: "Morning", minutes: 180 }],
        knowledgeMap: {
          version: 1,
          scopeJudgment: { band: "unit_or_exam", label: "French vocabulary", minimumSessions: 2, recommendedSessions: 4, maximumSessions: 8, minimumTeachingSessions: 1, explanation: "Recall the French words and definitions in each group." },
          topics: [1, 2].map(index => ({ id: randomUUID(), title: `French vocabulary group ${index}`, description: "Recall the vocabulary terms and their exact definitions from memory.", subtopics: [`Vocabulary set ${index}`], prerequisiteTopicIds: [], status: "not_started", initialEvidence: { source: "learner_report", outcome: "covered_elsewhere", checked: false }, sourceReferences: [], origin: "ai_generated", deferred: null })),
          placementCheck: { status: "skipped", completedAt: null, demonstratedTopicIds: [], gapTopicIds: [] },
        },
      }),
    };
    const composition = composeNormalPlanEnvelopes(input);
    const draft = buildNormalPlanFromFixedEnvelope({ ...input, methodContext: deltaFixture(2).methodContext, composition, fill: buildNormalPlanFallbackFill({ request: input.request, composition }) });
    const saved = commitPlanStudyRoutes({ ...draft, status: "active" }, input.now.toISOString());
    expect(saved.sessions).toHaveLength(1);
    expect(saved.sessions[0]!.workload?.segments).toHaveLength(2);
    await persistPlanForAuthenticatedUser(saved, input.request, new Date().toISOString());
    // Read the real persisted workload before using it as completion authority.
    const stored = await clients.learner.from("plan_sessions").select("step_data").eq("id", saved.sessions[0]!.id).single();
    expect(stored.error).toBeNull();
    expect(stored.data?.step_data.workload).toEqual(saved.sessions[0]!.workload);
    return saved;
  }
  function segmentedCompletion(saved: LearningPlan): SessionCompletion {
    const session = saved.sessions[0]!;
    const segments = session.workload!.segments!;
    const segmentCompletions = segments.map(segment => ({ segmentId: segment.segmentId, correctAnswers: segment.workload.questionCount, totalAnswers: segment.workload.questionCount, elapsedSeconds: segment.workload.estimatedMinutes * 60 }));
    return {
      id: randomUUID(), planId: saved.id, planSessionId: session.id, routeRevisionId: session.studyRoute!.identity.routeRevisionId,
      startedAt: "2026-09-17T10:00:00.000Z", completedAt: "2026-09-17T11:00:00.000Z", plannedMinutes: session.estimatedMinutes,
      actualMinutes: Math.ceil(segmentCompletions.reduce((sum, segment) => sum + segment.elapsedSeconds, 0) / 60),
      correctAnswers: segmentCompletions.reduce((sum, segment) => sum + segment.correctAnswers, 0), totalAnswers: segmentCompletions.reduce((sum, segment) => sum + segment.totalAnswers, 0),
      feedback: null, observedGap: "Synthetic checked outcomes from both performed segments.", completionMode: "guided", segmentCompletions,
      conceptEvidence: segments.map(segment => ({ routeRevisionId: session.studyRoute!.identity.routeRevisionId, topicId: segment.workload.topicSubtopics[0]!.topicId, concept: `${segment.segmentId} vocabulary recall`, outcome: "secure", activityType: "multiple_choice" })),
      confidenceEvidence: [],
    };
  }
  function completionPayload(event: SessionCompletion): Record<string, unknown> {
    return {
      attemptId: event.id, planSessionId: event.planSessionId, routeRevisionId: event.routeRevisionId,
      startedAt: event.startedAt, completedAt: event.completedAt, plannedMinutes: event.plannedMinutes, actualMinutes: event.actualMinutes,
      correctAnswers: event.correctAnswers, totalAnswers: event.totalAnswers, feedback: event.feedback, observedGap: event.observedGap,
      completionMode: event.completionMode, conceptEvidence: event.conceptEvidence, confidenceEvidence: event.confidenceEvidence,
      segmentCompletions: event.segmentCompletions,
      completionVariant: "guided", nextSessionAdjustment: null, nextSessionStudyRoute: null, followUpSession: null, continuationSession: null,
    };
  }
  beforeAll(async () => {
    vi.stubGlobal("window", { localStorage: storage });
    clients.admin = createClient(url!, secretKey!, { auth: { persistSession: false } });
    const email = `baseline-finish-${randomUUID()}@example.com`;
    const password = `${randomUUID()}Aa1!`;
    const created = await clients.admin.auth.admin.createUser({ email, password, email_confirm: true });
    expect(created.error).toBeNull(); userId = created.data.user!.id;
    clients.learner = createClient(url!, publicKey!, { auth: { persistSession: false }, global: { fetch: async (input, init) => {
      if (offline) throw new TypeError("Test transport offline");
      const isFinish = String(input).includes("/rpc/complete_plan_session");
      if (isFinish) writes += 1;
      // Which side of the wire a stalled completion is waiting on. Status and
      // attempt number only: never headers, credentials, payloads or rows.
      if (isFinish && tracingTransport) console.info("Migrated completion transport", JSON.stringify({ event: "request", attempt: writes, elapsedMs: Date.now() - tracingTransport }));
      const response = await fetch(input, init);
      if (isFinish && tracingTransport) console.info("Migrated completion transport", JSON.stringify({ event: "response", attempt: writes, status: response.status, elapsedMs: Date.now() - tracingTransport }));
      if (inspectingReload && !response.ok) {
        const path = new URL(input instanceof Request ? input.url : String(input)).pathname;
        if (path.startsWith("/rest/v1/")) {
          // Only the synthetic fixture's failed PostgREST error is recorded.
          // Never log request headers, credentials, query values, or row data.
          const body: unknown = await response.clone().json().catch(() => null);
          const error = body && typeof body === "object" ? body as Record<string, unknown> : {};
          const diagnostic = { path, status: response.status,
            code: typeof error.code === "string" ? error.code.slice(0, 120) : null,
            message: typeof error.message === "string" ? error.message.slice(0, 800) : null };
          reloadFailures.push(diagnostic);
          console.error("Migrated completion reload PostgREST failure", JSON.stringify(diagnostic));
        }
      }
      if (isFinish && dropReply && response.ok) {
        dropReply = false;
        // The real server has committed. Only the reply is delayed beyond the
        // browser deadline; no success/failure payload is fabricated.
        await new Promise(resolve => setTimeout(resolve, 13_000));
      }
      return response;
    } } });
    expect((await clients.learner.auth.signInWithPassword({ email, password })).error).toBeNull();
    await persistPlanForAuthenticatedUser(plan, fixture.request, new Date().toISOString());
  }, 30_000);
  afterAll(() => vi.unstubAllGlobals());

  it("coalesces double Finish, reconciles a committed reply after the deadline, and reloads one completed session", async () => {
    dropReply = true;
    const event = completion(0);
    const first = syncBaselineCompletion(userId, event);
    const second = syncBaselineCompletion(userId, { ...event, completedAt: "2026-09-17T10:11:00.000Z" });
    expect(first).toBe(second);
    const result = await first;
    expect(result.committed).toBe(true);
    expect(rows(event.id)).toBe("1");
    expect(writes).toBe(1);
    expect(loadQueuedSessionCompletions(userId)).toHaveLength(0);
    reloadFailures.length = 0;
    inspectingReload = true;
    try {
      const reloaded = await loadAuthenticatedLearningState();
      expect(reloaded?.plans.find(item => item.id === plan.id)?.sessions.find(item => item.id === event.planSessionId)?.status).toBe("complete");
    } catch (error) {
      throw new Error(`Migrated completion reload failed. PostgREST diagnostics: ${JSON.stringify(reloadFailures)}`, { cause: error });
    } finally {
      inspectingReload = false;
    }
  }, 35_000);

  it("accepts omitted and JSON null segment receipts on exact legacy completion retries", async () => {
    const event = completion(0);
    const before = await clients.learner.from("session_attempts").select("result_data").eq("id", event.id).single();
    expect(before.error).toBeNull();
    expect(before.data?.result_data).not.toHaveProperty("segmentCompletions");
    for (const segmentCompletions of [null, undefined]) {
      const replay = await clients.learner.rpc("complete_plan_session_with_route", { payload: { ...completionPayload(event), segmentCompletions } });
      expect(replay.error).toBeNull();
      expect(rows(event.id)).toBe("1");
    }
    const after = await clients.learner.from("session_attempts").select("result_data").eq("id", event.id).single();
    expect(after.error).toBeNull();
    expect(after.data?.result_data).toEqual(before.data?.result_data);
  }, 30_000);

  it("keeps the exact queued event across a reload-style retry and reconnect", async () => {
    const event = completion(1);
    offline = true;
    expect((await syncBaselineCompletion(userId, event)).committed).toBe(false);
    expect(loadQueuedSessionCompletions(userId)[0]?.completion).toEqual(event);
    expect(loadQueuedSessionCompletions(randomUUID())).toHaveLength(0);
    offline = false;
    const result = await syncBaselineCompletion(userId, { ...event, completedAt: "2026-09-17T10:15:00.000Z" });
    expect(result.committed).toBe(true);
    expect(result.completion.completedAt).toBe(event.completedAt);
    expect(rows(event.id)).toBe("1");
    expect(await readAuthenticatedSessionCompletionReceipt(userId, event)).toBe(true);
  }, 30_000);

  it("does not credit a confirmed rejection or another account", async () => {
    const invalid = { ...completion(2), id: randomUUID(), planSessionId: randomUUID() };
    const result = await syncBaselineCompletion(userId, invalid);
    expect(result.committed).toBe(false);
    expect(rows(invalid.id)).toBe("0");
    expect(await readAuthenticatedSessionCompletionReceipt(randomUUID(), completion(0))).toBe(false);
  }, 30_000);

  it("hydrates each segment from its own persisted topic slice and refuses missing or foreign selectors", async () => {
    const saved = await persistSegmentedPlan();
    const session = saved.sessions[0]!;
    const segments = session.workload!.segments!;
    const requestFor = (index: number) => {
      const segment = segments[index]!;
      return ShapeSlotRequestSchema.parse({
        action: "practice", requestId: randomUUID(), recoveryKey: randomUUID(), planId: saved.id, planSessionId: session.id, segmentId: segment.segmentId,
        topic: { id: segment.workload.topicSubtopics[0]!.topicId, title: "Forged browser title", description: "A browser request cannot choose the scope.", subtopics: ["Invented subject", ...segments.flatMap(item => item.workload.topicSubtopics[0]!.subtopics)], taskType: "conceptual_learning", relatedTopics: saved.knowledgeMap!.topics.map(topic => ({ id: topic.id, title: topic.title, subtopics: topic.subtopics })) },
        modifiers: { instructionStyle: "standard", questionMix: { recall: 1, application: 2, compare_contrast: 1, prediction: 0, misconception: 1 }, produceStep: null, explanationFocus: null, questionCap: 1, questionTarget: 1 },
        tips: [], round: 1, attempt: randomUUID(), keyPoints: [], outstandingKeyPointIds: [], excerpts: [{ label: "Forged source", text: "Never trust posted source text." }], roundKind: "active_recall", repairTargets: [],
      });
    };
    for (const [index, segment] of segments.entries()) {
      const hydrated = await hydrateShapeSlotContext(clients.learner, userId, requestFor(index));
      const topicId = segment.workload.topicSubtopics[0]!.topicId;
      expect(hydrated.topic.id).toBe(topicId);
      expect(hydrated.topic.title).toBe(saved.knowledgeMap!.topics.find(topic => topic.id === topicId)!.title);
      expect(hydrated.topic.subtopics).toEqual(segment.workload.topicSubtopics[0]!.subtopics);
      expect(hydrated.topic.taskType).toBe(segment.taskType);
      expect(hydrated.topic.relatedTopics ?? []).toEqual([]);
      expect(hydrated.modifiers.questionTarget).toBe(segment.workload.questionCount);
      expect(hydrated.modifiers.questionCap).toBe(segment.workload.questionCount);
      expect(hydrated.action === "practice" && hydrated.excerpts).toEqual([]);
    }
    const request = requestFor(0);
    await expect(hydrateShapeSlotContext(clients.learner, userId, { ...request, segmentId: undefined })).rejects.toThrow(/segment/i);
    await expect(hydrateShapeSlotContext(clients.learner, userId, { ...request, segmentId: "unknown-segment" })).rejects.toThrow(/segment/i);
    await expect(hydrateShapeSlotContext(clients.learner, userId, { ...request, segmentId: segments[1]!.segmentId })).rejects.toThrow(/topic/i);
  }, 30_000);

  it("rejects incomplete or forged segment receipts in the real completion RPC without crediting the second topic", async () => {
    const saved = await persistSegmentedPlan();
    const event = segmentedCompletion(saved);
    const receipts = event.segmentCompletions!;
    const invalid: Array<[string, Record<string, unknown>]> = [
      ["missing receipt", { segmentCompletions: undefined }],
      ["JSON null receipt", { segmentCompletions: null }],
      ["receipt object instead of array", { segmentCompletions: { ...receipts[0] } }],
      ["unperformed second segment", { segmentCompletions: [receipts[0]], correctAnswers: receipts[0]!.correctAnswers, totalAnswers: receipts[0]!.totalAnswers, conceptEvidence: [event.conceptEvidence[0]] }],
      ["duplicate segment", { segmentCompletions: [receipts[0], receipts[0]] }],
      ["unknown segment", { segmentCompletions: [receipts[0], { ...receipts[1], segmentId: "unknown-segment" }] }],
      ["reversed order", { segmentCompletions: [...receipts].reverse() }],
      ["parent counts disagree", { correctAnswers: event.correctAnswers - 1, totalAnswers: event.totalAnswers - 1 }],
      ["string answer count", { segmentCompletions: [receipts[0], { ...receipts[1], totalAnswers: String(receipts[1]!.totalAnswers) }] }],
      ["second segment underfilled", { segmentCompletions: [receipts[0], { ...receipts[1], correctAnswers: 0, totalAnswers: 0 }], correctAnswers: receipts[0]!.correctAnswers, totalAnswers: receipts[0]!.totalAnswers }],
      ["foreign evidence topic", { conceptEvidence: [event.conceptEvidence[0], { ...event.conceptEvidence[1], topicId: randomUUID() }] }],
      ["missing second topic outcome", { conceptEvidence: [event.conceptEvidence[0]] }],
    ];
    for (const [label, patch] of invalid) {
      const id = randomUUID();
      const result = await clients.learner.rpc("complete_plan_session_with_route", { payload: { ...completionPayload(event), attemptId: id, ...patch } });
      expect(result.error, label).not.toBeNull();
      expect(result.error?.code, label).toBe("22023");
      expect(result.error?.message, label).toMatch(/^topic_segment_completion_/);
      expect(rows(id), label).toBe("0");
      const attempts = await clients.learner.from("session_attempts").select("id").eq("id", id);
      expect(attempts.error).toBeNull();
      expect(attempts.data, label).toEqual([]);
      const status = await clients.learner.from("plan_sessions").select("status").eq("id", event.planSessionId).single();
      expect(status.error).toBeNull();
      expect(status.data?.status, label).not.toBe("complete");
    }
  }, 30_000);

  // Whether one completion conflict comes back at all, independently of the
  // segmented case below: a fresh attempt on an already completed session is
  // the earliest 40001 the locked writer raises. If this returns while the
  // changed-receipt replay stalls, the stall belongs to that replay path; if
  // both stall, every 40001 from this RPC is left open.
  it("answers a completion conflict instead of leaving the request open", async () => {
    const saved = await persistSegmentedPlan();
    const event = segmentedCompletion(saved);
    await completeAuthenticatedPlanSession(event, undefined, undefined, undefined, undefined, userId);
    expect(rows(event.id)).toBe("1");
    const samples = watchDatabaseWaits("completion conflict answer");
    try {
      tracingTransport = Date.now();
      const conflict = await clients.learner.rpc("complete_plan_session_with_route", { payload: { ...completionPayload(event), attemptId: randomUUID() } });
      // 20260917190001: a permanent refusal answers as PT409 (HTTP 409) rather
      // than 40001, which the stack in front retried until nothing came back.
      expect(conflict.error?.code).toBe("PT409");
      expect(conflict.error?.message).toBe("study_route_completion_session_not_ready");
    } finally {
      tracingTransport = 0;
      samples();
    }
  }, 30_000);

  it("persists both checked origins once and reloads the exact segment receipts after a terminal retry", async () => {
    const started = Date.now();
    let currentStage = "not started";
    async function stage<T>(name: string, operation: () => T | Promise<T>): Promise<T> {
      currentStage = name;
      console.info("Migrated segment completion stage", JSON.stringify({ stage: name, state: "started", elapsedMs: Date.now() - started }));
      const result = await operation();
      console.info("Migrated segment completion stage", JSON.stringify({ stage: name, state: "finished", elapsedMs: Date.now() - started }));
      return result;
    }
    const samples = watchDatabaseWaits(() => currentStage);
    tracingTransport = started;
    try {
      const saved = await stage("activate fresh segmented plan", persistSegmentedPlan);
      const event = segmentedCompletion(saved);
      await stage("first completion write", () => completeAuthenticatedPlanSession(event, undefined, undefined, undefined, undefined, userId));
      await stage("exact completion retry", () => completeAuthenticatedPlanSession(event, undefined, undefined, undefined, undefined, userId));
      expect(await stage("count durable attempt", () => rows(event.id))).toBe("1");
      expect(await stage("read authenticated receipt", () => readAuthenticatedSessionCompletionReceipt(userId, event))).toBe(true);
      const reloaded = await stage("reload authenticated learning state", loadAuthenticatedLearningState);
      const attempts = reloaded!.sessionCompletions.filter(item => item.id === event.id);
      expect(attempts).toHaveLength(1);
      expect(attempts[0]!.segmentCompletions).toEqual(event.segmentCompletions);
      expect(attempts[0]!.conceptEvidence).toEqual(event.conceptEvidence);
      expect(attempts[0]!.correctAnswers).toBe(event.correctAnswers);
      expect(attempts[0]!.totalAnswers).toBe(event.totalAnswers);
      expect(reloaded!.plans.find(item => item.id === saved.id)!.sessions[0]!.status).toBe("complete");
      const persisted = await stage("read stored segment receipt", async () => await clients.learner.from("session_attempts").select("result_data").eq("id", event.id).single());
      expect(persisted.error).toBeNull();
      expect(persisted.data?.result_data.segmentCompletions).toEqual(event.segmentCompletions);
      expect(persisted.data?.result_data.conceptEvidence).toEqual(event.conceptEvidence);
      const changedReplay = await stage("reject changed receipt retry", async () => await clients.learner.rpc("complete_plan_session_with_route", { payload: { ...completionPayload(event), segmentCompletions: event.segmentCompletions!.map((segment, index) => index === 0 ? { ...segment, elapsedSeconds: segment.elapsedSeconds + 1 } : segment) } }));
      expect(changedReplay.error).not.toBeNull();
      expect(changedReplay.error?.code).toBe("PT409");
      expect(changedReplay.error?.message).toBe("study_route_completion_retry_conflict");
      expect(await stage("count attempt after rejected retry", () => rows(event.id))).toBe("1");
      const afterRejectedReplay = await stage("read unchanged receipt after rejection", async () => await clients.learner.from("session_attempts").select("result_data").eq("id", event.id).single());
      expect(afterRejectedReplay.error).toBeNull();
      expect(afterRejectedReplay.data?.result_data).toEqual(persisted.data?.result_data);
    } finally {
      tracingTransport = 0;
      samples();
    }
  }, 30_000);
});
