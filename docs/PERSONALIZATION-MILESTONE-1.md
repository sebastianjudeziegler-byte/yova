# Personalization Milestone 1 Handoff

Status: implementation complete; live PostgreSQL migration smoke test required before deployment
Date: 2026-08-23

## Outcome

YOVA now has one versioned, immutable `StudyRoute` contract for the study recipe promised to a learner. A route records the learning mode, execution environment, method, target state, ordered phases, duration, support, evidence requirements, provenance, agency choice, and lifecycle identity for one plan session.

The route is now the shared contract across plan activation, Home, Agenda, setup, generation, generated-resource caching, fallback content, active checkpoints, completion, interruption, follow-up reviews, continuations, plan adjustments, account export, and local recovery. A material change creates a successor revision; completed or retired work keeps the exact historical revision that governed it.

## What changed

- Added the strict schema, adapters, selectors, revision helpers, route creation helpers, target projection, source binding, and generation-contract validation under `src/lib/study-route/`.
- Added immutable route persistence and route-aware transactions in migrations `202608230001` through `202608230010`.
- Bound generated and cached session resources to the exact committed route revision. A stale, missing, or conflicting revision fails closed instead of being presented as the current recipe.
- Bound checkpoints, attempts, completions, interruptions, delayed reviews, concept reviews, continuations, and adjustment successors to the route that produced them.
- Preserved route-free legacy plans while requiring complete route coverage for every newly created plan. Partial coverage is rejected.
- Kept committed duration immutable in session setup. Duration changes use the existing plan-adjustment flow and create a successor route rather than silently changing the active recipe.
- Kept temporary support requests and custom notes as delivery inputs; they cannot silently rewrite method, mode, targets, or time under an old route ID.
- Made deterministic fallbacks honor the committed method, mode, time, targets, and source boundary.
- Restricted the main executable route to a five-minute minimum while retaining the separate two-to-five-minute per-target review recommendation field.
- Added database guards for route-owned parent fields, evidence writes, route coverage, pointer projection, source/mode projection, planned minutes, cache/checkpoint bounds, and account-level lock order.

## Learner-facing result

The learner still sees the existing YOVA flow, but the recipe is now coherent and durable. Home, Agenda, setup, the active session, fallback content, and saved progress cannot each tell a different story about the same session. Existing route-free accounts continue through the compatibility path; new plans use the canonical route path.

This milestone builds the trustworthy foundation. It does **not** yet claim that YOVA has discovered which method is causally best for an individual learner.

## Verification

- Vitest: 309 files passed, 13 skipped; 2,266 tests passed, 55 skipped.
- Desktop Playwright: 43 of 43 core-learning and personalization flows passed.
- ESLint: passed.
- TypeScript `--noEmit`: passed.
- Next.js production build: passed; 43 routes generated.
- `git diff --check`: passed.

The skipped Vitest cases remain opt-in live-model evaluations; they are not silent failures in the deterministic suite.

## Deployment gate

No local PostgreSQL, Docker, or Supabase runtime was available in this workspace. The SQL migrations have contract/static coverage and independent review, but they have not been parsed and executed by a real PostgreSQL server here.

Before deployment, apply migrations `202608230001` through `202608230010` to a disposable database and smoke-test at least:

1. create and activate a fully routed plan;
2. restore an all-route-free legacy plan;
3. reject a partially routed active plan;
4. generate, cache, resume, interrupt, and complete against one exact route revision;
5. create adjustment, review, and continuation successors atomically;
6. archive/restore, save a learner profile, reset learning data, and delete an account under concurrent route activity;
7. export the full route ledger within the account-export bounds.

Deployment should stop if that smoke test exposes a migration parse, trigger-order, permission, or transaction error. It should not be bypassed with a manual data rewrite.

## Intentionally deferred

- The new profile-aware duration algorithm and time-of-day policy.
- Canonical evidence-constrained method eligibility and scoring.
- Consolidated onboarding/profile questions and question-to-decision registry.
- Expanded recognizable method catalog and full learner agency modes.
- Controlled delayed-retention evidence for learner-specific method claims.
- A live PostgreSQL migration execution test in CI.

## Next milestone

Milestone 2 is the deterministic duration engine. It should use the route foundation rather than adding another duration field or prompt:

1. characterize every current duration input and writer;
2. define hard precedence among learner override, available time, task minimum, scheduled-review budget, profile evidence, time of day, and prior completion/exit behavior;
3. compute duration, target capacity, phase budgets, and deferral in code;
4. keep the normal learner choice simple: YOVA chooses, or the learner selects a bounded duration;
5. prove the policy with counterfactual tests before changing the UI.
