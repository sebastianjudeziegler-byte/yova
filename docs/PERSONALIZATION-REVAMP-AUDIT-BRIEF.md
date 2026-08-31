# YOVA Personalization Revamp: Audit Scope

Status: audit handoff derived from the frozen product contract
Canonical source: [`PERSONALIZATION-SYSTEM-SPEC.md`](./PERSONALIZATION-SYSTEM-SPEC.md)
Audit date: August 31, 2026

## 1. Purpose and authority

This document tells an independent reviewer what the full personalization revamp was intended to deliver. Use it to audit the current code, database boundaries, automated tests, and browser behavior. It is a condensed audit companion, not a replacement for the canonical specification.

If sources disagree, use this order:

1. the later explicit product decisions in **Section 2** of this document;
2. [`PERSONALIZATION-SYSTEM-SPEC.md`](./PERSONALIZATION-SYSTEM-SPEC.md), the frozen product and implementation contract;
3. [`STUDY-ROUTE-IMPACT-MAP.md`](./STUDY-ROUTE-IMPACT-MAP.md), for persistence and migration topology;
4. the milestone documents, which are historical implementation snapshots rather than the final scope;
5. current code and tests, which are evidence of implementation, not authority to silently narrow the product contract.

Audit the target behavior even when it is behind a rollout gate. Do not equate “not enabled in production” with “not implemented.” Conversely, do not treat schemas, types, fixtures, or disabled flags as a finished learner experience.

## 2. Later product decisions that supersede the frozen specification

### 2.1 Blurting and Broad Recall were removed

The original specification included Blurting as a future retrieval variant. That decision was superseded. The Blurting/Broad Recall application runtime, UI, generation path, and named source files were intentionally deleted and are **not part of the required revamp**.

An audit must not report the missing Blurting experience as incomplete work. The following are intentionally retained and are not evidence that the feature should still exist:

- append-only historical database migrations;
- database containment for historical payloads;
- a narrow compatibility parser that ignores a previously saved `activityProgress.kind === "broad_recall"` marker while preserving the surrounding checkpoint or interruption, so an affected learner can still resume or exit.

No new Blurting runtime or activation work should be recommended.

### 2.2 Production personalization issuance is intentionally at zero percent

`YOVA_PERSONALIZATION_ROLLOUT_PERCENT=0` is an approved fail-closed production setting. Production should currently issue the task-and-mastery baseline for new routes. This does not reduce the implementation scope: the personalized route must still be complete and testable in an isolated local, preview, or QA environment with the rollout explicitly enabled.

Do not change the production rollout percentage as part of an audit.

## 3. Product outcome

YOVA is meant to be a closed-loop study-orchestration system, not merely a content generator. For each learning goal, it should deterministically choose and persist the next defensible study route:

- Learn or Practice;
- the dominant learning method;
- execution inside or outside YOVA;
- content targets and their individual knowledge states;
- phase order, difficulty, support, and completion evidence;
- active and elapsed duration;
- deferral and later review;
- the learner's level of control;
- a truthful, concise explanation of why that route was selected.

The system then runs that route, records trustworthy outcomes, and uses comparable evidence to improve later decisions. Learner declarations may materially change an eligible method, duration, support, or presentation. They must not override task safety, source authority, demonstrated knowledge, accessibility constraints, or explicit available time.

The intended learner-facing claim is:

> Built from you. Refined by results.

The product may say it recommends or builds an evidence-constrained route. It must not claim that a route or method is proven to be the universally best way for that learner.

## 4. Non-negotiable architecture and safety rules

An implementation is incomplete or incorrect if any of these are violated.

