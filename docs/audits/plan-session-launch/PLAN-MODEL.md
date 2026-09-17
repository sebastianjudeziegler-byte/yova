# Plan model and workload implementation audit

Implementation branch: `codex/plan-and-session-launch`, isolated worktree based on `75ea40a`. This report records local implementation evidence. It does **not** claim deployment, a migrated database, a paid-provider run, or a successful browser journey. Those release gates must be attached separately by the coordinating agent.

## What changed

The live ordinary-plan path now composes a complete topic queue before requesting wording. The model cannot choose its topic count, timing, methods, learning mode, evidence, or schedule. Each topic receives up to three learn blocks split only at subtopic boundaries and a separate practice placeholder; placement or an explicit learner coverage declaration can remove its initial teaching. Profile support can add a second practice block. Explicitly removed/deferred topics and their prerequisite dependants stay accounted for; ordinary capacity pressure no longer silently drops accepted topics.

`normal-plan-envelopes.ts` retains its public boundary and delegates to `topic-plan-model.ts`. The roughly 1,100-line time-first composer implementation was replaced. Its time-capacity packing, automatic capacity deferrals, speculative repeated-topic groups, and old schedule/duration validators were removed after replacement tests. `topic-plan-validation.ts` validates topic identity, exact subtopic coverage, task classification, workload/route timing, availability, overlap, and complete scope at the provider boundary. The older revision path has an explicit `legacyExactDuration` compatibility flag for already-created fixed-duration plans.

`session.workload` is the shared content contract: exact topic/subtopic scope, question count and single-point/transfer weighting, production steps, reading allowance, actual estimated minutes, profile ceiling, practice round and scheduling visibility. Reading, production, questions and reveals contribute to the estimate. Counts stop at 32 questions before generation. A short actual workload keeps its shorter estimate; the label is never independently padded to the ceiling. The runtime projects this persisted contract instead of estimating it again.

Study Now uses the same workload estimator for one immediate session. Its explicit available time and authorized profile are ceilings; the old coarse duration buckets do not shrink a 40-minute request to 25 minutes before sizing its work. Prior comparable early-exit evidence can still lower the ceiling. A bounded deterministic reconciliation keeps the generated route's selected topics, work and minutes in agreement. The new route regression requires a 40-minute example to contain more than 20 questions, at most 32, at least 32 estimated minutes and exact topic/route/workload agreement. This is a planning/workload assertion, not a claim that every question takes the same actual time.

## Personalization evidence

All ten profile questions have explicit rule IDs and observable tests:

| Profile input | Effective change |
|---|---|
| Q1 energy | Learn blocks prefer the declared energy window, practice the other available windows; availability wins. Home uses energy only after overdue practice and deadlines. |
| Q2 session length | Changes topic capacity, split count and maximum workload duration. |
| Q3 focus | Reduces capacity/ceiling and separates blocks across days. |
| Q4 guidance | Fixed suggestions, movable suggestions, or a learner-placed queue; learner-placed dates are hidden in the grouped view. |
| Q5 difficulty help | Step-by-step limits learning to one block per day; a referenced worked example can bring its block to the next available opportunity. |
| Q6 proving knowledge | Uses the shared task-eligible baseline route when choosing the visible learn method. It does not mislabel a profile preference as an explicit learner method choice. Overridden preferences receive no false fired rule. |
| Q7 gist/detail | Changes the task-first mix. Prediction and misconception categories survive workload scaling. Memorization retains its recall-oriented mix. |
| Q8 starting pattern | Front-loads a short first block into the next available opportunity; inability to find one within 24 hours is stated. Named difficulty in starting context is prioritized with its prerequisite closure. |
| Q9 support | Shorter sections reduce capacity/ceiling; frequent checks advance practice when availability allows. |
| Q10 extra context | Forgetting adds practice and tightens spacing; long-plan shutdown highlights the next block and collapses the remainder. |

[`PROFILE-QUEUES.md`](./PROFILE-QUEUES.md) contains two full block-by-block printouts with headings, generated from the same six-topic map and availability using contrasting profiles. [`profile-queues.json`](./profile-queues.json) contains both complete generated plans, profile declarations and route provenance. These are deterministic fixtures with fallback topic copy; they are not live LLM quality evidence.

## Reliability and authority boundaries

