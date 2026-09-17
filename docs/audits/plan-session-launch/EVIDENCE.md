# Brief 2 + dependable sessions — evidence ledger

Branch: `codex/plan-and-session-launch`. Original base: main `75ea40a8d87366b41c6308bb5189452d0b493435`; merged current main `0ce2292b71f7ca53a5978d637280e71d913debb7` after the separate Undo prerequisite. Implementation and verification in progress. No #97 production deployment or settings change.

## Evidence boundaries

The September 17 production audit remains evidence of the old deployed behavior, not a test of this implementation. Local unit tests establish bounded code behavior. Transport fixtures establish recovery behavior, not model quality. CI live samples, migrated-database tests, and recordings must be reviewed separately before launch approval. Automated browser elapsed time does not measure student pacing or learning.

## Root-owned changes and reproduction

| Area | Before | Implemented check | Evidence status |
|---|---|---|---|
| Finish recovery | Production audit: three Finish failures, `[client:deadline]`; root cause unknown | Durable account/session outbox, stable event identity, concurrent-click coalescing, exact authenticated receipt after an ambiguous reply | Five focused outbox tests pass. Six receipt checks pass within 117 repository/sync/generator checks. New real migrated-DB delayed reply, reconnect, reload and rejection tests registered in CI; not yet run against a DB locally. |
| Long workload generation | Added 24-question tests failed: one oversized provider call instead of bounded calls | First batch creates immutable teaching context; later batches share it, max eight questions per call, total max32, one retry/batch under one provider deadline | Before: two failures. After: both pass. Actual generated content must be reviewed from CI live samples. |
| Concrete practice problem | A worked-solution lesson without a solvable prompt was accepted | Require prompt plus reference solution for worked_solution; runtime displays prompt, comparison receives separate reference | Before: new regression resolved instead of rejecting. After: regression passes. Live task usability review remains. |
| Correct answer position | All-first-choice model output remained all-first | Stable question permutation, correct-index remap; preserve numeric/chronological/position-referential order | Before: composed-position test failed. After: answer identity and stable order pass. Small rounds are not promised perfect positional balance. |
| Source roles | Outline-only and mixed attached files leaked teaching excerpts | Only content-source ranges are teaching context; scoped roles survive plan persistence and server hydration | Two source-context regressions failed before, pass after. Agent adds persistence/owner-scoped source checks. |
| Topic queue evaluation | Evaluations required old deadline truncation/session counts | New trusted composition must retain scope, exact code-owned dates and explicit deadline conflicts; legacy rubric unchanged | Replayed A18/short-deadline cases now test the Brief 2 contract. |
| Starting-context personalization | Broad regression run found named ETC difficulty no longer came first after prerequisites | Restore priority through existing difficulty matcher; keep duration within content/profile ceiling; remove unsupported promise of extra time | Old priority assertion failed; restored priority verified. Existing three-visible-differences requirement remains. |

The first broad unit run completed with 4,370 passed, 32 failed and 99 gated/pending out of 4,501. It ran during implementation: failures were triaged by owner, including real revision/schema/source seams and explicitly changed old time-first expectations. This is **not** a final pass count.

Broad local verification on the integrated implementation: **4,453 passed, 99 gated/skipped, zero failures**, across 525 test files (501 passed, 24 skipped), 42.58 seconds with two workers. The 25 live-gate runner unit tests also passed. ESLint and TypeScript passed. This does not include real database or provider execution; those remain CI gates.

Final review reproduced and corrected further seams: content-derived Study Now durations rejected by the legacy activation whitelist; return practice pushed behind every learning block; exponential prerequisite traversal; long Study Now selecting more than four supported topics; v2 revision metadata hydrated too late for the larger bound; related-topic outcomes attributed to the primary topic; and server hydration expanding selected subtopics. See owner evidence for individual failing-then-passing tests. The negated-difficulty test now checks first topic introduction order independently of interleaved return practice.