1. **One route, everywhere.** Plan, Home, Agenda, Setup, generation, active session, cached resource, checkpoint, completion, recovery, and later evidence must use the same immutable committed `StudyRoute` revision.
2. **Code owns computable decisions.** Code—not a model—owns route identity, target identity, Learn/Practice, method eligibility and selection, duration, phase count/order/budgets, support bounds, scheduling, deferral, validation, persistence, and fallback choice.
3. **Models fill semantic slots only.** A model may create bounded, source-grounded explanations, examples, questions, feedback, and formative semantic judgments inside a fixed route. It may not rewrite the route.
4. **Persist before generation.** Subject-specific content generation consumes an already validated route. Provider prose cannot become routing authority.
5. **Personalize the intervention, not the learner's identity.** No fixed learning-style, intelligence, personality, diagnosis, neurotype, or permanent “brain type” labels.
6. **No manufactured personalization.** Missing relevant evidence produces a stable task-and-mastery baseline. Identical relevant inputs must produce the same route.
7. **Evidence stays target-bound.** Any event capable of changing knowledge must carry a trustworthy stable target ID. Unmapped evidence may support execution analytics only.
8. **One dominant method.** A normal session has one primary method and at most one learner-visible supporting technique with a specific job.
9. **Preferences never widen eligibility.** Profile signals, outcome evidence, and learner choice rank only methods that survive task, stage, mode, source, time, accessibility, and runtime checks.
10. **No fabricated fallback.** When trustworthy teaching content is unavailable, show a source-independent setup action or ask for readable material instead of inventing grounded claims.
11. **Committed history is immutable.** A material change creates a provisional successor and, when authorized, a new committed revision that supersedes rather than mutates the old one.
12. **Database and server boundaries mirror the domain.** A direct authenticated client must not be able to forge a route, evidence authority, method choice, lifecycle transition, or agency confirmation that TypeScript would reject.

## 5. Canonical StudyRoute scope

Every planned or active normal session should have a versioned route containing, at minimum:

- immutable lineage, revision, schema, lifecycle, plan, and session identity;
- task family, desired outcome, source requirements, and per-target stage, uncertainty, evidence references, and review state;
- Learn/Practice mode, inside/outside execution environment, primary method, visible name, optional supporting technique, and decision confidence;
- active minutes, elapsed minutes, duration source, hard cap, and optional timed break;
- ordered phases, difficulty, initial support, activity limit, completion evidence, and explicit deferred targets;
- control mode, selection authority, bounded alternatives, and override provenance;
- a short reason separated into task requirements, learner declarations, observations, and uncertainties;
- router, profile, and policy versions, route-level `evidenceRefs`, and an auditable rule trace.

Lifecycle expectations:

- **Provisional:** candidate before plan acceptance or required change confirmation.
- **Committed:** sole authority consumed by every surface and runtime.
- **Superseded:** immutable historical revision retained for explanation, cache provenance, and outcome comparison.
- A no-op feasibility check keeps the current revision.
- A material change to target, mode, environment, method, duration, phase order, support, or review contract creates a successor.
- Evidence attaches to the exact committed revision actually used.

Mixed-target expectations:

- each target retains its own stage, uncertainty, evidence, and review state;
- compatible targets may share one dominant route with target-specific support;
- incompatible targets must be split or explicitly deferred, never collapsed into a fictitious session-wide state;
- generated activities and evaluations retain exact target bindings.

## 6. Deterministic routing pipeline

The required pipeline is:

1. **Establish the learning job.** A bounded model may propose source-anchored targets or task labels; code validates anchors, assigns stable IDs, deduplicates, preserves prerequisites, resolves each target's evidence state, and determines the Learn/Practice recommendation.
2. **Apply hard eligibility.** Remove methods that conflict with mode, task family, target stage, source requirements, assessment format, accessibility, available time, or a coherent executable recipe.
3. **Rank survivors.** Use task/stage affinity, authorized profile signals, self-reported success, exact comparable outcome evidence, feasibility, continuity, and explicit preference. Preserve a deterministic baseline order.
4. **Apply feasibility and duration.** Choose duration, phase budgets, support, activity count, optional break, and target deferral. Explicit availability is a hard cap.
5. **Validate.** Check lifecycle, method/mode/environment compatibility, exact phases and minutes, target coverage/deferral, source grounding, support and difficulty bounds, completion evidence, and truthful provenance.
6. **Persist.** Commit the authoritative route before subject-specific generation.
7. **Fill semantic slots.** Give the provider exact targets, bounded source excerpts, the fixed recipe, interaction types, and support/difficulty limits.
8. **Update from outcomes.** Update target knowledge, uncertainty, support, repair, review timing, and later route recommendations only from evidence with the required authority.

