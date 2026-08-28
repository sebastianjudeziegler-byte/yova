# Personalization Milestone 2: Deterministic Duration Engine

Status: Study Now vertical complete locally; browser/database release gates and broader plan flows remain
Started: 2026-08-23
Depends on: [`PERSONALIZATION-MILESTONE-1.md`](./PERSONALIZATION-MILESTONE-1.md)

## Objective

Move normal-session duration out of model judgment and fragmented UI state into one deterministic, versioned decision path. The result must be simple for the learner, compatible with the immutable `StudyRoute`, and honest about which input changed the recommendation.

This milestone improves the existing plan and session flows. It does not create a second scheduling product or rebuild YOVA.

## Frozen learner contract

- Normal Learn and Practice sessions use `10`, `15`, `25`, `45`, or `60` active minutes.
- Lightweight reviews stay outside the normal-duration engine. The current runtime uses five- or ten-minute review sessions; any later change to that review policy will be made separately.
- The normal experience remains one obvious recommendation plus a way to change it. The learner does not have to configure an algorithm.
- YOVA may recommend a duration from the task context, the learner's authorized profile signals, schedule fit, and sufficiently repeated comparable outcomes.
- A learner choice applies to the current session or plan decision; it does not silently rewrite the durable profile.
- Explicit available time is always a hard maximum.
- If the available time cannot hold a coherent normal session, YOVA returns an explicit insufficient-time result instead of inventing a broken five-minute lesson.
- Shorter time changes target capacity. Work that no longer fits is visibly deferred; it is never compressed into the same scope or silently dropped.
- A committed duration belongs to the `StudyRoute`. A later material duration change requires a successor route.
- The model may fill subject-specific prose and content slots. It does not choose, revise, or self-report the authoritative duration.

## Current-state characterization

| Surface | Current behavior | Milestone 2 disposition |
|---|---|---|
| Onboarding/profile | A declared range is persisted structurally but reconstructed through profile-summary prose into `15/25/45/60`, defaulting to `25`. | Add a structured authorized-signal adapter. Keep prose as display/model context, not decision authority. |
| Plan Creator | Offers `15/25/45/60`; custom availability also exposes `30`. The selected length is copied into each availability slot. | Separate recommendation or override from each slot's hard capacity, then use the canonical levels. |
| Study Now | Previously offered `15/20/25/40/60` as the answer to “How much time do you have?” | Now offers the canonical `10/15/25/45/60` maxima. The answer remains a hard maximum, the resolved route uses a canonical level, and no new learner question was added. A separate explicit override remains later agency work. |
| Plan generation | The model returns `estimatedMinutes`; code schedules it and checks only that it fits. | Give generation a fixed duration and target budget. Reject or deterministically overwrite conflicting model metadata. |
| StudyRoute | Route timing already wins at read boundaries and is immutable after commitment. | Preserve this as the sole authoritative duration record. |
| Setup and adjustment | Routed setup correctly treats time as committed; plan adjustment creates successors. Several legacy and Agenda paths still accept noncanonical values. | Setup now explains the stored duration source in one sentence. Successors preserve prior duration evidence; an actual learner duration change is labeled `learner_override`. The main adjustment menu offers canonical values while retaining an already-saved legacy value for compatibility. |
| Outcome history | Completion and interruption records contain planned time, active time, progress, feedback, and results. | Use only exact task-and-mode comparable routed outcomes; lower after repeated early exits and raise more cautiously after repeated stable completions. |

## Decision pipeline

### 1. System recommendation

A pure recommender establishes one normal-session level. Its baseline is the learner's authorized sustainable duration when available, otherwise the conservative `25`-minute default.

It may move down by at most one level for a repeated feasibility problem or a strong declared planning constraint. It may move up by at most one level only after four comparable normal-session completions, each completed near plan with at least three scored answers, at least 80% accuracy, and an `about_right` response. Adjustments never stack in one decision.

These thresholds—and the use of declared fatigue risk, starting friction, or schedule-window mismatch to shorten a session—are conservative, versioned product hypotheses. They are not claims about intelligence, biological capacity, or proven individual causal effects. Instrumentation and later outcome evaluation must be able to revise or remove them.

Task family and Learn/Practice mode define comparability now. Target load and method minimums will affect coherent capacity and deferral after those contracts exist; this milestone must not invent a faux-precise task-duration table.

### 2. Agency and hard-cap precedence

The system recommendation then passes through one fixed precedence boundary:

1. a one-session learner override replaces the recommendation;
2. explicit available time caps either choice;
3. arbitrary caps floor to the largest canonical duration that fits;
4. less than ten available minutes returns `insufficient_time` for a normal session.

This boundary does not handle reviews, breaks, phase allocation, or target splitting.

### 3. Capacity, phases, and deferral

Code will use the resolved active minutes to determine:

- the maximum coherent active targets;
- ordered phase budgets that sum exactly to active minutes;
- activity limits and any optional break boundary;
- which lower-priority targets are visibly deferred.

This layer must preserve Learn versus Practice, method fidelity, source requirements, and completion evidence. It cannot make a session fit by deleting its independent check.

### 4. Route commitment and generation

The complete timing and execution recipe is written into a provisional `StudyRoute` before subject-content generation. Generation receives fixed slots and may not change the duration, target IDs, phase order, or deferral decision. Activation commits the reviewed route through the existing Milestone 1 transaction.