- Plans up to 24 envelopes use bounded provider wording. Larger accepted queues use deterministic topic-derived wording, retain every envelope, and report system provenance with zero provider attempts/tokens. This avoids requesting an oversized response or dropping topics to fit a token cap.
- The full queue remains visible when a deadline is close. Every date respects real availability and prerequisites; suggestions beyond the deadline have explicit conflicts. No claim is made that this queue is achievable before that deadline. A genuinely unusable availability window fails without scheduling overlapping blocks.
- The original learning goal persists in the normal plan model. The authenticated shape endpoint also reloads the original stored goal, accepted topic scope and authorized source content before generation, so academic level survives narrow session titles.
- Source classifications are persisted in plan-scoped `generationInputs.materialUnderstandingOverrides`, derived from the signed plan, never the unsigned activation request. Reload and active revision readers apply only overrides for already-authorized material IDs; shared upload metadata is unchanged.
- The shape endpoint replaces posted source excerpts with owner-filtered saved material content before quota reservation or provider work. Scope-outline content remains excluded after reload. Formative generated problem context uses the separate typed `reference.practiceProblem` field, preserved with key points; arbitrary client source excerpts are not retained.
- Setup corrections require a valid receipt for the map being corrected. An already-covered choice remains unchecked learner-reported evidence. Unknown material IDs and unsigned map changes are rejected before provider/quota work.
- A reviewed revision refreshes topic notes and deadline conflicts. Existing route identities and saved work remain protected by the established revision path. New topic workloads deliberately do not offer the legacy arbitrary-duration splitting control.

## Database migration review

Migration `20260917160001_topic_plan_workloads.sql` has a unique version separate from the existing PowerPoint migration. It fails if its expected protected-function anchors do not match.

1. `save_generated_plan` stores `workload` in session `step_data`.
2. `read_plan_revision_context` returns `workload`.
3. Activation permit and authenticated routed writer allow up to 200 sessions only for the signed `topic_plan_v2` payload; legacy activation remains capped at 14.
4. `apply_plan_revision` already merges validated session fields into `step_data`. Its patch bound becomes 400 only for an existing persisted `topic_plan_v2` plan; legacy stays capped at 28.
5. Plan-model and source-role metadata remain in the existing generation-input JSON and are preserved on revisions.
6. Service-only readiness v6 checks the mature v5 gates plus the workload writer/reader markers, both 200-session activation boundaries and the 400-patch revision boundary. The application and readiness probe require version `20260917160001` and `topicPlanWorkloads=true`.

The source review and tests confirm these expected anchors/contracts. Dense prerequisite DAG sizing is memoized; an 18-topic regression reduced prerequisite traversal from 131,072 reads to below 500, avoiding exponential work at the 40-topic limit. Study Now is capped to the four-topic scope supported by its workload and runtime. **Applying this migration and proving authenticated save/reload/revision on a real database remain required CI/deployment evidence.**

Return practice now reserves its dated opportunity before unrelated learning can occupy every day. The final queue follows actual scheduled dates. Subsequent rounds measure the +1/+3/+5/+7 day gap from the preceding practice, not the original lesson. Close deadlines still prioritize first passes and report any impossible deadline conflict.

## Test evidence

Red-first local evidence is stored in the task environment:

- `/tmp/yova-topic-model-red.txt`: initial 15 model tests failed before implementation; the first green run passed all 15. Additional behavioral tests now exercise all ten profile inputs.
- `/tmp/yova-home-red.txt`: both new priority tests failed before changing Home; the resulting five-test suite passed.
- `/tmp/yova-study-now-workload-red.txt`: new workload helper/provenance tests failed before implementation; helper and integration suites subsequently passed.
- `/tmp/yova-material-understanding-red.txt` and `/tmp/yova-shape-context-red.txt`: missing authority/round-trip boundaries, followed by passing scoped-role and owner-context tests.
- `/tmp/yova-study-now-activation-red.txt`: a generated workload received HTTP 422 during real preview activation because the schema still required legacy minute buckets. Activation now accepts only a matching validated workload, original availability cap, exact topic scope and workload provenance; mismatched work estimates remain rejected.
- `/tmp/yova-practice-spacing-red.txt`: three failures exposed delayed first returns and later rounds measured from the lesson; all pass after date reservation and prior-practice spacing.
- `/tmp/yova-depth-complexity-red.txt` and `/tmp/yova-study-now-topics-red.txt`: dense-DAG traversal and oversized immediate scope reproduced before their bounded fixes.
- `/tmp/yova-workload-mix-red.txt`: two behavioral failures demonstrated lost prediction/misconception categories and inappropriate transfer counts for memorization; both pass after projecting the shared task mix.

