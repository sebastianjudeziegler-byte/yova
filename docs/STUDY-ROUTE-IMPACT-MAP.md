# StudyRoute Engineering Impact Map

Status: Milestone 0 handoff for Milestone 1
Updated: August 23, 2026
Product contract: [`PERSONALIZATION-SYSTEM-SPEC.md`](./PERSONALIZATION-SYSTEM-SPEC.md)

## 1. Milestone 1 boundary

Milestone 1 introduces one immutable `StudyRoute` revision alongside each plan session while keeping the current learner experience working.

It is an adapter-and-identity milestone, not the new routing algorithm. It must not yet:

- redesign Home, Agenda, setup, or the active session;
- replace the nine current methods;
- add the three agency modes to the interface;
- add sophisticated duration personalization;
- remove legacy fields before every reader and writer has migrated;
- reinterpret old outcomes as precise evidence about a route the learner may not have experienced.

The immediate result should be boring from the learner's perspective and important from the engineering perspective: every surface can name the same decision revision.

## 2. Why an adapter is required

YOVA currently has several route authorities rather than one:

| Stage | Current authority | Risk |
|---|---|---|
| Plan generation | Free-text session method, reason, duration, learning mode, and targets | The first decision is not versioned or canonical. |
| Home, Agenda, setup | Plan-session scalar fields | These surfaces show the planned promise. |
| Session generation | Method router, learner-fit ordering, personalization narrowing, and delivery policy | The practical route may be recomputed after the plan was shown. |
| Active session | Generated resource briefing, routing context, policy, support plan, and activities | Visible authority silently changes from the plan to generated content. |
| Completion and evidence | Plan/session IDs plus present scalar/resource data | Outcomes do not identify the exact decision that produced them. |
| Cache and recovery | Resource and adjustment fingerprints | Cached content knows its content identity but not the committed route that authorized it. |
| Outside YOVA | Plan-wide `studyMode` | Execution environment is not independently historical per session. |

The current split-brain path is:

```text
plan method and duration
        ↓
Home / Agenda / setup
        ↓
runtime method router + personalization
        ↓
generated resource briefing and phases
        ↓
active session or fallback
        ↓
completion reconstructed from mutable fields
```

Milestone 1 adds identity and parity around this chain before later milestones change its decisions.

## 3. New code seams

Add a focused module rather than placing route logic inside the existing large UI component:

```text
src/lib/study-route/
  schema.ts       exact Zod and TypeScript route contract
  adapters.ts     legacy/resource ↔ StudyRoute projections
  selectors.ts    shared learner-facing route reads
  revisions.ts    immutable successor and material-change rules
```

During rollout, add `studyRoute?: StudyRoute` or a route reference to `LearningPlanSession`. Legacy fields remain until dual-read and dual-write coverage is complete.

The current code uses `learn | study`; the canonical route uses `learn | practice`. The adapter must own the explicit mapping:

```text
legacy learn  ↔ route learn
legacy study  ↔ route practice
```

Neither vocabulary should leak ambiguously into new storage or UI code.

### Required adapters

1. `legacyPlanSessionToStudyRoute(plan, session, knowledgeMap)` creates a provisional or reconstructed route from the existing planned promise.
2. `sessionResourceToStudyRoute(...)` records the route the learner actually experienced when generated-resource fields differ from the plan.
3. `studyRouteToLegacySessionProjection(...)` keeps current components, APIs, and RPC payloads working during migration.
4. `createSuccessorStudyRoute(...)` creates a new immutable revision for a later material change.

### Backfill precedence

Historical reconstruction must preserve the distinction between what YOVA promised and what ran:

1. Generated resource wins for an executed method, phases, difficulty, and delivery.
2. The plan-session row wins for stable target IDs and originally planned duration.
3. Resource cache context wins for an effective setup-adjusted duration that actually ran.
4. Plan `studyMode` supplies the initial execution environment.
5. Knowledge-map state supplies per-target snapshots at reconstruction time, clearly marked as reconstructed if the exact historical snapshot is unavailable.
6. Missing provenance, agency, or confidence stays unknown. The backfill must not invent a learner choice.

For a planned-only session, a method recipe describes intended phases. It is not proof that those phases ran.

## 4. Existing type and schema impact

