# Personalization Milestone 5: Recognizable Method Catalog

Status: recognizable-name and disabled Blurting compatibility slices implemented and verified locally; learner-runtime, release, and real-database gates remain

Started: 2026-08-24

Depends on: [`PERSONALIZATION-MILESTONE-4.md`](./PERSONALIZATION-MILESTONE-4.md)

## Objective

Expose YOVA's existing learning engines under clear, recognizable learner-facing recipe names before adding new recipes. Then introduce each genuinely new recipe behind its own deterministic contract, database compatibility boundary, tests, and server-owned rollout policy.

This milestone reuses the existing StudyRoute, canonical method router, phase primitives, runtimes, draft receipt, method-choice endpoints, and immutable successor flow. It does not create a second method system or add model calls to method selection.

## First bounded slice

Seven current engines already implement the behavior needed by their agreed learner-facing names. This slice changes presentation while preserving internal IDs, eligibility, phase order, runtime, evidence thresholds, and route lifecycle:

| Stable internal ID | Recognizable name |
| --- | --- |
| `retrieval_practice` | Active Recall |
| `spaced_retrieval` | Spaced Repetition |
| `worked_example_fading` | Worked Examples |
| `practice_test_error_repair` | Practice Tests |
| `interleaved_practice` | Interleaving |
| `retrieval_based_outlining` | Outline from Memory |
| `scaffolded_coding` | Trace–Code–Test |

Legacy labels remain accepted at compatibility and text-adapter boundaries. Newly routed recipes use the recognizable name consistently in the session scalar, StudyRoute, rationale, alternatives, method briefing, and method-choice successor. PostgreSQL validation must mirror the same canonical presentation contract before release.

The learner-facing mapping is recorded separately as `method_presentation_v1`, so a presentation change does not imply that selection, eligibility, fidelity, or runtime behavior changed. Initial routes, draft method changes, committed successors, and exact SQL replay compose that provenance component once. Existing routes retain their stored historical labels; new successors use the current canonical label.

Generated-session boundaries project the exact StudyRoute label after provider output. Typography preserves catalog punctuation such as `Trace–Code–Test`, and server caches plus browser hydration reject a resource whose method ID or visible name disagrees with its committed route. The text adapter recognizes both the old labels and bounded punctuation variants of the new names.

Two recognizable labels are deliberately not part of this rename-only slice:

- Feynman Technique requires a recipe that includes source comparison, repair, and a second explanation; the current generic self-explanation contract is only model then explain.
- SQ3R requires explicit survey and question phases in addition to bounded reading, recall, and review; the current read-recall-review engine does not yet prove that full sequence.

Renaming either one before its enforced recipe exists would overstate what the learner receives.

## Disabled Blurting compatibility boundary

Blurting is the first new recipe after the presentation slice. It remains a retrieval variant scientifically and keeps `retrieval_practice` as its stable method family, while its exact recipe requires broad minimally cued recall, delayed source comparison, explicit gap identification and repair, then a fresh closed-source check.

The compatibility slice now freezes the following while issuance remains off:

- a default-off `method_recipe_v1` selector that represents Blurting as the `blurting_v1` supporting technique over `retrieval_practice`, never as a new core method;
- an exact StudyRoute contract for ordinary Practice sessions, grounded source comparison, non-novice targets, a 10-minute minimum, one to three active targets, independent start, `retrieve -> repair -> transfer`, and one independent verification contract per target;
- a versioned `broad_recall_v1` runtime data shape with one uncued prompt, delayed comparison, a bounded gap checklist, correction, and a different closed-source transfer prompt;
- default-deny generation, server-cache, browser-hydration, and scheduled-review guards. No production caller selects Blurting or passes `allowBroadRecall: true`;
- draft and committed method-choice exits that remove the active recipe atomically, retain historical trace, and return to the ordinary runtime contract;
- append-only PostgreSQL compatibility that rejects unknown or padded recipe signals and requires a live server-minted activation permit for the first Blurting revision in a lineage;
- an exact activation permit over the authenticated account, plan, verified receipt epoch, and canonical payload. Reset invalidates permits and quarantines receipt epochs for the full accepted 60-second clock-skew bound; consumed exact outcomes support lost-response replay without rerunning the writer.

The next disabled layers are also present, but remain deliberately unwired:

- a content-free `broad_recall_v1` progress log with an immutable event prefix, exact route/evidence bindings, and safe reload. Browser progress is never evidence authority. Broad progress requires a route-bound V2 checkpoint; route-less broad interruptions fail closed;
- append-only checkpoint compatibility in `202608240004_broad_recall_progress_compatibility.sql`, including exact committed-route and cached-runtime binding. The current interruption payload cannot prove the exact generated resource before its checkpoint is cleared, so broad interruption persistence remains denied;
- a disabled schema-only V18 resource candidate, a dedicated Broad Recall controller/component, and a strict support-surface policy. None is part of the public generated-session union or live renderer;
- a physically separated V18 resource boundary. The reusable browser template is answer-free, and each staged public disclosure contains only that stage's learner-visible material: compare may include the saved source answer and complete may include target-bound references, while private criteria, composite answer keys, and unrelated-stage fields remain absent. Every authoritative stage projector requires an opaque repository capability that binds a DB-owned observation time, the current committed Blurting route, the exact ready resource, and the live disclosure receipt. Raw JSON cannot mint this capability or authorize a later stage;
- an unwired stage-minimal public delivery projector and dedicated Broad Recall component. The browser controller stores one current public DTO, never the private runtime; enforces the exact delivery-stage/progress-rank matrix; accepts only an exact replay or one adjacent stage; and records terminal results only from a request-token-matched complete delivery. Prior-stage fields are absent from the current controller state and DOM after advancement, while ephemeral drafts are cleared at their accepted boundary. Parsing still establishes no provenance, so this is not a disclosure or security boundary and remains absent from live resource unions, hydration, rendering, and generation;
- a disabled evaluator request contract that accepts only the opaque repository capability, a bounded learner answer, and exact ordered target/evidence IDs. Rubrics, comparison criteria, reference answers, HMAC authority, request-digest authority, and result authority remain server-owned and currently unmintable;
- server-only verified-completion and evidence seams. Completion requires a separately loaded resource-delivery-evaluation join, exact target order, recomputed request and result digests, current route, live half-open receipt windows, and an in-memory brand that JSON cannot reproduce. Evidence concepts come from the private resource, and an unavailable evaluation maps every target to `needs_review`; bare browser progress or result vectors produce no evidence;
- append-only generated-resource containment in `202608240005_generated_resource_authority.sql`. The historical one-argument cache RPC remains available for ordinary routes, while the write-time trigger rejects every legacy or V18 broad signal under any route and every non-null resource on an active Blurting route. A private zero-access table and digest reserve the future authority namespace, but there is no mint, permit matcher, transaction GUC, two-argument writer, or consumable authority.
- append-only private-store reservation in `202608240006_blurting_resource_store_v18.sql`. It defines zero-access resource, delivery, and evaluation tables; domain-separated canonical-JSON digests; exact source snapshots; strict answer-free public payload validation; current-route and ready-resource guards; monotonic DB-timed disclosure stages; live worker leases; exact resource-owned result vectors; reset/cascade cleanup; and immutable terminal receipts. It exposes no insert, update, mint, reader, delivery, evaluator, or evidence RPC and grants no table access.
- append-only canonical-domain compatibility in `202608240007_blurting_canonical_domains_v18.sql`. It pins exact UTC millisecond instants, the ECMAScript TrimString edge set, Unicode-scalar/code-point text bounds, all persisted V18 timestamp columns, both stored `generatedAt` spellings, and every transformable public/private payload field. Existing private guards use a DB-owned millisecond statement instant while raw clock reads remain liveness-only. This migration also exposes no writer, reader, mint, evaluator, grant, feature flag, or runtime path;
- a server-only HMAC seam that domain-separates and binds the exact authenticated owner, resource, delivery, evaluation receipt, committed route, run, activity, request token, and canonical learner answer. Raw inputs can derive only unbranded structural commitments; only an opaque repository-bound evaluator input can mint HMAC/request-digest authority. The seam performs no environment lookup or I/O, returns neither the secret nor learner answer, and has no endpoint, database writer, or production consumer.

There is no generated-resource permit mint or authorized broad cache call at all. A source search also confirms that no production caller enables `allowBroadRecall`, and the authenticated plus preview session-generation paths still return `blurting_runtime_unavailable` before cache, allowance, or provider work.

The rollout flag will be server-only and will govern issuance of new Blurting routes. Turning it off must not invalidate a signed draft or committed route that already contains the recipe. The browser renders the route snapshot and does not read the environment flag.

This is compatibility, not a usable learner rollout. Before enabling Blurting, YOVA still needs server-authorized source-grounded resource generation, repository writers/readers for the private V18 store, a server HMAC and evaluation worker, promotion of the answer-free public schema into the production session union, live renderer and support-policy wiring, terminal receipt consumption and evidence persistence, a resource-aware broad interruption writer, exact inside/outside recovery behavior, recipe-aware plan adjustment and follow-up routes, an ordinary Active Recall opt-out path, and a frozen historical `v1` fixture. Until those pieces exist, the early 409 gate remains mandatory.

Migration 006 intentionally has no evaluation-retry writer. Its five-minute lease is authority, so an expired worker cannot publish or extend it; the unique delivery/evaluation relationship also prevents creating a second row for the same run. Migration 007 closes the timestamp-spelling, trimming, Unicode-scalar, and code-point-length parity gap without adding authority. Before any evaluator becomes reachable, a later writer migration must still add an account-locked fencing token and monotonic lease epoch, exact lost-response replay, safe expired-lease reclaim or delivery revocation, and first-terminal-result semantics. That writer migration remains gated on first executing the complete migration history through 007 against real PostgreSQL/Supabase.

