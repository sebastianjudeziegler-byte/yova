# Personalization Milestone 4: Deterministic Normal-Plan Composer

Status: implemented and verified locally; release and real-database gates remain
Started: 2026-08-24
Depends on: [`PERSONALIZATION-MILESTONE-3.md`](./PERSONALIZATION-MILESTONE-3.md)

## Objective

Move the normal multi-session plan's computable structure out of generated prose and into one deterministic, versioned path. This extends YOVA's existing plan flow; it does not create a second planner or add learner-facing setup.

## Completed architecture

### Deterministic session envelopes

`normal_plan_envelope_composer_v1` now builds the normal plan before any plan-copy request. From the accepted knowledge map, explicit Learn or Practice recommendation, authorized duration context, learner availability, and one server-owned clock, code owns:

- stable envelope identity and sequence;
- exact topic grouping and prerequisite order;
- per-target and per-session Learn versus Practice mode;
- canonical active minutes, hard availability maximum, and content budget;
- chronological schedule placement;
- required later Practice after Learn-first coverage;
- explicit accepted-map, prerequisite, session-cap, deadline, and availability deferrals;
- rule traces and evidence references used by later routing.

The shared availability boundary first converts repeating learner-local windows into exact occurrences, then canonicalizes overlapping or connected declarations into one chronological elapsed-time union. This prevents duplicate capacity, preserves exact deadline clipping, and lets multiple sessions use one occurrence only while a coherent normal session still fits.

The mode kernel is evidence-first and target-specific. Confirmed placement gaps outrank older status, exact demonstrations and recorded encounters permit Practice without claiming mastery, unobserved targets follow the explicit starting recommendation, and later attempts become Practice. Provider titles, objectives, labels, and profile prose cannot choose mode.

Duration, schedule, grouping, and deferral attribution are also code-owned. Deadline attribution uses the actual post-placement cursor: a deadline receives responsibility only when removing it exposes another schedulable canonical normal session, not merely a few additional raw minutes.

### Prose-only generation and deterministic fallback

Normal plans expose one strict, envelope-keyed provider-fill schema. Provider-owned display copy is limited to the plan title, topic summary, rationale, and each fixed session title. Objective and evidence compatibility strings remain required at the provider boundary, but code discards them and installs a deterministic target-bound objective plus one code-owned completion check per target before materialization. The provider cannot return session arrays or choose IDs, targets, mode, timing, grouping, schedule, method, evidence ownership, or deferrals.

When OpenAI is configured, the normal-plan path makes one prose-only call with no repair call. If that call fails or its fill cannot cross the strict boundary, YOVA uses deterministic copy for the exact same envelope composition. The no-configuration path uses that same fixed composition and deterministic fill; live and fallback generation do not maintain separate structural planners.

Provider display prose is not prompt authority for later guided-session generation. For a deterministic normal-envelope route, YOVA reconstructs the prompt-facing goal, topic, fixed rationale, current-session title, and neighboring journey copy from accepted-map topics and code-owned content targets. The operational objective and evidence contract come from the immutable `StudyRoute`, so adversarial or merely imprecise display copy cannot redirect the lesson.

### Atomic route materialization

The fixed fill and its originating composition cross one atomic normal-plan pipeline. It:

1. binds only safe prose into the fixed slots;
2. materializes route-free pending sessions without changing envelope structure;
3. projects every envelope into an exact provisional `StudyRoute`;
4. preserves code-owned task family, target state, mode, schedule, duration, content budget, and provenance;
5. applies the existing canonical method selection and phase/runtime routing;
6. rejects any pending method scaffold or envelope mismatch before returning the draft.

The existing activation boundary is unchanged. The server still validates the learner-facing response, signs the draft receipt, and relies on the existing activation and immutable route-persistence flow.

## Fallback parity and retained legacy boundary

Accepted-map normal plans keep the same fixed-envelope structure when in-memory allowance is exhausted, the durable reservation result is unknown, or the account allowance is spent. Those cases record a bounded fallback notice and continue through the same composition, deterministic fill, and atomic route pipeline without calling the provider, map generator, or legacy planner. Durable operation conflicts still return `409`, and diagnostic-only requests retain their explicit allowance and reservation responses.

The reliable preview fallback remains only when a pre-composition failure occurs before an accepted knowledge map exists. In local no-provider development, the preview planner may also seed deterministic semantic topic labels; it receives a deadline-free synthetic horizon and has no authority over the real schedule or capacity decision. The accepted map then enters the normal composer using the learner's original deadline and availability. Once accepted-map composition begins, the normal-plan path does not call the legacy plan generator, repair, normalizer, aligner, or preview scheduler.

## Explicitly outside this first composer

- scheduled five- or ten-minute reviews;
- automatic mutation of committed routes;
- broad plan-adjustment unification;
- learner mode customization;
- new mastery thresholds;
- individual causal “best method” claims;
- expanding the method catalog.

Post-session mode adaptation must later be constrained to overlapping target IDs. Results from target A may change support, but must not silently turn unrelated target B from Practice into Learn.

## Current verification

- Full Vitest: 340 files passed and 13 skipped; 2,642 tests passed and 55 skipped.
- Desktop Playwright (`core-learning-loop` plus `personalization`): 46 of 46 scenarios passed.
- TypeScript `--noEmit`: passed.
- Full ESLint: passed.
- Production Next.js build: passed, including static generation for 45 routes.
- `git diff --check`: passed.
- Real-database verification: not run and not claimed.

Milestone 4 is included in the personalization revamp branch. Nothing has been deployed or published.

## Release relationship

The isolated Supabase/PostgreSQL workflow in GitHub Actions is the immediate database gate for the reviewed branch. A pull request runs the complete migration replay, database linting, and the transactional pgTAP boundary suite. That real-database job has not yet completed for this snapshot. No migration has been applied to a linked or production database as part of this milestone.
