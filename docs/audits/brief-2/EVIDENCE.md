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

| Object | Production result | Usable as evidence? |
|---|---|---|
| `plan_revisions` **table** | **404 PGRST205 — absent** | **yes — decisive** |
| `read_plan_revision_context(target_plan_id)` | **404 PGRST202 — absent** | **yes** |
| `apply_plan_revision(actor_user_id, payload)` | **404 PGRST202 — absent** | **yes** |
| `plans` table *(control)* | 200 — **present** | yes |
| `signed_in_generation_readiness_v4()` *(control, earlier migration)* | 401 `42501` permission denied — **present** | yes |
| `plan_revision_session_fingerprint(s)` | 404 | no — composite-typed argument |
| `initialize_plan_revision_id()` | 404 | **no — returns `trigger`** |

Two caveats, so the method is not over-read. PostgREST never exposes trigger
functions, so `initialize_plan_revision_id` answers 404 whether or not it
exists; the composite-argument function is unreliable for the same class of
reason. Neither row is evidence, and neither is needed.

The remaining rows are decisive. The `plan_revisions` table answers
`PGRST205 Could not find the table` while the `plans` control answers 200 —
a clean schema-level absence. The control *function* calibrates the function
probes: one that exists but is revoked from `anon` answers `42501`, not
`404`. So the `404` on `read_plan_revision_context` — which *is* granted to
`authenticated` — means genuinely absent, not merely ungranted.

The probed project is the one production serves: `www.yovaapp.com` ships
`https://sbntgjvrvazcnlppnbzs.supabase.co` in its client chunks.

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

### Finding 5 — full migration audit: only 202609090001 is missing

Swept every object created by every merged migration against production, same
probe method.

**Tables — 36 probed, 1 absent.**

| Result | Count | Detail |
|---|---|---|
| present | 35 | 200 or RLS-empty |
| **absent** | **1** | `plan_revisions` — `PGRST205` — from `202609090001` |

**Functions — 146 probed (deduplicated; 46 trigger functions and 1
composite-argument function excluded as unprobeable), 3 reported absent, 2
genuine.**

| Function | Migration | Verdict |
|---|---|---|
| `read_plan_revision_context` | 202609090001 | **genuinely absent** |
| `apply_plan_revision` | 202609090001 | **genuinely absent** |
| `adjust_learning_plan` | 202608210001 | **false positive — see below** |

`adjust_learning_plan` is *correctly* absent. Migration
`202608230007_route_aware_plan_adjustment.sql` renames it to
`adjust_learning_plan_without_study_routes` and adds
`adjust_learning_plan_with_routes`. Both successors were probed and both are
present (`42501`). The parser keys functions by their name at creation time
and does not follow later `alter function ... rename to`, so this is a
limitation of the audit method, not a production gap.

**Conclusion: `202609090001_living_plan_revisions.sql` is the only merged
migration missing from production.** Every other migration is applied.

### The guardrails

**1. The checklist.** `docs/VERCEL-CHECKLIST.md` gains a *Living-plan revision
release order* section naming both `202609090001` and the new
`202609110001`, with the incident recorded so the reason survives.

**2. A readiness contract that can go red.** New migration
`202609110001_living_plan_revision_readiness.sql` adds
`signed_in_generation_readiness_v5()`, layering `livingPlanRevision` onto the
v4 contract: both RPCs, the history table, `plans.current_revision_id`, the
`plans_initial_revision` trigger, and the write boundary (the learner reads
revision history and never writes it; only the signing server applies one).
`scripts/readiness-capability-probe.mjs` and
`src/lib/supabase/signed-in-generation-readiness.ts` both move to v5 and
contract `202609110001`, so **`readiness:production` now fails closed** — and
so does the deployed app's own status route — against a database in
production's current state.

One design note worth keeping: existence is resolved *before* any privilege
lookup. `has_table_privilege` and `has_function_privilege` raise when their
object is absent, and PostgreSQL does not promise to short-circuit an `and`
chain. A readiness probe must return false, never throw — otherwise the probe
fails in exactly the case it exists to report.

**3. Seam coverage.**
`supabase/tests/database/202609110001_living_plan_revision_readiness.test.sql`
runs under `supabase test db --local`, which CI executes against a database
built by replaying every migration — not the in-memory preview path. Nine
cases: the service-role boundary, the contract version, the capability true on
a migrated database, v4's placement boundary carried through unchanged, and
five absence cases that each drop one object inside a savepoint and assert the
capability flips to **false**. That last group is the point — a contract that
cannot go red is not a contract.

### Red/green evidence

| Test | Before | After |
|---|---|---|
| `readiness-capability-probe.test.ts` — "fails closed when the database has no living-plan revision support" | **FAIL** — returned `{passed: true, detail: "...contract 20260907160001 is available"}` against `livingPlanRevision: false` | **PASS** |
| `signed-in-generation-readiness.test.ts` — "is unavailable when the database has no living-plan revision support" | **FAIL** — resolved `"ready"` | **PASS** |

Scoped run after the change: **84 passed, 1 skipped** across the readiness,
status-route, plan-revision and adjust-route suites. `tsc --noEmit` clean,
`pnpm lint` clean.

**Not verified locally: the pgtap test.** Docker is unavailable on this
machine, so `supabase db start` cannot run, and per the standing rules
database verification belongs in GitHub Actions. The nine cases are written
but have not been executed — CI is their first run.

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