## Recordings and environments

- `baseline-session-launch.spec.ts`: named map last-keystroke/reload/recheck recovery and comparison-unavailable journeys; development preview, deterministic slot transport; successful video retention enabled.
- `baseline-plan-setup.spec.ts` and `plan-schedule-date.spec.ts`: setup/availability/topic-correction journeys; dependencies documented in the tests.
- `playwright.baseline-live.config.ts`: retains successful real-model browser journeys on desktop/mobile.
- `baseline-session-quality.live.spec.ts`: real endpoint/model API samples for 6/24-question workloads and incorrect/correct osmosis repairs; these are API checks, not browser journey videos.
- `baseline-completion.migrated.test.ts`: real authenticated Supabase writer/outbox/reader against all migrations; network faults affect transport, not fabricated DB success.

The focused local map case ultimately passed, including immediate-exit restoration, reload during failed correction, retry, and original/revised provenance. Earlier attempts were interrupted by Fast Refresh or failed at the real activation-duration regression. The final recording was decoded and played in Chromium and its final map frame inspected: 1280×900, 7.68 seconds. See [RECORDINGS.md](RECORDINGS.md). No broader browser suite or live gate was run locally.

## Deliberate exclusions and release conditions

Separate Undo PR #98 is merged, deployed and verified; see [PRODUCTION-UNDO.md](PRODUCTION-UNDO.md). No merge/deploy. No old-account data deletion. Legacy plans remain operable after automatic review rejected blocking them without a migration. No promise of zero provider failures or of established learning efficacy. The new migration/readiness contract must pass before production release.

The initial candidate deferred within-block filling; the resumed implementation is closing this gap with two bounded segments. Historical failure: at the 32-question cap, a factual block can honestly estimate 33 minutes under a 60-minute ceiling. Optional continuation can offer the immediately next prerequisite-ready learning block even if its date was only a later suggestion; it does not pull future spaced practice forward. This is a recorded limit against the ZIP's full within-block filling requirement, not completed parity.

The direct Study Now entry also regains existing explicit-time parsing: numeric “in/for/within” minute requests and seeded limits are used exactly, subject to server profile/availability ceilings. Four newly failing entry regressions passed after correction; default remains 25 minutes. The final broad total above includes these checks. SVG title rendering was also normalized to a single string after React warned during the full run; both map render tests pass without that warning. Inline edits reuse the existing receipt/Undo entry point; the underlying Undo defect was subsequently fixed separately in #98 and verified in production.

## Initial CI review

