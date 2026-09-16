import { beforeAll, describe, expect, it, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
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
const configured = Boolean(url && publishableKey && secretKey);

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

  it("stores an empty reviewed-edit list for sessions the learner never edited", async () => {
    const stored = await clients.admin.from("plan_sessions").select("id,step_data").eq("plan_id", planId);
    expect(stored.error, `could not read the saved sessions: ${stored.error?.message}`).toBeNull();
    expect(stored.data!.length).toBeGreaterThan(0);
    for (const row of stored.data!) {
      expect((row.step_data as Record<string, unknown>).revisionEditedFields).toEqual([]);
    }
  });

  it("returns a preview instead of the 503 every plan saved after 202609090001 used to get", async () => {
    const { status, body } = await preview();
    expect(body.error ?? null, `the route refused the preview: ${body.error}`).toBeNull();
    expect(status).toBe(200);
    expect(body.status).toBe("preview");
    expect(body.proposal?.lines?.length ?? 0).toBeGreaterThan(0);
  });

  it("still previews a plan whose sessions were stored before the fix", async () => {
    const stored = await clients.admin.from("plan_sessions").select("id,step_data").eq("plan_id", planId).limit(1);
    const row = stored.data![0]!;
    const legacy = await clients.admin.from("plan_sessions")
      .update({ step_data: { ...(row.step_data as Record<string, unknown>), revisionEditedFields: null } })
      .eq("id", row.id);
    expect(legacy.error, `could not restore the pre-fix shape: ${legacy.error?.message}`).toBeNull();

    const { status, body } = await preview();
    expect(body.error ?? null, `a stored null edit list still breaks the preview: ${body.error}`).toBeNull();
    expect(status).toBe(200);
    expect(body.status).toBe("preview");
  });
});