Final targeted suite: **451 tests passed across 44 files**; see `evidence/plan-model-unit.txt` (original `/tmp/yova-model-verified-final.txt`). It includes plan generation/materialization/provider contracts, shape source authority, Study Now, Home, cloud plan persistence and readiness. Typecheck (`tsc --noEmit`) and scoped ESLint both passed with no diagnostics; original outputs `/tmp/yova-model-types-final.txt` and `/tmp/yova-model-lint-final.txt`.

Legacy tests were updated where Brief 2 explicitly changes the contract: time-capacity deferrals become complete queues with explained deadline conflicts; arbitrary normal-plan session counts become topic-derived counts; Study Now exact rounded duration becomes a content estimate bound to the same route/workload. Legacy revision exact-duration tests use explicitly legacy fixtures. Authorization, route identity/provenance, availability, source isolation, and saved-work checks remain substantive.

`e2e/plan-schedule-date.spec.ts` now uses the six-screen setup and real preview endpoints: 1/3-day deadline queues through activation, explicit weekdays and availability changes, a historical topic date versus a real due date, and replacing goal/map/date through Back. Video is enabled. Retired priority-card, automatic capacity-deferral and arbitrary v2-shortening journeys were removed. These browser journeys were authored and typechecked but not run locally by this agent.

## Remaining release proof and limits

The coordinating task owns full browser recordings, real-provider quality/reliability checks, database application, security integration and deployment. This agent has not committed or pushed. Content estimates remain estimates; question quality and learner effort require live inspection. The deterministic fill policy expands useful questions within a topic up to its ceiling but does not currently sweep the next topic into the same block. Concrete remaining gap: a 60-minute memorization practice ceiling reaches its 32-question cap at 33 estimated minutes, leaving 27 minutes even when another compatible topic exists. It stays honestly labeled 33 minutes and can use the approved next-topic continuation; this is partial delivery of the ZIP’s within-block sweep requirement, not a claim that the requirement is fully implemented. Cross-topic work is supported for immediate Study Now scopes; ordinary topic blocks remain distinct to preserve reliable scope and prerequisite boundaries.

### Final direct Study Now intake regression

The retired Add intake passed a parsed duration seed, but the direct Study Now entry always supplied 25 minutes, even when the learner wrote “in 20 minutes” or “for 40 minutes.” Reused the existing explicit-duration intake parser in `StudyNowCreator`, preserving exact requested minutes (including non-bucket values) as server availability. The shared server workload still applies profile and availability ceilings; no second planner was added. Seeded durations now also remain exact instead of being rounded to the nearest old timer bucket. No explicit duration retains the 25-minute default. The inherited parser recognizes numeric `in`/`for`/`within` minute phrases; it is not a general natural-language duration parser.

Four focused regression cases failed before the behavior change; after the fix the creator, intake, Study Now workload, generation-route, and activation-schema suites passed. Logs: `evidence/study-now-explicit-time-red.txt` and `evidence/study-now-explicit-time-green.txt`.

Migrated `e2e/add-to-yova.spec.ts` from retired Calendar classification/four-screen controls to the current Home setup, grouped-topic result, direct Study Now and native Calendar quick-add paths. Preserved legacy overdue milestone compatibility, new deadline completion/reload, outside assignment source, artifact placement bypass, goal/date changes, activation persistence and preview-context isolation. The direct product-rule case now requests 20 minutes and checks the workload ceiling. These E2E edits were typechecked and linted; this agent did not run a browser. Preview journeys verify UI/state integration, not live provider quality or authenticated account isolation.

### Browser contract review during CI

A static compatibility review found and corrected test-only request/domain mode confusion (`inside` versus persisted `inside_yova`), the old active-plan Start/Adjust entry selectors, and two baseline expectations that predated shared workload timing and planned practice. The legacy seeded-plan timeline assertions remain intact. The browser-only planning outage fallback still uses its existing local legacy composer and honest fallback notice; its test now checks reviewable output without claiming v2 composition or production offline generation.

The review also reproduced a real grouped-view regression: attached topic URLs and file names were missing although saved. The grouped view now displays the existing attached sources under their topic, restoring source access. One render regression failed before the change; nine component tests pass afterward (`evidence/grouped-source-red.txt`, `evidence/grouped-source-green.txt`). The existing founder revision journey continues to check the saved URL rather than dropping the assertion.

Initial topic-map failure already has Retry, Skip and Back controls; no defect or app change is claimed there. Added a CI browser case that fails the first understanding request, retries the same goal, and reaches the scope/schedule screens. No local browser was run during this review.