The selector is a gate-and-precedence policy, not an additive score that allows weak signals to accumulate past a safety boundary. Its order is:

1. hard eligibility;
2. an existing committed route;
3. a deliberate learner choice among eligible candidates;
4. qualifying exact-cohort observed outcomes;
5. an authorized learner declaration/profile preference;
6. eligible continuity;
7. bounded legacy compatibility;
8. the deterministic task baseline.

The initial task families are memorization, conceptual learning, problem solving, reading to quiz, writing and argumentation, programming, and mixed assessment.

If route validation fails, choose the deterministic baseline for the same task, target snapshot, mode, and duration. Do not ask a model to repair a pedagogical route.

## 7. Learn, Practice, and execution environment

Only two primary cognitive modes should be learner-facing:

- **Learn:** diagnose or establish the model, teach/demonstrate, guide, fade help, and end with an independent check.
- **Practice:** begin with unsupported retrieval/application, expose a gap, insert bounded repair if needed, retry or transfer, and schedule a return when appropriate.

Exam-like work is an option within Practice, not a third mode. Repair is internal behavior, not a third mode.

Execution environment is a separate decision:

- **Inside YOVA:** YOVA presents the content and interactions.
- **Outside YOVA:** YOVA provides exact steps for work performed with a trusted external source, workbook, editor, assignment, or physical workspace.

Outside completion is execution evidence, not mastery evidence, unless YOVA obtains a valid independent knowledge check. Changing execution environment is material and must not reuse incompatible generated content.

## 8. Method catalog and fidelity

The required recognizable catalog, after the removal of Blurting, is:

| Learner-facing method | Stable basis or required recipe |
| --- | --- |
| Worked Examples | complete model, guided completion, fading, independent transfer |
| Feynman Technique | plain-language explanation, source comparison, repair, explain again |
| SQ3R | survey, question, bounded reading, closed-source recall, review |
| Pretesting | brief diagnostic attempt, instruction/model, feedback, later independent check |
| Concept Mapping | retrieve concepts, connect relationships, verify evidence, repair |
| Active Recall | unsupported retrieval, feedback, corrective retrieval |
| Spaced Repetition | scheduled retrieval with misses returned sooner |
| Practice Tests | representative unsupported set, confidence, error classification, repair |
| Practice Problems | independent application, feedback when an error is observed, changed-context transfer |
| Interleaving | mixed related types, method selection, discrimination, error review |
| Outline from Memory | retrieve claim and structure, verify evidence, draft |
| Trace–Code–Test | trace a model, predict, complete missing code, build or debug independently |

Audit requirements:

- learner-facing names map consistently to stable internal IDs;
- every eligible task × target stage × Learn/Practice × allowed duration combination has one executable, validator-approved recipe;
- each method enforces its defining phase order and interactions rather than changing only the label;
- Pretesting is diagnostic: its pre-instruction answer must not count as prior mastery or method-success evidence;
- Practice Problems inserts error-specific repair only after an observed error, not unconditionally;
- Concept Mapping has a real relationship-building runtime and interaction, not generic prose with a different label;
- Feynman and SQ3R enforce their complete recipes;
- flashcards remain a retrieval interface, Pomodoro/timed breaks remain timing, and neither becomes a competing learning method;
- generated content, fallback, cache, hydration, and completion preserve the exact committed method and revision.

## 9. Duration and session shaping

Normal visible duration levels are 10, 15, 25, 45, and 60 minutes. Scheduled retrieval reviews remain lightweight at approximately 2–5 minutes.

Duration may use the task, target count/stage, coherent method minimum, sustainable session length, starting friction, stamina, declared work periods, schedule/deadline, explicit available minutes, and recent completion/early-exit/active-time history.

