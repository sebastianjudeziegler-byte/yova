# Personalization Milestone 3: Canonical Method Routing

Status: Study Now, pre-activation review, and post-commit ready-session method-choice verticals complete locally; release gates remain
Started: 2026-08-24
Depends on: [`PERSONALIZATION-MILESTONE-2.md`](./PERSONALIZATION-MILESTONE-2.md)

## Objective

Turn the existing method router into one deterministic, versioned policy that can visibly choose different defensible methods for different learners without letting preferences, model prose, or a stale plan label bypass the task and knowledge-stage boundary.

This milestone keeps YOVA's current nine internal methods and existing session runtimes. It does not add the larger recognizable method catalog yet.

## Current-state finding

YOVA now has one canonical method boundary for Study Now and for every session in a newly generated multi-session plan. Code derives a bounded eligible set from task family, target knowledge stage, and Learn/Practice mode; applies explicit learner choice, authorized profile declarations, or sufficiently repeated comparable outcomes only inside that set; writes the result into the provisional `StudyRoute`; and requires the generated session, fallback, setup explanation, cache, and completion path to retain that exact method and route revision.

The original defect is closed for new Study Now and server-generated plan drafts: a recognized free-text `plannedMethod` is no longer allowed to pin a new method ahead of stage policy or learner evidence. The provider response schema no longer contains `method` or `methodReason`; code assigns the compatibility method, then the authorized canonical router writes the final provisional route before the draft is signed. Route-free legacy sessions retain an explicit compatibility path.

## Frozen policy order

1. Task family, Learn/Practice mode, and per-target knowledge stage produce the eligible method set.
2. A committed `StudyRoute` fixes one eligible method for that immutable revision.
3. Before commitment, a deliberate learner choice may select another eligible method for that route.
4. Repeated comparable positive outcome evidence may rank eligible methods with bounded authority.
5. Authorized declared learner signals may rank or break a tie only inside the eligible set.
6. Continuity may preserve an eligible prior route between sessions; it may not rescue an ineligible method.
7. A generated or legacy free-text plan label is a compatibility hint, not scientific authority.
8. Ties resolve by the versioned baseline order, so identical inputs are deterministic.

The model never chooses outside the final set. It receives the chosen method and fixed recipe as input.

## Implementation slices

1. **Eligibility registry — implemented locally.** Task × stage × Learn/Practice rules live in one versioned pure module. Every combination has a deterministic valid path, and no learner signal or plan label can widen the set.
2. **Canonical selector — implemented locally.** The discrete authority order is committed route → learner choice → observed outcomes → authorized declaration → continuity → legacy compatibility → task baseline. There is no additive pseudo-score and identical inputs produce identical ordered candidates, reason, provenance, and policy version.
3. **Authorized ranking — implemented locally for Study Now.** The server reuses the authenticated learner-context load used by duration routing. It supplies typed, correctable declarations and exact route-bound evidence; raw profile-summary prose, experimental results, ignored evidence, and unsupported authorization-state versions cannot drive the method.
4. **Outcome reconciliation — implemented locally.** A positive method-ranking signal requires at least four comparable completed route revisions, twelve checked answers, two distinct study days, and a positive result. Evidence is limited to the last 90 days, the latest eight sessions per method, one completion per exact route revision, and non-review sessions whose resource, duration, target, and independent-check contracts agree. Negative or incomplete results change support, not the named method.
5. **Route composer and runtime capability registry — implemented locally for Study Now.** The provisional route stores the chosen method, up to two eligible alternatives, phase order and exact minute allocation, control mode, selected-by authority, explanation, evidence references, and versioned rule trace before content generation. The runtime registry proves which generation and recovery paths can execute that exact method without becoming a second pedagogy router.
6. **Learner agency — implemented locally for Study Now and normal-plan review.** The uncluttered defaults remain **Build and start session** and YOVA's visible plan recommendation. Study Now's **Review method first** and a normal session's collapsed **Change method** disclosure reveal no more than two task-valid alternatives. A normal-plan choice is verified against the exact signed draft, creates a fresh provisional route-revision identity, updates method, phases, rationale, agency, and provenance together, and returns a newly signed whole-plan draft without another model call. Parallel choices and activation are disabled until that deterministic replacement returns. An ineligible, unshown, stale, or tampered choice returns a bounded response and leaves the current draft intact.
7. **Cross-surface and graceful-degradation gates — implemented locally for the Study Now vertical.** Setup shows the route's actual method and the evidence that changed it. Generated resources and caches require the same route revision. When guided generation fails, a safe Practice route opens a route-faithful ungraded method workpad automatically; it records completion as practice rather than knowledge evidence. An inside-YOVA Learn route still stops if YOVA cannot safely supply the missing subject teaching. Reload and checkpoint recovery retain the workpad method, timer, and checked targets.
8. **Normal multi-session creation and review — implemented locally.** The model proposes content and sequence through a provider-only schema that has no method fields. Code assigns a safe compatibility method, classifies each session from the learner request and content contract, runs the authorized canonical selector, writes a provisional route for every session, projects the route back into the compatibility fields, and signs the resulting exact draft. The provider quality gate no longer judges code-owned methods, so method routing cannot trigger a wasted repair call. The review screen shows the chosen method and a collapsed route-faithful explanation. A server-only revision boundary accepts only an alternative already present in that exact route, preserves the plan and route lineage, mints a fresh candidate revision ID, records learner authority even when returning to the task baseline, replaces prior provisional-choice traces to stay bounded, and re-signs the exact changed plan with the original receipt expiry. Browser acceptance proves only the target route changes and that the reviewed choice is the one committed locally.
9. **Post-commit ready-session choice — implemented locally.** Session Setup keeps the committed recommendation visible and places a quiet **Change method** disclosure underneath it. The learner may choose only an alternative stored on that exact committed route. Code constructs one direct committed successor with a fresh revision ID, preserves targets, Learn/Practice mode, environment, duration, support, review contract, and profile provenance, and changes only the primary method and deterministic phase recipe. The predecessor remains immutable history. A narrow authenticated endpoint and transaction update only that session; they reject reviews, stale pointers, generated content, checkpoints, interruptions, and attempts. The database independently reconstructs the exact method set, explanation, alternatives, phase recipe, evidence references, and rule trace, so a direct authenticated caller cannot forge learner-evidence provenance around a valid method. Exact lost-response retries return the already-committed successor without clearing later work, while uncertain transport failures retain the same operation ID for a safe retry. The broad plan-adjustment flow and planning model are not involved.
10. **Broader product coverage — remaining.** Normal-plan mode, duration, and target grouping are not yet all controlled by the same deterministic composer. Signed-in cloud/browser and real PostgreSQL transaction gates remain open.