| Area | Main files | Milestone 1 change |
|---|---|---|
| Domain objects | [`src/lib/domain.ts`](../src/lib/domain.ts) | Add route identity to plan sessions, resources, completions, interruptions, and evidence-compatible records without breaking legacy readers. |
| Plan schemas | [`src/lib/plan-generation/schema.ts`](../src/lib/plan-generation/schema.ts) | Allow route references/projections in generated, activated, and persisted plan shapes. |
| Session resource | [`src/lib/session-generation/schema.ts`](../src/lib/session-generation/schema.ts), [`src/lib/session-generation/resource.ts`](../src/lib/session-generation/resource.ts) | Carry the committed revision ID through generation and cache materialization. |
| Knowledge targets | [`src/lib/knowledge-map/schema.ts`](../src/lib/knowledge-map/schema.ts) | Supply immutable per-target snapshots; do not turn the route into a second mastery store. |
| Delivery policy | [`src/lib/personalization/session-delivery-policy.ts`](../src/lib/personalization/session-delivery-policy.ts) | Project existing policy into the route execution section while preserving current behavior. |
| Method recipe | [`src/lib/learning/method-fidelity.ts`](../src/lib/learning/method-fidelity.ts) | Supply intended ordered phases for planned routes and validate executed phases. |

Every answer, repair, review, or evidence event that may update knowledge eventually needs both a stable target ID and the executed route revision ID.

## 5. Persistence impact

Use a separate immutable route table rather than storing only a mutable latest route inside session `step_data`.

```text
study_routes
  route_revision_id          primary key
  route_lineage_id
  revision_number
  schema_version
  lifecycle_status           provisional | committed | superseded
  user_id
  plan_id
  plan_session_id
  route_data                 jsonb
  predecessor_revision_id    nullable
  created_at
  committed_at               nullable

plan_sessions
  committed_route_revision_id nullable foreign key
```

Required protections:

- unique `(route_lineage_id, revision_number)`;
- at most one committed revision per plan session;
- immutable route payload after insertion;
- controlled lifecycle transitions only;
- ownership-equivalent row-level security;
- route creation and session-pointer update in one transaction;
- expected-revision checks on cache, checkpoint, completion, and successor writes;
- nullable route identity on legacy attempt, completion, interruption, and checkpoint records during migration.

Do not edit historical migration files. Add a new migration that creates the route table and replaces or wraps current RPC definitions.

### Write paths requiring route awareness

- plan save and activation;
- plan adjustment;
- duration adjustment;
- delayed verification and follow-up creation;
- concept-review activation;
- guided continuation and session splitting;
- session generation/resource persistence;
- completion, interruption, and offline outbox replay.

Reviews, follow-ups, continuations, and additional split session IDs create new plan sessions. They receive new route lineages with provenance pointing to the originating route. The first split part deliberately reuses the original session ID, so a material change there creates a same-lineage successor revision instead of a second lineage for one session.

Ordinary rescheduling should preserve a route pointer until time of day becomes an actual routing input. A schedule move alone should not manufacture a new method decision.

## 6. Plan creation and activation

Current decision creation is concentrated in:

- [`src/app/api/plans/generate/route.ts`](../src/app/api/plans/generate/route.ts);
- [`src/lib/plan-generation/prompt.ts`](../src/lib/plan-generation/prompt.ts);
- [`src/lib/plan-generation/preview-generator.ts`](../src/lib/plan-generation/preview-generator.ts);
- [`src/lib/plan-generation/materialize-plan.ts`](../src/lib/plan-generation/materialize-plan.ts);
- [`src/app/api/plans/activate/route.ts`](../src/app/api/plans/activate/route.ts).

For Milestone 1, the current model/preview output may keep choosing free-text method, duration, and targets for parity. Activation converts those fields into stable route revisions and saves them transactionally with the plan.

Route IDs must remain stable from reviewed draft through activation. Creating new IDs on render, refresh, or retry would destroy decision identity.

## 7. Home, Agenda, setup, and active session

Most direct scalar reads live in [`src/components/yova-prototype.tsx`](../src/components/yova-prototype.tsx), with additional reads in [`plan-creator.tsx`](../src/components/plan-creator.tsx) and [`study-now-creator.tsx`](../src/components/study-now-creator.tsx).

Milestone 1 should replace direct reads of method, mode, duration, and environment with shared selectors:

```text
committed route value
    else reconstructed route value
        else legacy scalar fallback
```

The visible experience remains unchanged. This avoids adding complexity for the learner while eliminating independent route reconstruction in each tab.

Setup is a migration edge. Time, familiarity, and support changes are currently ephemeral until generation. In Milestone 1, the executed-resource adapter may record the effective route that ran. In the later routing milestone, a material setup change must create and commit a successor before generation.

Legacy agency should be recorded as system-selected or unknown. It must never claim the learner explicitly chose a method when the current UI did not offer that choice.

## 8. Session generation and fallback

Current generation decisions are split across:

- [`src/lib/learning/method-router.ts`](../src/lib/learning/method-router.ts);
- [`src/lib/learning/session-routing-input.ts`](../src/lib/learning/session-routing-input.ts);
- [`src/lib/personalization/personalization-generation.ts`](../src/lib/personalization/personalization-generation.ts);
- [`src/app/api/sessions/generate/route.ts`](../src/app/api/sessions/generate/route.ts);
- [`src/lib/openai/reliable-session-generator.ts`](../src/lib/openai/reliable-session-generator.ts);
- [`src/lib/openai/session-generator.ts`](../src/lib/openai/session-generator.ts).

Milestone 1 must:

- pass `routeRevisionId` through generation input and output;
- project the committed route into existing router/generator inputs;
- store the revision ID in resource cache context;
- reject returned or cached content bound to another revision;
- prevent model output from silently changing route-owned fields;
- bind built-in fallback to the same revision;
- freeze the route under an active checkpoint rather than superseding it while the learner is working.

Outside-YOVA work and quick scheduled reviews must keep their current lightweight completion contracts. An adapter must not inflate them into a full guided recipe merely because a catalog method has more phases.

## 9. Completion, evidence, and method learning

Current completion and adaptation flow includes:

- [`src/lib/learning/complete-plan-session.ts`](../src/lib/learning/complete-plan-session.ts);
- [`src/lib/personalization/post-session-decision.ts`](../src/lib/personalization/post-session-decision.ts);
- [`src/lib/personalization/session-adaptation.ts`](../src/lib/personalization/session-adaptation.ts);
- [`src/lib/personalization/method-signals.ts`](../src/lib/personalization/method-signals.ts);
- [`src/lib/supabase/learning-state-repository.ts`](../src/lib/supabase/learning-state-repository.ts).

Every completion, interruption, target observation, and method comparison should reference the executed route revision. Otherwise a later scalar-field change can reinterpret historical outcomes under a method the learner did not use.

For historical data:

- completed sessions with a stored generated resource may receive a clearly marked reconstructed executed route;
- completed sessions without a trustworthy resource should remain unlinked or low-confidence reconstructed;
- uncertain reconstruction must not support strong personal-method claims.

## 10. Cache, checkpoint, offline, and export

Affected modules include:

- [`src/lib/server/session-cache-context.ts`](../src/lib/server/session-cache-context.ts);
- [`src/lib/session-generation/cache-contract.ts`](../src/lib/session-generation/cache-contract.ts);
- [`src/lib/learning/active-session-checkpoint.ts`](../src/lib/learning/active-session-checkpoint.ts);
- [`src/lib/learning/session-start-recovery.ts`](../src/lib/learning/session-start-recovery.ts);
- [`src/lib/persistence/preview-store.ts`](../src/lib/persistence/preview-store.ts);
- completion and interruption outboxes under `src/lib/sync/`;
- [`src/lib/account-export/schema.ts`](../src/lib/account-export/schema.ts).

Required behavior:

- add route revision to resource, cache scope, local/cloud checkpoint, and offline outbox records;
- reject generated content from another revision even if its topic and duration look compatible;
- dual-read checkpoint v1 and v2 so rollout does not erase saved work;
- replay offline outcomes against their original revision, not whichever route is current later;
- include route history and provenance in account export without exposing model prompts or private answer text.

## 11. Milestone 1 acceptance tests

1. Plan, Home, Agenda, setup, and active session resolve the same committed revision.
2. Legacy sessions render identically before and after route backfill.
3. Generated or cached content cannot cross revision IDs.
4. Completion, interruption, and evidence store the executed revision.
5. Active checkpoints survive schema migration but cannot switch routes underneath the learner.
6. Outside-YOVA execution environment remains historically correct.
7. New split session IDs, reviews, follow-ups, and continuations receive new lineages with origin provenance; a first split part that reuses its original session ID receives a successor revision.
8. Only one committed revision exists per session.
9. Provisional, committed, and superseded route payloads are immutable.
10. Quick reviews and outside practice keep their current lightweight runtime and evidence boundaries.

The Milestone 0 characterization suite must remain green throughout.

## 12. Safest rollout order

1. Add TypeScript schema, adapters, selectors, and parity tests.
2. Add the immutable route table and nullable foreign keys.
3. Dual-read route first with legacy fallback.
4. Backfill planned sessions first; reconstruct active/completed sessions from generated resources only where trustworthy.
5. Add route identity to resources, caches, checkpoints, attempts, completions, interruptions, and outboxes.
6. Dual-write every creation and rewrite RPC.
7. Move all surfaces to shared selectors.
8. Add stale-write, recovery, RLS, export, and transaction tests.
9. Make committed route identity required only for newly created sessions after parity is proven.

The largest risk is not the size of the schema. It is canonizing the wrong historical decision. Plan scalars represent what YOVA promised; generated resources represent what the learner actually experienced. Immutable revisions must preserve both facts instead of collapsing them into one mutable latest object.