Required behavior:

- explicit availability is never exceeded;
- a manual duration choice affects only the current session;
- a method's minimum coherent recipe must fit, or the method is ineligible / work is coherently split;
- target deferral is explicit and visible in Agenda, never invisibly scheduled;
- repeated meaningful early exits or successful completions move the recommendation by at most one duration level per update;
- a five-minute first action may exist inside a longer route for starting friction;
- optional timed breaks occur only at eligible boundaries, distinguish active from elapsed time, respect hard elapsed caps, and do not trigger another content-generation call.

## 10. Canonical learner profile and consent

The intended product has one canonical global profile/questionnaire rather than overlapping onboarding, public Study Profile, and deeper profile systems.

The frozen scope calls for approximately 8–12 non-branching questions; the current canonical implementation chose 11. Each question must define:

- the signal captured;
- which decision it may change;
- its maximum authority;
- what explanation may be shown;
- what future evidence may confirm or contradict it;
- how the learner can correct or stop using it.

The question set should cover control preference, starting friction, sustainable session length, entry into unfamiliar material, approaches associated with lasting success, common post-study breakdowns, first repair preference, workspace structure, focus/pacing, preferred working periods, and optional functional/accessibility support.

Profile requirements:

- support **Depends** and **Not sure** instead of forcing certainty;
- never infer a diagnosis, personality, intelligence, neurotype, fixed learning style, or chronotype;
- treat temporary energy/stress/readiness as optional, quiet, expiring context rather than identity;
- migrate semantically compatible legacy answers; leave missing answers unknown;
- never force an existing learner through another long questionnaire before studying;
- preserve historical data while removing active v1 experiments from routing;
- keep detailed profile information in You and show only the route-relevant reason on session surfaces;
- let the learner pause and re-enable self-report personalization; paused signals must not drive routing or continue to appear as active workspace personalization;
- allow the public canonical profile to import into a new signed-in account without repeating onboarding or losing the validated draft.

## 11. Learner agency

All three modes use the same eligibility, route, lifecycle, and persistence boundaries.

### YOVA Decides

- YOVA selects the recommended valid route.
- A sufficiently supported change may apply automatically only between sessions.
- The learner sees what changed before starting and retains a Change control.

### Help Me Choose

- Show the recommendation and at most two defensible alternatives.
- Explain the task-relevant tradeoff of each.
- A major/system-proposed change remains provisional until the learner confirms the exact candidate revision.

### I'll Customize

- Show eligible methods first.
- Preserve the learner's valid selection for that session unless it becomes impossible or unsafe.
- Make bounded “Other methods” discoverable rather than silently hiding every questionable request.
- Explain conflicts and map a request to the closest safe implementation when appropriate.
- A system recommendation is separate from the learner's committed choice and is not silently applied.

Agency authorization must hold across draft choice, committed ready-session choice, post-session adaptation, retries, stale revisions, and direct database/API calls. A confirmation for one candidate cannot authorize another. A learner choice cannot manufacture profile/evidence provenance.

## 12. Visible personalization and cross-surface consistency

The default UI should remain quiet.

Collapsed Home and Agenda cards show:

- Learn or Practice;
- primary method;
- total duration;
- one short reason;
- one obvious Start/Continue action and a secondary Change action where allowed.

Expanded Setup/recipe disclosure shows:

- named phases and minutes;
- active versus elapsed time when relevant;
- what the task requires;
- what the learner told YOVA;
- what YOVA observed;
- what remains uncertain;
- up to two alternatives;
- what changed from the preceding route.

After a session, a concise receipt separates:

- **You said**;
- **YOVA saw**;
- **Next change**;
- **Not sure yet**.

All rationale copy must be projected from the actual rule trace. Plan, Home, Agenda, Setup, active session, saved resource, completion receipt, recovery, and later evidence must agree on mode, method, duration, targets, and committed route revision.

## 13. Evidence and adaptation