[PR #97](https://github.com/sebastianjudeziegler-byte/yova/pull/97), first run [#408](https://github.com/sebastianjudeziegler-byte/yova/actions/runs/35238118176): every database migration, database lint/boundaries, unit tests, ESLint and TypeScript passed. Existing migrated revision cases passed. Completion delayed-response reconciliation, one-write/one-attempt checks, reconnect and rejection checks passed; the full cloud-state reload then failed in its aggregate REST-read guard. Bounded test-only path/status/error diagnostics were added without removing the reload assertion. Browser installation now still runs after an earlier test failure so independent browser gates do not fail merely because installation was skipped. This is a draft, not release approval.

CI [#409](https://github.com/sebastianjudeziegler-byte/yova/actions/runs/35238795150) reproduced the reload failure precisely: `/rest/v1/plan_sessions`, HTTP403, PostgreSQL42501, `permission denied for table plan_sessions`. The migrated database had owner RLS but no authenticated SELECT grant. Migration `20260917170001_plan_session_authenticated_reads.sql` supplies only that grant and advances the v6 readiness contract to require it together with the owner policy. Four readiness unit checks first failed; 37 focused checks then passed. Twenty pgTAP assertions now cover real owner/cross-owner reads and denied writes; database replay remains pending the next CI run. This does not prove the same cause for the earlier production timeout.

The production build also passed in #409. The next CI run puts the live session samples and baseline journeys before the larger core suite and uploads live evidence immediately; all existing suites remain required. This changes feedback order, not pass criteria.


## Resumed implementation after production Undo

- [Production prerequisite](PRODUCTION-UNDO.md): verified deployment main `0ce2292`; fresh Moon Phases plan changed, confirmed, receipt shown, undone, reloaded. Six original sessions and original content restored. Water Cycle Quiz Foundations untouched.
- CI #410 is an **incomplete candidate**, not a passing release gate. It passed migrated adjustment/completion checks and unit/build gates but exposed setup/browser failures. See the new findings in PLAN-MODEL.md, PLAN-UI.md and SESSION-RUNTIME.md.
- [Generated content review](GENERATED-QUALITY-REVIEW.md): the long osmosis set passed structural checks but failed actual content review. Question s12 had no fully correct answer. Retained samples, finite repair/recheck, independent review coverage and broader pair selection now have regression evidence. Live answer-review and 6/24/32 workload gates must verify quality and latency.
- Integrated unit checkpoint before two-segment completion work: **4,505 passed, 101 gated/skipped**. This does not include the later segment changes and is not a substitute for the final integrated gate.
- Segment outbox reproduction: both ordered receipts were stripped before retry. `evidence/segment-outbox-red.txt` records the failing assertion; schema, transport, exact lost-reply reconciliation and cloud reload now preserve them. Targeted root persistence/readiness suite: **113 passed**. Real database partial/replay/origin checks are authored for CI, not run locally.
- New migration `20260917180001_topic_segment_completions.sql` validates and stores both segment receipts inside the existing locked completion transaction. It preserves prior routing/replay guards and advances the service-only readiness contract. No partial block may become a completed session. Client-reported MCQ counts remain execution reports, not proof of learning.
- The current-main reference is CI #413 on `0ce2292`, once complete. The existing historical comparator is still pinned to `00995f1`; report both honestly and keep new Brief 2 acceptance gates mandatory.


Latest integrated local checkpoint: **4,534 unit tests passed,105gated/skipped;25runner checks passed; full lint passed**. Focused two-activity desktop replay passed13.1s, preserving both origins and second-activity draft through reload; video decoded and frame inspected. The Next dev console emitted a router-initialization error during page load despite the passing assertions; final CI review remains necessary. Later-history routing refinements have separate targeted verification and will run in full CI.


## CI #414 review in progress

Candidate `e3dfd97` / run `35254727222` passed migration replay, database lint/boundaries, integrated units, lint, types, production build and the live retained-invalid-MCQ versus corrected-option check. The migrated route/completion step passed 13 cases and timed out in the new valid two-segment completion/retry/reload case after30s; the exact await is not yet known. Per-segment source hydration and the malformed/partial receipt rejection cases passed. Test-only bounded stage/database-wait diagnostics retain the existing assertions and30s deadline; no SQL change is justified by the timeout alone. See `evidence/migrated-segment-ci414.md`.

Independent review found that question replacements could lose the current retry round and original missed-answer details. Two focused regressions failed before threading that immutable context through later batches, duplicate replacements and quality replacements. The same one-point scope and four-call bound remain. All62 focused generator/quality tests passed; evidence: `evidence/repair-context-{red,green}.txt`. This follow-up is not covered by the initial CI414 head.

CI414 live browser/API checkpoint: {"startTime": "2026-09-17T17:52:44.785Z", "duration": 557270.007, "expected": 14, "skipped": 0, "unexpected": 3, "flaky": 0}. The retained-invalid-answer solver regression passed. Both contrasting profiles, their route/tip delta, desktop outside study/retries/special rounds and short factual generation passed. The24-question application sample returned in39.1s, while32-question generation failed in46.9s. The phone Practice Test also failed after its UI wait, despite the same desktop case passing. These are release blockers. Content-free provider timing/outcome/count diagnostics and a CI-only synthetic32question call trace were added without changing budgets, retries or quality criteria;70focused tests, scoped lint and typecheck passed. No local live call was made.


## Item 1 — session sizing follows the profile, and the receipt claims only what was delivered

Two symptoms in CI #414 (`evidence/ci414-live-review.md`): both contrasting
profiles got **22 minutes and six questions**, and P1's receipt still claimed
"a shorter workload allowance and a 22-minute estimate".

**Sizing, red.** With the pre-handoff sources restored under the new tests,
`src/app/api/plans/generate/route.test.ts` "preserves direct baseline profile
differences with canonical rollout" fails for both rollout values:
`expected 25 to be less than or equal to 15` — the short profile's ceiling was
the requested Study Now duration, because the learner's own ten answers were
only forwarded to workload sizing when the canonical personalization rollout
was enabled for that learner. The route now forwards them unconditionally, and
the rollout keeps gating canonical signals and observed history only.

**Sizing, green.** Both cases pass for `intent: "plan"` and `"study_now"`. On
the same topic, one 25-minute Study Now request:

| Profile | Allowance | Estimate | Questions | Method |
| --- | --- | --- | --- | --- |
| 10–15 min, loses focus very often, shorter sections | 11 min | 11 min | 3 | Concept Mapping |
| 45–60 min, rarely loses focus | 25 min | 22 min | 10 | Feynman Technique |

The live comparison in `e2e/baseline-hub-profiles.live.spec.ts` now reads the
server-sized workload from the generate response, asserts the visible timer
equals it, asserts the generated questions actually delivered match the
persisted count, and requires the two profiles to differ by at least five
minutes and two questions — a difference in tip copy alone can no longer pass.

**Receipt, red.** `src/lib/routing/rule-evidence.test.ts` "claims a shorter
allowance only when the block delivered one" reproduces the CI #414 receipt
from a short profile carrying a 22-minute, six-question block:
`L4.q9.shorter_sections claims an allowance the block did not deliver:
"Because you asked for shorter sections, this block uses a 22-minute estimate
and a smaller workload."`

**Receipt, green.** An allowance claim (`L4.q3.often`/`very_often`,
`L4.q9.shorter_sections`, `L4.q2.minutes_*`) now holds only while the block's
estimate stays inside the allowance that rule set. Otherwise the rule is still
named — Brief 1.5 item 7 — with the real numbers: "your allowance for this
block is 15 minutes, but its content is estimated at 22 minutes." A correctly
sized 11-minute block keeps all three claims.

Local checkpoint after both fixes: **4,553 unit tests passed, 106 gated or
skipped, one known red** (the PT409 completion case, item 2), full typecheck,
and lint on the changed files.


## Item 2 — the stalled completion, narrowed to one rejected replay

CI #415 (`c659ccc`, [run 35256560801](https://github.com/sebastianjudeziegler-byte/yova/actions/runs/35256560801), step
"Test the plan adjustment route against the migrated database"): 7 cases passed
and only `persists both checked origins once and reloads the exact segment
receipts after a terminal retry` failed, at its unchanged 30-second deadline.
Codex's stage log locates the stall exactly:

| Stage | Finished at |
| --- | --- |
| activate fresh segmented plan | 101 ms |
| first completion write | 201 ms |
| exact completion retry | 208 ms |
| count durable attempt | 258 ms |
| read authenticated receipt | 294 ms |
| reload authenticated learning state | 351 ms |
| read stored segment receipt | 355 ms |
| **reject changed receipt retry** | **never — still pending at 25,001 ms** |

Everything the case is about — two segment receipts written once, the exact
retry coalesced, the receipts reloaded and re-read — completes in under
four-tenths of a second. What hangs is the deliberately tampered replay, which
the locked writer answers by raising `40001
study_route_completion_retry_conflict`.

The one database sample taken at 25 seconds showed a single client backend,
`state=active`, `query_class=completion_rpc`, `blocking_pids=[]` and
`active_seconds=0`. Nothing was blocked, and the statement had started less
than a second earlier — so at 25 seconds the database was not grinding through
one long call. That is consistent with the same call being started again, but
one sample cannot prove it, and `40001` is the only error code in this suite
that no passing case observes.

Two additive probes now settle it in the next run, with the stalled case's
assertions and deadline untouched:

1. **A separate case, `answers a completion conflict instead of leaving the
   request open`**, drives the earliest `40001` the writer raises — a fresh
   attempt against an already completed session — and asserts it comes back. If
   this returns while the tampered replay stalls, the stall belongs to that
   replay path; if both stall, every `40001` this RPC raises is left open, which
   would also be a candidate explanation for the unexplained production
   completion timeout.
2. **Repeated sampling at 5, 15 and 25 seconds**, now including transaction and
   connection age, plus a request/response trace that records only the attempt
   number and HTTP status. A transaction age that keeps resetting means the
   request is being re-issued; a response with no resolution means the client
   is holding it.

No SQL, application behaviour, assertion or deadline changed, and no local
database run is claimed.


## Item 3 — the 32-question failure is the rejection loop, not the time budget

Founder-approved artifact download: `session-generation-diagnostics-35256560801`
(21 KB) from CI #415, holding `practice-32-synthetic-trace.json`. Every provider
call in that trace returned; nothing timed out.

| Call | Purpose | Started | Took |
| --- | --- | --- | --- |
| 1 | learn block, first 8 questions | 0.0 s | 8.8 s |
| 2–4 | three further 8-question batches, in parallel | 8.8 s | 6.5 / 6.3 / 11.4 s |
| 5 | independent review of all 32 in one call | 20.2 s | 15.6 s |
| 6 | repair of the 6 rejected questions | 35.7 s | 6.9 s |
| 7 | re-review of those 6 | 42.6 s | 4.3 s |

Total 46.9 s against the shared 50-second provider budget, with the request
failing at 46.9 s — not at a deadline. The failure is
`ensureQuestionQuality` throwing `generation_failed` after the re-review, with
`attempts: 2`.

What the reviewer actually rejected in the first pass: 6 of 32, one as an
ambiguous stem (`s17`) and **five as repetition** — `s23`, `s25`, `s29`, `s30`
and `s32` all restated "osmosis needs a selectively permeable membrane" or "net
osmosis stops at equilibrium" in a renamed scenario. On the evidence of the
retained questions those rejections are correct: one three-subtopic topic does
not hold 32 distinct questions. The repair fixed five; **one** still disagreed
with its answer key, and that single question discarded all 32 and showed the
learner "YOVA couldn't build this".

**Founder decision:** deliver the sound questions. A replacement that still
fails review is dropped, never delivered, and the block is shorter than planned
instead of absent, while it keeps a floor of sound questions (the round's
planned count, or three, whichever is smaller). The quality check itself is
unchanged: the review must still cover every question, and a failed or
unavailable review still refuses the block.

**Red.** `src/lib/openai/shape-slot-quality.test.ts` "delivers the questions
that passed review when one replacement still fails": an eight-question round
whose `s3` replacement stays unsound threw `ShapeSlotGenerationError` at
`shape-slot-generator.ts:411`.

**Green.** Seven sound questions are delivered, `s3` is absent, each delivered
question's key matches the reviewer's answer, and the call count is unchanged:
one review, one bounded repair, one re-check. A round left below its floor still
refuses, and the existing one-question case still refuses. 23 generator/quality
files, 384 tests pass.

The 32-question live gate now requires every delivered question to have passed
review and at most two of 32 to be dropped, instead of requiring all 32 to
survive. Its final quality diagnostic must account for exactly the dropped
questions.

Note for the founder's judgement, not changed here: the repetition finding says
a 32-question block on a single three-subtopic topic is over-filled at source.
Section 1 of the plan model answers that by sweeping in the next ready topic,
which the segmented blocks on this branch already do.
