import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { DELTA_NOW, deltaFixture, deterministicDeltaPlan } from "@/evals/personalization-delta-fixture";
import type { SessionCompletion } from "@/lib/domain";

vi.mock("server-only", () => ({}));
const clients = vi.hoisted(() => ({ learner: null as unknown as SupabaseClient, admin: null as unknown as SupabaseClient }));
vi.mock("@/lib/supabase/client", () => ({ createSupabaseBrowserClient: () => clients.learner }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => clients.learner }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => clients.admin }));
vi.mock("@/lib/supabase/config", async original => ({ ...await original<object>(), isSupabaseConfigured: () => true }));
import { commitPlanStudyRoutes } from "@/lib/study-route/activation";
import { persistPlanForAuthenticatedUser } from "@/lib/supabase/plan-repository";
import { loadAuthenticatedLearningState, readAuthenticatedSessionCompletionReceipt } from "@/lib/supabase/learning-state-repository";
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
  let writes = 0;
  let inspectingReload = false;
  const reloadFailures: Array<{ path: string; status: number; code: string | null; message: string | null }> = [];
  const uuidMap = new Map<string, string>();
  const fresh = <T,>(value: T): T => JSON.parse(JSON.stringify(value).replace(/[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}/gi, id => {
    if (!uuidMap.has(id)) uuidMap.set(id, randomUUID());
    return uuidMap.get(id)!;
  }));
  const fixture = fresh({ request: deltaFixture(2).request, plan: deterministicDeltaPlan(2) });
  const plan = commitPlanStudyRoutes({ ...fixture.plan, status: "active" }, DELTA_NOW.toISOString());
  const completion = (index: number): SessionCompletion => {
    const session = plan.sessions[index]!;
    return { id: session.id, planId: plan.id, planSessionId: session.id, routeRevisionId: session.studyRoute!.identity.routeRevisionId,
      startedAt: "2026-09-17T10:00:00.000Z", completedAt: "2026-09-17T10:10:00.000Z", plannedMinutes: session.estimatedMinutes,
      actualMinutes: 10, correctAnswers: 2, totalAnswers: 2, feedback: null, observedGap: "No remaining gap identified.", completionMode: "guided", conceptEvidence: [], confidenceEvidence: [] };
  };
  function rows(id: string) {
    if (!/^[a-f\d-]{36}$/i.test(id)) throw new Error("Invalid test id");
    return execFileSync("docker", ["exec", "-i", container!, "psql", "-U", "postgres", "-d", "postgres", "-X", "-At", "-v", "ON_ERROR_STOP=1"], { encoding: "utf8", input: `select count(*) from public.session_attempts where id='${id}' and completed_at is not null;` }).trim();
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
      const response = await fetch(input, init);
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
});
