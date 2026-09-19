import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { DELTA_NOW, deltaFixture, deltaTopicId, deterministicDeltaPlan } from "@/evals/personalization-delta-fixture";

vi.mock("server-only", () => ({}));
const clients = vi.hoisted(() => ({ learner: null as unknown as SupabaseClient, admin: null as unknown as SupabaseClient }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => clients.learner }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => clients.admin }));
vi.mock("@/lib/supabase/config", async importOriginal => ({
  ...await importOriginal<object>(), isSupabaseConfigured: () => true,
}));
vi.mock("@/lib/server/development-preview", () => ({ isDevelopmentPreviewRequest: () => false }));

import { commitPlanStudyRoutes } from "@/lib/study-route/activation";
import { persistPlanForAuthenticatedUser } from "@/lib/supabase/plan-repository";
import { loadActiveRevisionContext } from "@/lib/plan-revision/active-context";
import type { LearningPlan, LearningPlanSession } from "@/lib/domain";
import { PATCH } from "@/app/api/plans/adjust/route";

// Supplied by CI while the migrated Supabase stack is running. The browser
// journey runs the development-preview path, which never reads the database,
// so this is the only test that sends a real preview request through the route
// against a database built by replaying every migration.
const url = process.env.YOVA_MIGRATED_SUPABASE_URL;
const publishableKey = process.env.YOVA_MIGRATED_SUPABASE_PUBLISHABLE_KEY;
const secretKey = process.env.YOVA_MIGRATED_SUPABASE_SECRET_KEY;
const databaseContainer = process.env.YOVA_MIGRATED_DB_CONTAINER;
const configured = Boolean(url && publishableKey && secretKey && databaseContainer);

// The service role is deliberately denied plan_sessions, so raw rows are read,
// and the pre-fix shape is written, as the database owner - the way the pgTAP
// suites do. The route itself only ever sees the signed-in learner's client.
function ownerSql(sql: string) {
  return execFileSync("docker", ["exec", "-i", databaseContainer!, "psql", "-U", "postgres", "-d", "postgres", "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1"], { input: sql, encoding: "utf8" }).trim();
}
function uuid(value: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)) throw new Error(`not a uuid: ${value}`);
  return value;
}

// CI sets this so a missing database fails the run instead of skipping silently.
describe.runIf(process.env.YOVA_REQUIRE_MIGRATED_ROUTE_TEST)("migrated-database route coverage", () => {
  it("has a migrated database to run against", () => {
    expect(configured).toBe(true);
  });
});