Primary learning outcomes are delayed retention, independent application/transfer, independent performance without excessive support, and learning achieved per active minute. Initiation, completion, abandonment, actual duration, confidence calibration, and perceived difficulty are feasibility signals, not interchangeable mastery evidence.

Strong method evidence must be grouped by an exact, privacy-safe comparison cohort covering:

- task family;
- knowledge stage;
- Learn/Practice mode;
- execution environment;
- difficulty;
- duration band;
- initial support;
- target relationship/shape;
- independent assessment type.

The current exact v1 threshold is at least four comparable completed sessions, twelve checked answers, and two distinct study days. Evidence is limited to the last 90 days, the latest eight sessions retained per exact method/cohort, and one completion per exact route revision. Reviews are excluded, and route, resource, duration, target, and independent-check authority must agree. A positive method-ranking signal additionally requires at least 80% check accuracy and no more than half of the included sessions rated too difficult. A single session or answer cannot create a strong personal-method conclusion. Negative or incomplete results should first change support, repair, or review timing rather than immediately declaring a method unsuitable.

Semantic evaluation requirements:

- deterministic evaluation is preferred when possible;
- bounded model evaluation must support an explicit `uncertain` state;
- uncertain or failed evaluation may reveal a reference and provide cautious feedback;
- it must not mark a target secure/in need of repair, change knowledge state, enter method-outcome comparison, support a personal-method claim, or silently count as correct/incorrect;
- diagnostic Pretesting work is likewise excluded from mastery evidence.

Claims remain observational. “Recent comparable results support this recommendation” is permitted. “This is proven to be your best method” is not.

Short-review requirements:

- reviews are approximately 2–5 minutes and normally use retrieval through a cheap, validated interaction;
- concept evidence may schedule them automatically, but they remain visible on Home and Agenda and the learner may move or remove them;
- they use cached items or deterministic templates when possible rather than a full session-generation call;
- a miss may trigger bounded repair or recommend a larger Learn/Practice session without turning the review itself into a full hidden session.

## 14. Reliability, fallback, cost, and privacy

For each generation operation:

1. validate the first structured result;
2. retry at most once when the failure is classified as likely to benefit from retry and the route budget permits it;
3. use a valid result or deterministic route-preserving fallback;
4. keep source-backed fallback inside the exact authorized targets and explicitly defer unsupported targets;
5. if no trustworthy source/teaching exists, offer an actionable source-independent setup path rather than fabricated content;
6. preserve the committed route, method, targets, phase contract, and provenance;
7. record privacy-safe attempts, aggregate tokens, latency, failure stage/cause, fallback use, cache reuse, and persistence outcome.

A cache hit should not create provider attempts or token usage. Retry/fallback telemetry must include all attempts rather than only the last one. Raw learner material, answers, provider messages, prompts, source prose, and private identifiers must not be placed in observability payloads.

Short scheduled reviews should normally use cached items or deterministic templates and should not make a full session-generation call.

## 15. Controlled rollout and rollback

New route issuance is controlled by a server-only percentage flag and versioned policy:

- policy: `personalization_rollout_v1`;
- baseline route version: `task_mastery_v1`;
- personalized route version: `personalized_v1`.

Required behavior:

- stable subject-based cohort assignment for new routes;
- no profile or observed-method inputs in the baseline cohort;
- the baseline remains a strong task-and-mastery router, not a broken or random path;
- existing versioned routes retain their original assignment when the percentage changes;
- rollback stops new personalized issuance without mutating committed routes;
- the route provenance records the rollout policy/version used;
- system status reports whether configuration is missing, invalid, baseline, staged, or full without exposing a learner's cohort;
- active hidden/randomized method experiments are not part of v1.

Production at zero percent is therefore expected to demonstrate baseline safety and cross-surface integrity. Personalized counterfactuals must be tested with explicit isolated configuration, not by changing production.

## 16. Required code and database audit

For each requirement above, inspect the executable implementation rather than relying on names or comments. At minimum, trace:

1. plan creation → provisional routes → signed activation → committed DB rows;
2. Study Now and normal multi-session issuance through the same canonical selector;
3. readiness/session-time feasibility and successor creation;
4. Home, Agenda, Setup, session runtime, cache, checkpoint, completion, and recovery reads;
5. profile answer validation, legacy migration, consent/disable behavior, and authorized projection into routing;
6. method eligibility, exact recipe fidelity, runtime capability, duration feasibility, and fallback compatibility for every catalog method;
7. draft, committed, “Other methods,” and post-session agency transitions at both API and PostgreSQL boundaries;
8. evidence creation, exact comparison keys, thresholding, uncertain-evaluation exclusion, Pretesting exclusion, and delayed review;
9. provider call ceilings, deadlines, token aggregation, cache behavior, fallback source authority, and privacy-safe telemetry;
10. rollout assignment, provenance, baseline input suppression, existing-route stability, readiness, and rollback.

Flag any TypeScript/PostgreSQL contract drift, direct authenticated-call bypass, route reconstruction from display prose, duplicate source of truth, permissive legacy path that reaches a new route, or test that validates only source strings while the real transaction remains unexecuted.

## 17. Required browser audit matrix

Run browser journeys in an isolated environment with deterministic fixtures where necessary. Preserve production at zero percent.

### Baseline and profile

1. At rollout 0, create the same plan with materially different profile signals; named method routing must remain the deterministic task-and-mastery baseline while explicit control preference and hard accessibility/time constraints still behave truthfully.
2. Complete the public canonical 11-question profile, create/sign into a new account, import the exact answers, skip duplicate onboarding, view the summary in You, pause self-report personalization, and re-enable it.
3. Open an existing migrated account with partial legacy answers; studying must remain available without forced re-onboarding.

Also open and resume a pre-revamp plan/session that has no native current-version route. Its bounded compatibility path must preserve learner work, create no false evidence, and converge safely on current route authority rather than reconstructing decisions from old display prose.

### Personalized counterfactuals

4. In local/QA with rollout 100, hold task, material, deadline, available time, requested mode, and account history fixed; change exactly one authorized profile signal and verify only the decision dimensions it is allowed to influence change, with truthful provenance.
5. Repeat with an exact qualifying outcome-evidence cohort; verify mismatched cohorts and sub-threshold evidence are inert.
6. Repeat identical inputs and verify deterministic method, duration, phases, reason, alternatives, and route version.

### Agency

7. YOVA Decides: observe a supported between-session recommendation change, verify it becomes a successor and the UI identifies what changed before Start.
8. Help Me Choose: verify no major candidate commits before exact confirmation; reject stale or different-candidate confirmation.
9. I'll Customize: select a valid alternative, reload, and verify it persists. Exercise Other methods, safe mapping, an unsafe/ineligible request, and stale parallel choice.

### Route integrity and methods

10. For representative Learn and Practice plans, compare Plan, Home, Agenda, Setup, generated session, checkpoint/reload, completion, and receipt; all must show the same committed route facts.
11. Exercise every newly added/exact-recipe method at its shortest supported duration and verify its defining interactions and phase order, not only its label.
12. Exercise mixed-stage targets: compatible targets receive target-specific support; incompatible targets split or defer with the deferred work visible in Agenda.
13. Exercise inside- and outside-YOVA routes. Outside completion alone must not advance mastery. Changing execution environment must create a successor revision and must reject incompatible cached/generated content. Exercise an explicit learner-initiated Learn↔Practice change and verify the agency policy, route revision, recipe, and evidence contract all change together without mutating an active session.

### Duration, evidence, and failures

14. Verify hard available-time caps, current-session-only manual override, coherent deferral, one-level early-exit/completion adjustment, and timed-break insertion without content regeneration.
15. Submit correct, incorrect, uncertain, and evaluator-failure answers. Confirm only authoritative outcomes affect knowledge, completion statistics, method evidence, and later recommendations. Verify an ordinary authoritative miss changes support and review timing immediately without making an unsupported personal-method claim.
16. Force first provider failure followed by success; then force two failures with source material; then force two failures without trustworthy material. Verify at most two calls, exact route preservation, real source-grounded fallback where possible, and actionable no-source UX otherwise.
17. Verify cache reuse, reload, Continue → Exit → Save, and an old raw Broad Recall checkpoint marker. The old marker must be ignored without reviving the removed runtime or losing the surrounding recovery state.

