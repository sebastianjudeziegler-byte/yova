import { beforeAll, describe, expect, it, vi } from "vitest";
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
  const plan = commitPlanStudyRoutes({ ...deterministicDeltaPlan(1), status: "active" as const }, DELTA_NOW.toISOString());
  let planId: string;

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

  beforeAll(async () => {
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

  // Production, 17 Sept 2026: a saved change applied, then Undo failed with "A changed session no
  // longer matches this preview". The database returns session times as +00:00; the change stored
  // them as .000Z, and the preimage check compared the two as text.
  it("saves a change and then undoes it", async () => {
    async function send(body: unknown) {
      const response = await PATCH(new Request("https://yova.test/api/plans/adjust", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
      return { status: response.status, body: await response.json() };
    }
    const previewed = await preview();
    expect(previewed.body.error ?? null, `preview refused: ${previewed.body.error}`).toBeNull();
    const stored = ownerSql(`select to_json(scheduled_for)::text from public.plan_sessions where plan_id = '${uuid(planId)}' order by sequence limit 1;`);
    expect(stored, "the database writes session times with an explicit offset").toMatch(/\+00:00"$/);

    const applied = await send({ action: "apply", proposal: previewed.body.proposal, proposalReceipt: previewed.body.proposalReceipt });
    expect(applied.body.error ?? null, `apply refused: ${applied.body.error}`).toBeNull();
    expect(applied.status).toBe(200);
    const covered = applied.body.plan.knowledgeMap.topics.find((topic: { id: string }) => topic.id === deltaTopicId(4));
    expect(covered.initialEvidence?.source).toBe("learner_report");

    const undone = await send({ action: "undo", planId, expectedRevisionId: previewed.body.proposal.revisionId });
    expect(undone.body.error ?? null, `undo refused: ${undone.body.error}`).toBeNull();
    expect(undone.status).toBe(200);
    expect(undone.body.receipt.message).toMatch(/Previous revision restored/);
    const restored = undone.body.plan.knowledgeMap.topics.find((topic: { id: string }) => topic.id === deltaTopicId(4));
    expect(restored.initialEvidence ?? null).toBeNull();
  });
});

