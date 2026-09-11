# Brief 2 — Evidence

## PRECONDITION: plan revision diagnosis

**Status: root cause found. Not a code regression — Brief B's database
migration was never applied to the production Supabase project.**

The founder's report is accurate: revision does not work at all in the
deployed app, and it has never worked there. Brief B's green browser journey
proves a code path that no production learner can reach.

### Finding 1 — the production database is missing Brief B's migration

`supabase/migrations/202609090001_living_plan_revisions.sql` creates four
functions, one table and one column. Probed the production project directly
(read-only PostgREST calls, publishable key, correct named parameters):

| Object | Production result |
|---|---|
| `read_plan_revision_context(target_plan_id)` | **404 PGRST202 — absent** |
| `apply_plan_revision(actor_user_id, payload)` | **404 PGRST202 — absent** |
| `plan_revision_session_fingerprint(s)` | **404 PGRST202 — absent** |
| `initialize_plan_revision_id()` | **404 PGRST202 — absent** |
| `signed_in_generation_readiness_v4()` *(control, earlier migration)* | 401 `42501` permission denied — **present** |

The control matters: a function that exists but is not granted to `anon`
answers `42501`, not `404`. The four Brief B functions answer `404`, so they
are genuinely not in the schema — not merely ungranted.

The probed project is the one production serves: `www.yovaapp.com` ships
`https://sbntgjvrvazcnlppnbzs.supabase.co` in its client chunks, which is the
project probed above. The same migration also adds
`plans.current_revision_id` and the `plan_revisions` table, so those are
absent too.

### Finding 2 — what a learner hits, step by step

1. In production `isDevelopmentPreviewRequest` is `false` (it requires
   `NODE_ENV === "development"`), so `previewClientPlanRevision`
   ([revision-client.ts:48](src/components/plan-revision/revision-client.ts:48))
   builds context `{ kind: "active" }`.
2. `previewPlanRevision`
   ([preview-service.ts:33](src/lib/plan-revision/preview-service.ts:33))
   calls `loadActiveRevisionContext`.
3. That calls the missing RPC
   ([active-context.ts:19](src/lib/plan-revision/active-context.ts:19)) and
   throws a plain `Error` at line 20.
4. The route's generic catch
   ([route.ts:45](src/app/api/plans/adjust/route.ts:45)) returns **503
   "YOVA could not prepare that change. Your plan has not changed."**

The learner fails at *preview* — they never reach a confirmable change. The
message does render (`role="alert"`,
[plan-revision-preview.tsx:162](src/components/plan-revision/plan-revision-preview.tsx:162)),
so the UI is honest. "Even though it says it does" refers to the shipped
status and the green CI, not to a false success banner.

### Finding 3 — why every test stayed green

The brief asked which of two explanations holds. It is the first: **the tests
pass on a path users do not take.**

- `playwright.config.ts` runs the journey under `pnpm dev` (`next dev`) with
  `NEXT_PUBLIC_SUPABASE_URL: ""`. So `NODE_ENV=development` and Supabase is
  not configured at all.
- `e2e/living-plan.spec.ts:35` loads `/?qa=preview`, which flips
  `isDevelopmentPreviewRequest` to `true`, and its `snapshot()` helper reads
  the plan out of `localStorage`.
- On that path `applyPlanRevision` returns at
  [apply-service.ts:34](src/lib/plan-revision/apply-service.ts:34) —
  `{ status: "applied", ... }` **with no database write at all**. Preview
  likewise skips `loadActiveRevisionContext` entirely.

So the journey asserts a receipt produced by an in-memory branch. The
byte-identical unchanged-sessions test is equally unaffected by the missing
migration.

The production path is not untested in principle — mocked unit tests
(`active-revision.test.ts`, `living-plan-route.test.ts`) cover the server
logic, and `supabase/tests/database/20260909_living_plan_revision.test.sql`
exercises the real RPCs. But CI runs those against a **fresh** database built
by replaying every migration (`quality.yml`: `supabase db start`, then
`supabase test db --local`). Replaying migrations locally proves the migration
is correct; it proves nothing about whether production has it.

### Finding 4 — the gap that let this ship

Migrations are applied to production **by hand**. `docs/VERCEL-CHECKLIST.md`
enumerates which migrations to apply before deploying, and
`202609090001_living_plan_revisions.sql` appears in **no** document — not the
checklist, not the release policy, not `.github/`. There is no `supabase db
push` anywhere in CI or scripts.

The release readiness gate could not catch it either.
`scripts/readiness-capability-probe.mjs` probes exactly three contracts —
`signed_in_generation_readiness_v4`, `study_profile_public_readiness_v5`,
`public_launch_abuse_readiness_v1` — and migration 202609090001 bumps none of
them. So `pnpm readiness:production` passes against a database with no
revision support.

**This is the reusable lesson: a migration that adds a capability without
bumping a readiness contract can be deployed-around silently.**

### What this means for Brief 2

Spec section 8 (falling behind) and brief item 10 depend on revision working,
so they stay blocked until the migration is applied to production.

No application code needs to change for the precondition itself — the code is
correct and the SQL is correct. What is needed is a deployment action plus
guardrails so it cannot recur. Both are the founder's call:

1. Apply `202609090001_living_plan_revisions.sql` to the production project.
   **Not done here** — standing rules forbid touching production.
2. Add the migration to `docs/VERCEL-CHECKLIST.md`.
3. Give revision a readiness contract the probe checks, so a missing
   revision migration fails `readiness:production` instead of surfacing as a
   503 to a learner.
4. Cover the seam: at least one journey that runs with `NODE_ENV=production`
   semantics against a migrated database, so the `active` context is
   exercised end to end rather than only the development branch.

Items 2–4 are in scope for this brief's PR if the founder agrees; item 1 is
not something this task performs.