## Required release order for a new recipe

1. Add database compatibility and real-PostgreSQL tests while the flag remains off.
2. Deploy application support with the flag off.
3. Verify generation, fallback, cache, checkpoint, completion, draft choice, and committed choice against exact route revisions.
4. Enable for preview or a small cohort.
5. Compare cost, reliability, fallback use, learner overrides, and completion with the existing retrieval baseline.
6. Enable more broadly only if the route and runtime remain reliable; rollback stops issuing new routes but preserves existing ones.

### Coordinated activation-permit cutover

Migration `202608240002_plan_activation_permits.sql` is a forward-only RPC
signature cutover: it makes the historical one-argument plan writer private
and exposes the authenticated two-argument writer only after a server-only
permit is minted. Apply `202608240002` and then `202608240003` before deploying
the matching application code. The old application may fail plan activation
closed during that short database-first window; the new application must not
be deployed against the old signature. Migration `202608240002` notifies
PostgREST to reload its schema cache on commit.

The permit binds the exact deterministic active payload to the authenticated
account, plan ID, and verified draft-receipt issuance epoch. Reset serializes
on the same account lock, invalidates every permit, and records an epoch that
pre-reset receipts cannot cross. A consumed permit retains only its digest and
saved plan ID long enough to replay an exact lost response without rerunning
the non-idempotent writer; it never stores the plan or browser receipt.

## Explicitly later slices

- the full Feynman recipe;
- the full SQ3R recipe;
- Pretesting;
- Concept Mapping;
- Practice Problems;
- broader catalog or onboarding UI;
- causal claims that a named recipe is personally best.

## Current verification

The presentation slice passed the local code and browser gates on 2026-08-24:

- full Vitest: 341 files passed and 13 skipped; 2,685 tests passed and 55 skipped;
- `tsc --noEmit`;
- full ESLint;
- production Next.js build, including 45 static-page generation steps;
- `git diff --check`;
- desktop Chromium learning and personalization flows: 46/46 passed.

After the disabled Blurting compatibility, activation-permit, canonical-domain, and HMAC work, the current local gate is:

- focused V18 public/private, delivery-state, runtime, progress, support, route-gate, evaluator, evidence, and ordered migration contracts: 13 files and 154 tests passed;
- ordered Blurting migrations `202608240003` through `202608240006`: 4 files and 59 tests passed;
- focused activation, recipe, progress, containment, private-store, and real-PostgreSQL-gate source contracts: 7 files and 107 tests passed;
- focused V18 canonical-domain, public/private resource, evaluator, HMAC, evidence, migration-007, migration-006, and real-PostgreSQL-gate contracts: 9 files and 78 tests passed;
- focused staged-public Broad Recall runtime, delivery-state, progress, and support contracts: 5 files and 68 tests passed;
- full Vitest after the staged-public Broad Recall runtime refactor: 361 files passed and 13 skipped; 2,953 tests passed and 55 skipped;
- `tsc --noEmit`;
- full ESLint;
- production Next.js build, including 45 static-page generation steps;
- `git diff --check`;
- a transactional 45-assertion pgTAP boundary contract is wired after full local migration replay and database lint in the GitHub quality workflow. It covers the 001 method-choice RPC, 002 permit cutover, 003 ordinary/recipe compatibility, 004 transcript-free progress, 005 broad-resource containment, the zero-access 006 private store, and the exact 007 timestamp/text vectors and constraints;
- independent generated-resource and V18 authority audits found no live application authority path after replacing raw JSON stage/completion seams with opaque repository capabilities; no live database claim is made from source tests.

The production build has now been rerun after the disabled Blurting slice. The 46 desktop browser cases above remain the latest pre-compatibility browser baseline and have not yet been rerun after this disabled slice.

The database changes still have only static contract coverage in this workspace. They have not been parsed or executed against a real PostgreSQL/Supabase instance, including migration 007 and the required reset, deletion, activation-permit replay, generated-resource containment, concurrent cache write, Blurting first-introduction, broad checkpoint merge, and legacy-label-to-canonical-successor cases. This snapshot is committed on the personalization revamp branch, but nothing has been deployed, published, or applied to a linked or production database.

The bundled Supabase CLI is available locally, but this machine currently has no PostgreSQL binaries, container runtime, container socket, or local PostgreSQL listener. The migrations depend on the earlier schema and Supabase Auth objects, so verification must replay the complete migration history rather than apply only migrations 001–007 to a blank database. The repository quality workflow now performs the correct isolated Docker-backed sequence (`supabase init`, `supabase db start`, local database lint, `supabase test db --local`, and `supabase stop --no-backup`) on a GitHub runner. The new pgTAP file is transaction-rolled-back and never targets a linked database, but it has not executed in this workspace because no database engine is present. Local execution requires a separately authorized Docker-compatible runtime and image download; the linked Supabase project is not being used as a validation target.