## Safeguards

- Preferences never widen task/stage eligibility.
- One result never creates a personal method conclusion.
- Low accuracy first changes support and repair; it does not automatically declare the method unsuitable.
- v1 does not deliberately randomize methods or run hidden experiments.
- A method change is between sessions and creates a successor route.
- A pre-commit learner choice is signed as part of the exact draft; it cannot be rewritten in the browser before activation.
- Learner-facing language remains observational: “recent comparable results support,” not “proven best for you.”
- Existing route-free plans retain a bounded compatibility path while committed routes remain authoritative.
- Routing remains pure code; no additional model call grades or repairs a method decision.
- A fallback may preserve the committed method only when it can preserve the route's source, target, mode, and evidence boundary. It never converts ungraded work into mastery evidence.

## Initial acceptance requirements

1. every task × stage × mode combination returns a non-empty, deterministic, valid set — **proved in pure tests**;
2. a task-valid but stage-invalid plan label cannot enter the eligible set — **proved in pure tests**;
3. the same task with one changed authorized learner signal may select a different eligible method and show the exact reason — **proved for Study Now profile, outcome, and explicit-choice inputs, and for normal-plan declaration inputs at the pure/API boundary**;
4. a committed route method is immutable during generation and cache reuse — **proved at unit/API boundaries and in the desktop learner flow**;
5. a method switch requires a material successor and preserves the predecessor's evidence — **proved in pure, API, migration-contract, and local desktop learner-flow tests for an untouched ready session**;
6. no-signal learners receive the stable baseline without manufactured personalization — **proved in pure and API tests**;
7. identical inputs always produce identical candidates, selection, reason, and policy version — **proved in deterministic tests**;
8. plan, setup, generated session, fallback, checkpoint, completion, and reload retain the same method/revision — **proved for the local Study Now desktop vertical; normal-plan review-to-commit parity is proved locally; signed-in cloud remains**.

## What this does not prove

- It does not prove that one method causally produces better learning for an individual learner.
- It does not yet use delayed retention or transfer as the final method-effect outcome.
- It does not let a learner change the method after content has generated or work has begun; the committed ready-session control deliberately stops at that boundary.
- It does not make normal-plan mode, duration, target grouping, and phase structure fully code-owned; this slice makes the named method code-owned.
- It does not make broad “best method for you” claims. Current positive evidence supports a bounded recommendation among already eligible methods.

## Deployment relationship

Milestone 3 remains local until the Milestone 1 PostgreSQL gate and Milestone 2 signed-in browser matrix pass. No method-policy change should be published independently of the route persistence and cache-revision boundaries it relies on.

## Current local verification

- Vitest: 331 files passed, 13 skipped; 2,506 tests passed, 55 skipped.
- Desktop Playwright: 46 of 46 core-learning and personalization tests passed.
- TypeScript `--noEmit`: passed.
- ESLint: passed.
- Next.js production build: passed; 45 routes generated.
- Diff whitespace check: passed.

Milestone 3 is included in the personalization revamp branch. No migration has been applied, and nothing has been deployed or published.

## Remaining release gates

1. Run migrations `202608230001` through `202608230010` plus `202608240001_post_commit_method_choice.sql` on disposable PostgreSQL/Supabase and pass the documented permission, trigger, idempotency, replay, two-successor history, concurrency, and rollback scenarios.
2. Run a signed-in cloud browser matrix that proves profile- and outcome-driven method selection survives generation, signed activation, database round-trip, resource generation, cache, checkpoint, completion, and reload.
3. Run the post-commit method-choice flow against the signed-in cloud path and verify authoritative reload, exact replay, concurrent stale-write rejection, and immutable predecessor history on real PostgreSQL.
4. Move normal-plan mode, duration, target grouping, and phase structure behind deterministic route inputs, removing each corresponding obsolete model obligation as code authority lands.
5. Establish delayed-retention and transfer evaluation before making an individual efficacy claim or expanding the recognized method catalog.