### Optional production-only observation at rollout 0

18. Only with separate explicit authorization and a designated production test account, run one signed-in plan creation and one Learn session. Record the route, generation headers/telemetry available to the client, whether content was genuinely generated or a deterministic fallback, persistence, cache/reload behavior, and any user-visible warning. Omit this step when production writes are not authorized. Do not claim it tests profile-driven method selection while rollout is zero.

## 18. Required acceptance conclusions

The first release is complete only if a learner can:

1. create or open a plan without losing established YOVA behavior;
2. see a concise Learn/Practice recommendation with recognizable method and duration;
3. understand the real reason without opening a technical dashboard;
4. accept it, choose bounded alternatives, or customize it;
5. complete a structurally reliable, source-grounded session;
6. receive immediate support and review changes from demonstrated gaps;
7. return to a consistent route on Home and Agenda;
8. see declarations, observations, and uncertainty distinguished;
9. receive meaningfully different routes when an authorized profile or outcome signal differs;
10. receive no arbitrary difference when relevant evidence is the same.

Engineering completion also requires deterministic unit tests, TypeScript/API/SQL integration tests, full migration replay and pgTAP, cross-surface browser journeys, failure-path tests, route-version migration tests, cost instrumentation, and production-safe rollout/rollback.

## 19. Deliberately deferred or out of scope

Do not report these as missing first-release work:

- Blurting/Broad Recall runtime or UI;
- randomized, bandit-driven, or hidden method experimentation;
- causal individual “best method” claims;
- learner-facing evidence-expiration/reset controls;
- Flowtime or a large productivity-method catalog;
- mandatory daily mood, stress, or energy check-ins;
- personality, diagnosis, neurotype, learning-style, intelligence, or chronotype inference;
- a separate exam mode;
- multiple permanent subject-specific profiles;
- automatic invisible scheduling of deferred work;
- a dense visualization dashboard on every surface;
- changing production personalization rollout above zero as part of the audit.

## 20. How to classify audit findings

Use exactly one status for each requirement:

- **Complete:** production code, persistence boundary, and meaningful automated/browser coverage exist.
- **Partial:** a usable vertical exists, but a named surface, authority boundary, failure case, or acceptance test is missing.
- **Scaffolding only:** types, pure helpers, flags, schemas, or source-string tests exist without an end-to-end learner path.
- **Missing:** no meaningful implementation exists.
- **Broken:** implementation exists but violates the contract or fails in a supported path.
- **Rollout-disabled:** implementation appears complete, but new issuance is intentionally disabled by the server-owned rollout setting.
- **Intentionally deferred:** Section 19 excludes it from v1.
- **Superseded:** the Blurting/Broad Recall product scope was removed by a later decision.

For every Partial, Scaffolding only, Missing, or Broken finding, report:

- severity: release blocker, high, medium, or low;
- exact requirement from this document;
- code/database evidence with file and line references;
- the browser journey or test that proves the gap;
- learner/data/reliability impact;
- the smallest bounded fix;
- tests needed to prove the fix;
- whether rollout 0 masks the defect in production.

Do not modify code during the audit. Do not infer completion from passing tests alone. Do not infer absence from rollout-disabled browser behavior alone.

## 21. Copy/paste audit prompt for Claude