describe.skipIf(!configured)("plan adjustment route against a migrated database", () => {
  const fixture = deltaFixture(1);
  let plan: LearningPlan;
  let planId: string;

  async function send(body: unknown) {
    const response = await PATCH(new Request("https://yova.test/api/plans/adjust", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
    return { status: response.status, body: await response.json() };
  }

  async function preview() {
    const response = await PATCH(new Request("https://yova.test/api/plans/adjust", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "preview",
        context: { kind: "active", planId, expectedRevisionId: plan.revisionId ?? plan.id },
        delta: { operations: [{ op: "mark_covered", topic_id: deltaTopicId(4) }] },
        controls: { excludedOperationIndexes: [], sessionEdits: [] },
        fixedEvents: [],
      }),
    }));
    return { status: response.status, body: await response.json() };
  }

  beforeEach(async () => {
    // Each case activates a fresh plan for a fresh learner. In particular, the
    // legacy-null case must not remove [] from the later Undo fixture.
    plan = commitPlanStudyRoutes({ ...deterministicDeltaPlan(1), status: "active" }, DELTA_NOW.toISOString());
    // Keep room to revise this unstarted plan without freezing the real auth
    // and database clocks or eventually failing on the fixture's old deadline.
    fixture.request.deadline = new Date(Date.now() + 30 * 86_400_000).toISOString();
    plan.deadline = fixture.request.deadline;
    vi.stubEnv("YOVA_DRAFT_RECEIPT_SECRET", "migrated-route-test-secret-01234567890123456789");
    clients.admin = createClient(url!, secretKey!, { auth: { persistSession: false } });
    const email = `migrated-route-${randomUUID()}@example.com`;
    const password = `${randomUUID()}Aa1!`;
    const created = await clients.admin.auth.admin.createUser({ email, password, email_confirm: true });
    expect(created.error, `could not create the test learner: ${created.error?.message}`).toBeNull();

    clients.learner = createClient(url!, publishableKey!, { auth: { persistSession: false } });
    const signedIn = await clients.learner.auth.signInWithPassword({ email, password });
    expect(signedIn.error, `could not sign the test learner in: ${signedIn.error?.message}`).toBeNull();

    planId = plan.id;
    // The real activation writer, the same call the activate route makes.
    await expect(persistPlanForAuthenticatedUser(plan, fixture.request, new Date().toISOString())).resolves.toBe("supabase");
  });

  async function applyFreshChangeWithEmptyEditList() {
    const before = await loadActiveRevisionContext(clients.learner, planId);
    expect(before.plan.sessions.every(session => Array.isArray(session.revisionEditedFields) && session.revisionEditedFields.length === 0)).toBe(true);
    const previewed = await preview();
    expect(previewed.body.error ?? null, `preview refused: ${previewed.body.error}`).toBeNull();
    expect(previewed.body.proposal.canApply, previewed.body.proposal.capacity.explanation).toBe(true);
    const rebuilt = (previewed.body.proposal.after.sessions as LearningPlanSession[]).find(session =>
      !Object.hasOwn(session, "revisionEditedFields")
      && before.plan.sessions.some(previous => previous.id === session.id && previous.revisionEditedFields?.length === 0));
    expect(rebuilt, "the changed session must omit its empty list in the actual proposal").toBeDefined();
    const changedId = rebuilt!.id;
    const storedEdits = () => ownerSql(`select step_data->'revisionEditedFields' from public.plan_sessions where id='${uuid(changedId)}';`);
    expect(storedEdits(), "the actual changed row carries [] before apply").toBe("[]");
    const applied = await send({ action: "apply", proposal: previewed.body.proposal, proposalReceipt: previewed.body.proposalReceipt });
    expect(applied.body.error ?? null, `apply refused: ${applied.body.error}`).toBeNull();
    expect(applied.status).toBe(200);
    expect(applied.body.changedSessionIds).toContain(changedId);
    expect(storedEdits(), "the real revision writer preserves [] on this changed row").toBe("[]");
    expect(ownerSql(`select session ? 'revisionEditedFields' from public.plan_revisions revision, jsonb_array_elements(revision.proposal#>'{after,sessions}') session where revision.id='${uuid(previewed.body.proposal.revisionId)}' and session->>'id'='${uuid(changedId)}';`), "the persisted proposal omits the field that the live row stores as []").toBe("f");
    return { before, previewed, applied, changedId };
  }

  it("stores an empty reviewed-edit list for sessions the learner never edited", () => {
    const stored = ownerSql(`select coalesce((step_data->'revisionEditedFields')::text, '<absent>') from public.plan_sessions where plan_id = '${uuid(planId)}' order by sequence;`).split("\n");
    expect(stored.length).toBe(plan.sessions.length);
    expect(stored.every(value => value === "[]"), `stored edit lists: ${stored.join(", ")}`).toBe(true);
  });

  it("returns a preview instead of the 503 every plan saved after 202609090001 used to get", async () => {
    const { status, body } = await preview();
    expect(body.error ?? null, `the route refused the preview: ${body.error}`).toBeNull();
    expect(status).toBe(200);
    expect(body.status).toBe("preview");
    expect(body.proposal?.lines?.length ?? 0).toBeGreaterThan(0);
  });

  it("still previews a plan whose sessions were stored before the fix", async () => {
    const rewritten = ownerSql(`update public.plan_sessions set step_data = jsonb_set(step_data, '{revisionEditedFields}', 'null'::jsonb) where plan_id = '${uuid(planId)}' returning id;`);
    expect(rewritten.split("\n").filter(Boolean)).toHaveLength(plan.sessions.length);
    expect(ownerSql(`select count(*) from public.plan_sessions where plan_id = '${uuid(planId)}' and step_data->'revisionEditedFields' = 'null'::jsonb;`)).toBe(String(plan.sessions.length));

    const { status, body } = await preview();
    expect(body.error ?? null, `a stored null edit list still breaks the preview: ${body.error}`).toBeNull();
    expect(status).toBe(200);
    expect(body.status).toBe("preview");
  });

  // Exercise both #94's timestamp normalization and the fresh-row []/omitted
  // mismatch through real activation, revision, history and reload RPCs.
  it("saves a change with a real empty edit list, undoes it, and reloads the restored session", async () => {
    const { before, previewed, applied, changedId } = await applyFreshChangeWithEmptyEditList();
    const stored = ownerSql(`select to_json(scheduled_for)::text from public.plan_sessions where plan_id = '${uuid(planId)}' order by sequence limit 1;`);
    expect(stored, "the database writes session times with an explicit offset").toMatch(/\+00:00"$/);
    const covered = applied.body.plan.knowledgeMap.topics.find((topic: { id: string }) => topic.id === deltaTopicId(4));
    expect(covered.initialEvidence?.source).toBe("learner_report");

    const undone = await send({ action: "undo", planId, expectedRevisionId: previewed.body.proposal.revisionId });
    expect(undone.body.error ?? null, `undo refused: ${undone.body.error}`).toBeNull();
    expect(undone.status).toBe(200);
    expect(undone.body.receipt.message).toMatch(/Previous revision restored/);
    const restored = undone.body.plan.knowledgeMap.topics.find((topic: { id: string }) => topic.id === deltaTopicId(4));
    expect(restored.initialEvidence ?? null).toBeNull();
    const reloaded = await loadActiveRevisionContext(clients.learner, planId);
    expect(reloaded.plan.revisionId).toBe(before.plan.revisionId);
    expect(reloaded.plan.knowledgeMap).toEqual(before.plan.knowledgeMap);
    const previousSession = before.plan.sessions.find(session => session.id === changedId)!;
    const restoredSession = reloaded.plan.sessions.find(session => session.id === changedId)!;
    expect(restoredSession).toMatchObject({ title: previousSession.title, objective: previousSession.objective,
      method: previousSession.method, estimatedMinutes: previousSession.estimatedMinutes, revisionEditedFields: [] });
    expect(Date.parse(restoredSession.scheduledFor)).toBe(Date.parse(previousSession.scheduledFor));
  });

  // Brief 2.5 finding 16: Undo hung for over a minute, then the plan was not
  // restored after a reload. A refusal only the database can see - here the
  // session changes after the route's own check and before the writer runs -
  // was raised as SQLSTATE 40001 and retried in front of the database until
  // nothing came back. 20260919100001 answers it as PT409 (HTTP 409).
  it("answers a refusal only the database can see instead of hanging Undo", async () => {
    const { previewed, changedId } = await applyFreshChangeWithEmptyEditList();
    const beforeRefusal = await loadActiveRevisionContext(clients.learner, planId);
    const rpc = clients.admin.rpc.bind(clients.admin);
    const spied = vi.spyOn(clients.admin, "rpc").mockImplementation(((name: string, args?: object) => {
      if (name === "apply_plan_revision") ownerSql(`update public.plan_sessions set title = title || ' (changed on another device)' where id='${uuid(changedId)}';`);
      return rpc(name, args);
    }) as typeof clients.admin.rpc);
    const started = Date.now();
    const undone = await send({ action: "undo", planId, expectedRevisionId: previewed.body.proposal.revisionId });
    spied.mockRestore();
    expect(Date.now() - started, "a refused Undo must answer, not wait on a retried serialization failure").toBeLessThan(20_000);
    expect(undone.status).toBe(409);
    expect(ownerSql(`select count(*) from public.plan_revisions where plan_id='${uuid(planId)}';`), "nothing was half-saved").toBe("1");
    const afterRefusal = await loadActiveRevisionContext(clients.learner, planId);
    expect(afterRefusal.plan.revisionId).toBe(beforeRefusal.plan.revisionId);
  }, 60_000);

  it("still refuses Undo when the stored reviewed-edit list genuinely changed", async () => {
    const { previewed, changedId } = await applyFreshChangeWithEmptyEditList();
    ownerSql(`update public.plan_sessions set step_data=jsonb_set(step_data,'{revisionEditedFields}','["title"]'::jsonb) where id='${uuid(changedId)}';`);
    const beforeRefusal = await loadActiveRevisionContext(clients.learner, planId);
    expect(beforeRefusal.plan.sessions.find(session => session.id === changedId)?.revisionEditedFields).toEqual(["title"]);
    const undone = await send({ action: "undo", planId, expectedRevisionId: previewed.body.proposal.revisionId });
    expect(undone.status).toBe(409);
    expect(undone.body.error).toContain("A changed session no longer matches this preview");
    const afterRefusal = await loadActiveRevisionContext(clients.learner, planId);
    expect(afterRefusal.plan).toEqual(beforeRefusal.plan);
    expect(ownerSql(`select count(*) from public.plan_revisions where plan_id='${uuid(planId)}';`)).toBe("1");
  });
});