Production activation also requires a short-lived, server-only HMAC receipt over the exact parsed plan, normalized setup contract, authenticated account, issuance time, expiry, and signing-key ID. This prevents a browser from coherently rewriting the route and its provenance before commitment without adding another model call. Development preview remains structural-only.

## Implementation slices

1. **Normal-duration precedence — implemented locally.** Pure canonical levels, learner override, hard cap, insufficient-time result, immutable rule trace.
2. **System recommendation — implemented locally.** Structured, signal-specific profile provenance; normal-session-only comparable outcomes; duplicate-evidence rejection; truthful outcome-adjustment provenance; and bounded one-level changes.
3. **Authorized signal adapter — implemented locally.** Reads structured profile fields and exact route-bound outcome records, honors controls and exclusions, and fails closed when an explicitly stored authorization state is malformed or from an unsupported version.
4. **Capacity and phase composer — partially implemented for Study Now.** The resolved duration reaches the existing deterministic content budget before the final route is built, reduces active targets, records visible deferral, and preserves exact phase sums. A shared multi-method composer remains broader work.
5. **Pre-generation duration scaffold — implemented locally for Study Now.** A server-owned decision sidecar fixes timing before the final preview content budget and route materialization. No language-model output owns the duration in this path.
6. **Study Now system-decision vertical — implemented locally.** Reuses the compact “time available” interaction as a hard cap, loads only authorized profile/history signals, records versioned provenance, rejects sub-ten-minute normal sessions before provider work, and degrades to the deterministic default if context loading fails. An explicit one-session learner override remains future agency work.
7. **Draft authenticity and successor provenance — implemented locally.** Every production plan draft is signed before it leaves the server; activation rejects missing, expired, cross-account, setup-altered, or plan-altered receipts before persistence. A successor preserves existing timing/profile/rule history when duration is unchanged, and requires an explicit current decision plus trace when duration changes.
8. **Bounded observability — implemented locally.** Study Now records only context status/reason, duration source, chosen minutes, hard maximum, task family, and Learn/Practice mode. It never records profile answers, learner content, or outcome evidence references in generation telemetry.
9. **Counterfactual and browser gates.** Hold task and history fixed while varying one signal; then prove recommendation, override, cap, deferral, persistence, generation, Home, Agenda, setup, and completion agree.

## Safeguards

- No hidden use of ignored, corrected, or disabled profile signals.
- The self-report control governs declared sustainable duration; the timing control separately governs preferred-window fit. Turning either off removes only the corresponding inputs.
- No cross-task or cross-mode outcome comparison.
- No duration increase from one completion, unscored work, low accuracy, a `too_difficult` result, or merely having extra time available.
- No stacking several negative signals into a multi-level drop.
- No learning-style, diagnosis, chronotype, or fixed-ability claim.
- No scheduled-review conversion into a normal session.
- No direct `plan_sessions.estimated_minutes` mutation for routed work.
- No second model call to judge whether a deterministic duration decision is valid.
- The self-report and timing controls are independent: disabling declared-profile inputs does not silently disable an otherwise authorized time-window input.
- A stored route identifies the bounded revision of the profile row used for the decision, not only the profile schema version.

## Acceptance requirements

Milestone 2 is complete only when tests prove:

1. identical authorized inputs produce the same recommendation and rule trace;
2. a single changed profile, schedule, behavior, override, or availability signal changes only its permitted fields;
3. learner override beats the recommendation and the hard maximum beats both;
4. shorter durations reduce or defer scope while preserving a coherent method and independent evidence;
5. plan, route, generated resource, cache, Home, Agenda, setup, checkpoint, and completion use the exact same duration;
6. scheduled reviews remain on the lightweight path;
7. the model cannot change a code-owned duration;
8. existing route-free plans retain a bounded compatibility path;
9. the deterministic suite, production build, and learner-flow browser suite remain green.

## Current local verification

- Vitest: 319 files passed, 13 skipped; 2,399 tests passed, 55 skipped.
- TypeScript `--noEmit`: passed.
- ESLint: passed.
- Next.js production build: passed; 43 routes generated.
- Local desktop browser acceptance now passes 44 of 44 core-learning and personalization tests, including canonical time choices, signed draft activation in production code paths, route-owned setup time, adjustment, fallback, checkpoint, and reload behavior. The authenticated cloud/database matrix below remains pending.

## Deployment relationship

Milestone 2 may continue locally, but no combined deployment should bypass Milestone 1's outstanding gate: migrations `202608230001` through `202608230010` must first parse and pass the documented smoke scenarios on disposable PostgreSQL/Supabase.

Before a production release:

1. run migrations `202608230001` through `202608230010` against disposable PostgreSQL/Supabase and pass the Milestone 1 transaction, permission, trigger, and rollback scenarios;
2. configure a private `YOVA_DRAFT_RECEIPT_SECRET` of at least 32 characters, with `YOVA_DRAFT_RECEIPT_PREVIOUS_SECRET` used only for bounded key rotation;
3. run the signed-in browser matrix for profile recommendation, repeated-outcome adjustment, availability cap, insufficient time, activation, reload, setup, checkpoint, completion, and learner override;
4. release the generate, client, and activate changes together so an older open draft receives the explicit rebuild path instead of bypassing receipt verification.

The current workspace has no available disposable PostgreSQL/Supabase runtime or published environment. Those gates are intentionally still open; no migration, deployment, or production secret change has been performed from this task.