```text
Audit this repository against docs/PERSONALIZATION-REVAMP-AUDIT-BRIEF.md and its canonical source docs/PERSONALIZATION-SYSTEM-SPEC.md.

This is an audit, not an implementation task: do not edit files, commit, change production environment variables, run migrations against production, or deploy. You may run local tests and browser tests in an isolated environment. Controlled browser writes are allowed only in a designated test account/environment. Production YOVA personalization issuance is intentionally YOVA_PERSONALIZATION_ROLLOUT_PERCENT=0; do not change it. Use an isolated local/preview environment at an explicit 100% only to audit the personalized path.

Blurting/Broad Recall was deliberately removed after the original specification. Do not report its absent runtime/UI as missing. Historical migrations and the tiny old-checkpoint marker tolerance are intentionally retained.

First map each Section 4–18 requirement to the relevant executable code, persistence boundary, tests, and learner surface. Then run the browser matrix in Section 17 as far as the environment permits. Distinguish Complete, Partial, Scaffolding only, Missing, Broken, Rollout-disabled, Intentionally deferred, and Superseded.

Lead with release blockers and data-integrity/security problems. For every non-complete item give exact file/line evidence, reproduction, impact, smallest bounded fix, and required regression tests. Explicitly identify TypeScript/PostgreSQL drift, direct authenticated-call bypasses, route-version inconsistencies, provider-owned decisions that should be code-owned, profile/evidence authority leaks, false personalized copy, unsupported method×duration combinations, uncertain-evidence leaks, retry/cost misreporting, and cases hidden by rollout 0.

End with:
1. a requirement-by-requirement completion table;
2. the exact browser tests run and observed results;
3. finished verticals versus scaffolding;
4. blockers before raising rollout above 0;
5. a prioritized fix list that does not introduce new scope.
```

## 22. Source map

- [`PERSONALIZATION-SYSTEM-SPEC.md`](./PERSONALIZATION-SYSTEM-SPEC.md): frozen canonical product/implementation contract.
- [`LEARNING-SCIENCE-ENGINE.md`](./LEARNING-SCIENCE-ENGINE.md): architecture context; explicitly defers future personalization behavior to the canonical specification.
- [`STUDY-ROUTE-IMPACT-MAP.md`](./STUDY-ROUTE-IMPACT-MAP.md): route persistence, compatibility, transaction, cache, checkpoint, and migration topology.
- [`PERSONALIZATION-MILESTONE-0.md`](./PERSONALIZATION-MILESTONE-0.md) through [`PERSONALIZATION-MILESTONE-5.md`](./PERSONALIZATION-MILESTONE-5.md): historical implementation records; useful evidence, not the governing end-state.
- [`VERCEL-CHECKLIST.md`](./VERCEL-CHECKLIST.md): current release, migration, readiness, and rollout operating contract.

Useful current implementation entry points—evidence to inspect, not substitutes for the contract—include:

- `src/lib/study-route/schema.ts`, `initial-plan-method-routing.ts`, and `method-plan-integration.ts` for route identity and issuance;
- `src/lib/learning/canonical-method-selection.ts`, `method-eligibility.ts`, `method-fidelity.ts`, and `method-catalog.ts` for method policy;
- `src/lib/personalization/canonical-profile-*` and `src/components/personalization/canonical-profile-center*` for the canonical profile;
- `src/lib/study-route/agency-mode-controller.ts` and `post-session-transition.ts` for agency and successor decisions;
- `src/lib/study-route/method-evidence-policy.ts`, `method-decision-evidence.ts`, and `src/lib/personalization/method-outcomes.ts` for exact-cohort evidence;
- `src/lib/study-route/personalization-rollout.ts` and `src/lib/server/personalization-rollout.ts` for staged issuance;
- `src/lib/openai/session-generation-strategy.ts`, `src/lib/session-generation/source-grounded-degraded.ts`, and the session API routes for generation/fallback;
- `src/components/study-route-recipe-card.tsx`, `src/lib/personalization/post-session-personalization-receipt.ts`, and `src/components/yova-prototype.tsx` for learner surfaces;
- `supabase/migrations/202608300003_expanded_method_agency_boundary.sql`, `supabase/migrations/202608310003_method_eligibility_v3.sql`, and `supabase/tests/database/20260830_expanded_method_agency_boundary.test.sql` for the agency/database contract and its additive Practice-first eligibility boundary.
