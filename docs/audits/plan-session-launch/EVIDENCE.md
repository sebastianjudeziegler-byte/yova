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


## Item 4 — the phone Practice Test failure is the same generation refusal, not a mobile fault

The CI #414 review recorded the phone Practice Test and phone Interleaved
Review failing while their desktop twins passed, which reads as a mobile
problem. CI #415's live step contradicts that:

| Case | CI #414 | CI #415 |
| --- | --- | --- |
| Phone Practice Test (8 planned questions) | failed, `502 generation_failed` after 17.2 s | **passed, 14.9 s** |
| Phone Interleaved Review | failed, `502 generation_failed` after 18.3 s | **passed, 11.4 s** |
| Phone 1-point and 2-point retries, phone outside-study | passed | passed |
| Desktop 6-question workload | passed | **failed, `502 generation_failed`** |
| Desktop 24-question workload | passed, 39.1 s | passed, 32.6 s |
| Desktop 32-question workload | failed, `502 generation_failed` | failed, `502 generation_failed` |

Nothing in the phone projection changed between the runs. The failure moves
between projections and question counts, and every instance is the same
`generation_failed` refusal from the one shared generation path — item 3's
all-or-nothing quality gate, which discarded a whole round whenever one
question still failed review. A 5-question retry round or an 8-question
Practice Test has far fewer questions to lose, so a single unsound question was
enough to refuse the round outright.

Item 3's change covers these rounds: a round now drops a question the review
still rejects and runs shorter, while keeping its floor of three sound
questions, so one bad question can no longer take a Practice Test with it. No
mobile-specific change was made, because no mobile-specific cause is supported
by the evidence.

One consequence handled here: the live Practice Test case asserted the visible
counter read "QUESTION 1 OF 8" exactly. It now asserts the counter matches the
number of questions that round actually delivered, between six and eight — the
learner's counter must never claim questions the round does not contain.

If the phone cases fail again in the next full run while their desktop twins
pass, that is a regression to chase; on the two runs available they are
intermittent instances of the generation refusal, which is the standing rules'
FLAKY category rather than a mobile defect.


## Item 5 — full CI on `c177ac7` (run 420, [35271412310](https://github.com/sebastianjudeziegler-byte/yova/actions/runs/35271412310))

Seven steps failed. What each one is:

**Green and worth naming first.** Migration replay, database lint and
boundaries, the plan-adjustment route against the migrated database (6 cases,
including save-change-then-undo), lint, types, the production build, the
authentication journey and the Study Profile phone comparison. In the live
step, **both profile journeys and the delta comparison passed** — "the two
profiles have different actual workloads as well as hub rules and tips" is green
against the real model, which is item 1 verified end to end. **Both phone cases
from item 4 passed**: Practice Test 19.8 s, Interleaved Review 15.5 s, plus both
phone retries and phone outside-study.

**Step 16, learning-engine tests: 4,555 passed, 1 failed** — the committed red
PT409 case and nothing else.

**Step 12, migrated database: 13 passed, 2 failed**, and together they answer
item 2. The new probe, `answers a completion conflict instead of leaving the
request open`, timed out exactly like the segmented case. So the stall is not
the tampered replay: **any conflict this writer raises leaves the request
open.** The traces show why:

- transport: `{"event":"request","attempt":19}` and **no response event ever** —
  one request sent, no reply;
- database at 5 s, 15 s and 25 s: the same backend `active`, `query_class`
  `completion_rpc`, `active_seconds: 0` and `transaction_seconds: 0` each time —
  the statement and its transaction keep restarting;
- by 25 s of the second case: `wait_event: "advisory"`, `blocking_pids: [903]` —
  a second backend now holds the writer's advisory lock, so the retries block
  each other.

The writer raises these permanent refusals with SQLSTATE `40001`, which is
PostgreSQL's *serialization failure* — the code that means "transient, retry
me". Everything in front of it obliges, forever, and the request never returns.
Production consequence, not yet proven there but consistent with the
unexplained completion timeout: a learner retrying Finish with any changed field,
or finishing a session that is no longer ready, gets a request that never
answers. This is the client half of Codex's PT409 hypothesis, and it is a
migration-level change to the locked completion writer, so it stops here for the
founder's decision rather than being done unasked.

**Steps 20 and 22, live generation.** `practice-32-quality` and the three
`baseline-session-quality` cases fail:

| Case | Outcome |
| --- | --- |
| 6-question workload | `expect(received).toHaveLength(expected)` — an exact count |
| 24-question workload | `generation_failed`, 42.7 s (passed in #414 and #415) |
| 32-question workload | `generation_failed`, 35.5 s |
| synthetic 32-question trace | `generation_failed` thrown at `shape-slot-generator.ts:164` |

Two distinct causes, neither of them the old all-or-nothing gate:

1. The 6-question gate asserts an exact question count, the same assumption the
   Practice Test case carried. A dropped question now breaks it. That gate needs
   the same treatment: assert what the round delivered.
2. `:164` is `withOneRetry` giving up, which means a call returned nothing twice.
   The prime suspect is the newly batched, stricter review: its budget is
   `350 + 110 × questions` output tokens, and reasoning tokens are drawn from the
   same allowance, so an eight-question review with `stemSufficient`, `demandMet`
   and a reason per question can be truncated into an unusable reply. That is a
   hypothesis from the failure site and the arithmetic, not from a trace; the
   run's own diagnostics artifact would confirm it.

**Step 28, core learner journey: 220 passed, 9 failed, 23 skipped.** Against
current main's own run ([413 on `0ce2292`](https://github.com/sebastianjudeziegler-byte/yova/actions/runs/35251019423), 238 passed, 5 failed) five of the nine also fail on main — the material
drop zone on both projections and three mobile calendar cases. Four do not:

| New on this branch | Failure |
| --- | --- |
| `add-to-yova.spec.ts` "a deadline can live in Calendar…" (desktop, mobile) | quick-add's Type select reads `class`, expected `deadline`/`exam` |
| `living-plan.spec.ts:135` founder journey (desktop, mobile) | the attached source link `…watch?v=example-ap-biology` is not rendered |

Neither touches session sizing, receipt wording, the quality gate or the
Practice Test counter, so neither comes from items 1–4; they belong to this
branch's earlier plan-model and plan-screen work.

**Steps 34–35, the release gate: BLOCKED — regression versus main.** Raw live
counts `{"pass":50,"fail":6,"flaky":22,"unavailable":1}`. The comparator counts
60 blocking cases against retained main `00995f1`:

- **50 "required case was not executed".** These are cases the retained baseline
  names that this branch renamed: `plan-schedule-date.spec.ts` (26),
  `add-to-yova.spec.ts` (14), `living-plan.spec.ts` (6),
  `calendar-recurring.spec.ts` (2), `core-learning-loop.spec.ts` (2). Brief 2
  rewrote intake, scheduling and the inline topic actions, and the titles moved
  with them — "a natural deadline and an edited date survive every schedule
  control" is now "explicit weekdays and a goal date survive changes to
  availability". The comparator matches on exact case names, so a rename reads
  as an absence. They need declaring in `scripts/live-gate/retired-cases.json`
  with their replacements, case by case; nothing is proven broken by their
  absence, and nothing should be waived without that list.
- **10 "new failure versus passing main".** The four branch regressions above,
  the five that also fail on current main, and the new 32-question case, which
  has no counterpart on main.

The retained baseline is also older than current main, which is why cases that
fail on main's own run still count as passing there. Brief 2's gate note asks
for the baseline to be refreshed before the PR; that refresh has not been done.


## Founder decisions after run 420

### 1. Permanent completion conflicts answer instead of hanging

`20260917190001_permanent_completion_conflicts_answer.sql`. The locked writer
raised its deterministic refusals as SQLSTATE `40001`, PostgreSQL's
serialization failure — "transient, retry me". CI #420 showed what that costs:
one request sent, no reply ever, the same statement restarting at every sample,
and a second attempt waiting on the first one's advisory lock. Both the probe
case and the tampered replay timed out at 30 s.

PostgREST documents SQLSTATE `PTxyz` as an explicit HTTP status with `"code":
"PTxyz"` in the body, so the ten permanent messages the client already treats as
final now raise `PT409` and answer as HTTP 409. Genuine serialization failures
keep `40001` and stay retryable. The migration rewrites every public function
whose source still pairs `40001` with one of those messages, fails loudly if an
anchor is gone, and refuses to leave a partial rewrite behind. Rows, locks,
ordering and validation are untouched: only the reporting changes.

The client lists the `PT409:` spellings beside the `40001:` ones, so a database
that has not taken the migration still classifies correctly. This makes Codex's
committed red case green — `classifies an allowlisted permanent completion
conflict (PT409) without exposing database detail` — which is the red-then-green
evidence for this change, together with the two migrated cases that now expect
`PT409` and, more importantly, expect an answer at all.

Readiness advances to contract `20260917190001` with a `permanentConflictsAnswer`
capability, and fails closed when it is false or absent: a deployment whose
database still hangs on these refusals is not ready. New test:
`fails closed when answered completion conflicts are false|undefined`.

### 2. The exact-count gate

`e2e/baseline-session-quality.live.spec.ts` asserted `toHaveLength(count)` for
6, 24 and 32 questions. A question dropped by the review now makes that false,
which is what failed in run 420. It asserts what the round delivered instead:
at most the requested count, and at least the count less one in sixteen, with
prompts unique across whatever was delivered.

### 3. The reviewer's output allowance — measured, then raised

The founder asked for the arithmetic to be checked rather than assumed. The
authorised 25 KB artifact from run 420 settles it. Reviewing 32 questions splits
into four calls; the fourth — eight questions against 24 earlier ones — returned
`incomplete` **both times**, at `maxOutputTokens: 1230`:

| Review call | Questions | Prior questions | Took | Outcome |
| --- | --- | --- | --- | --- |
| 5 | 8 | 0 | 3.4 s | completed |
| 6 | 8 | 8 | 6.3 s | completed |
| 7 | 8 | 16 | 9.5 s | **incomplete** |
| 8 | 8 | 24 | 3.1 s | completed |
| 9–12 (retry) | 8 each | 0/8/16/24 | 2.6–8.5 s | 12 **incomplete** |

`incomplete` is the provider stopping at the output cap, and reasoning tokens
are drawn from the same cap, so the batch with the most to compare against is
the one that runs out — twice, in the same place, which is why
`withOneRetry` gave up at `shape-slot-generator.ts:164`. Not the time budget:
36.5 s of a 50 s allowance, 13.4 s still unused.

The allowance is now `1200 + 170 × questions + 25 × priorQuestions` — 3,160
tokens for that fourth batch instead of 1,230. Red first:
`gives each review batch room for its questions and everything it must compare
them against` failed with `expected 1230 to be greater than or equal to 2200`,
and passes now. No prompt, criterion, retry count or deadline changed.

### 4. Renamed cases, and a baseline that is actually main

`scripts/live-gate/retired-cases.json` gains two sections beside the retired
Brief 1.5 cases:

- `renamed`: 13 cases whose coverage still runs under a new title, each listed
  with the case that carries it now (3 in `plan-schedule-date.spec.ts`, 6 in
  `add-to-yova.spec.ts`, 3 in `living-plan.spec.ts`, 1 in
  `calendar-recurring.spec.ts`). The comparator excuses the old title's absence
  with its own disposition — "Renamed; its replacement case runs and is
  compared" — and judges the replacement on its own merits. It refuses a case
  listed as both retired and renamed, and a rename with no replacement named.
  New runner test: `a renamed case may be absent under its old title, and says
  so, but still cannot hide a failure`.
- `notReplaced`: 4 cases present in main and absent here with no replacement
  identified — three `plan-schedule-date` cases about capacity math and the
  "insufficient time" refusal that Brief 2 deletes, and
  `speech and presentation plans bypass placement and use artifact-aware modes`.
  They are deliberately **not** excused. The gate still blocks on them until
  someone states what happened to the behaviour they covered; that is a question
  for whoever rewrote those flows, not something to wave through.

`canonicalBrowserCaseName` now maps both retained spellings of the stale-draft
map case to its current title, which Brief 2 renamed a second time.

The baseline moves from run 35098660639 on `00995f1` (2026-09-16) to **run
35251019423 on `0ce2292`, main's own full run**. Its live half is that run's
49 KB full-live-gate artifact, downloaded with the founder's approval; its
browser half is the same run's core-journey step log parsed case by case —
238 passing and 5 failing cases, matching the step's own totals — chosen over a
196 MB artifact for the identical pass/fail list, and the baseline file records
that source rather than claiming `browser.json`. The old baseline stays in
`docs/audits/brief-b/evidence` for history. The five cases that fail on main now
classify as pre-existing rather than as this branch's regressions.

Validated before commit: every renamed old title exists in the refreshed
baseline, every replacement exists in the branch's specs, and all four
`notReplaced` titles are genuinely in the baseline.

Local checkpoint: **4,560 unit tests passed, 107 skipped, none failing** — the
PT409 case included — full lint clean, 26 runner checks, typecheck clean. The
migration, the migrated-database cases and the live gates run in CI.


## CI run 423 on `57a5f17` ([35281007140](https://github.com/sebastianjudeziegler-byte/yova/actions/runs/35281007140))

**The completion fix works.** Step 12, the migrated database step, passed
entirely: 15 cases, including `answers a completion conflict instead of leaving
the request open` and `persists both checked origins once and reloads the exact
segment receipts after a terminal retry`, both of which timed out at 30 s in run
420 and both of which now expect `PT409` and get it. The stall is gone against a
real migrated database.

**What the migration broke, and the fix:** step 11 failed on one pgTAP
assertion, `the existing v6 RPC advertises the read-grant migration contract`,
which pinned `20260917180001`. The contract legitimately advanced, so the
assertion now expects `20260917190001`. A new boundary test,
`20260917190001_permanent_completion_conflicts.test.sql`, holds the change in
place: no writer may pair `40001` with a permanent message, the writers must
raise `PT409`, ordinary serialization failures must still raise `40001`, and
readiness must report `permanentConflictsAnswer`.

**The reviewer's allowance worked.** Step 22 went from 3 failures to 1:
the 6-question and 24-question workloads pass, and so do both profile journeys,
their comparison, both phone cases, both retries and outside study. **16 passed,
1 failed.**

**The 32-question case failed again, in a third place.** Not the review, and not
the all-or-nothing gate: `withOneRetry` gave up inside `remainingQuestions`
(`shape-slot-generator.ts:358`, from `fillLearnBlock:452`), which is the
*generation* of the additional question batches, after 48.0 s of the 50 s
budget. Two attempts at a batch returned nothing. Whether those calls timed out,
came back invalid, or found no budget left is in that run's diagnostics artifact
and is not inferred here.

**The release gate: BLOCKED, 33 cases** (was 60). The renamed list and the
refreshed baseline removed 27 of them.

- **11 "new failure versus passing main":** the four branch regressions from
  earlier work (`add-to-yova` and `living-plan` on both projections), the
  32-question case, one live `session-quality` Spanish case, and the mobile
  calendar and drop-zone cases that also fail on main — see below.
- **22 "required case was not executed":** the four deliberately unexcused
  cases, plus a set the static title diff could not see because their titles are
  built at runtime: `plan-schedule-date.spec.ts` builds `consolidated: …` and
  `explicit N-minute availability remains a priority card` from loop variables.
  Two of those are renames (`consolidated: a 1-day/3-day deadline survives
  placement, plan review and activation` → `a 1-day/3-day deadline retains the
  full queue and states scheduling conflicts`) and are now listed as such. The
  other five are the priority-card cases, and they are **not** excused:
  `src/lib/plan-generation/deadline-priority.ts` still ships, so that is a live
  feature whose browser coverage was dropped. `notReplaced` now records that.

**Main's own failures were being counted against the branch.** The baseline
format keeps only passing cases, so a case failing on both sides had no
"before" sample and read as a new failure — which is how three mobile calendar
cases and the material drop zone appeared in the 11 above, though main fails
them too. The refreshed baseline now carries all 243 cases with their outcome,
five of them failures, and the comparator maps a recorded failure to `failed`
instead of forcing every baseline row to `passed`. A case that fails on both
sides will read as pre-existing.

Also logged in `docs/audits/BACKLOG.md`: the same writers still raise other
deterministic refusals as `40001` (for example
`post_session_study_route_projection_conflict`). This migration converted only
the ten the client classifies as permanent; if one of the others is raised, it
hangs the same way. Out of scope for the founder's decision, recorded rather
than fixed.


## CI run 424 on `e2d7777` ([35286974561](https://github.com/sebastianjudeziegler-byte/yova/actions/runs/35286974561))

The gate's blocking set falls again, **33 → 25**, and the baseline fix does what
it was meant to: cases that fail on main as well now read as "pre-existing or
improved" (10, was 5) instead of being charged to this branch. All 18 remaining
"required case was not executed" entries are the nine `notReplaced` cases across
two projections — nothing unaccounted for is missing any more. Live practice:
**16 passed, 1 failed**. Core journey: the same nine, five of them main's own.

Step 11 failed on **my own new boundary test**, not on the migration: assertion
3 expected `complete_plan_session_with_route` to still contain a `40001` raise,
and it no longer contains one — every refusal that function raises was on the
permanent list. The other application-raised `40001`s live in the neighbouring
route and review writers. The assertion now counts them across the schema, which
is what it meant to check. The migration's three real assertions passed,
including readiness reporting `permanentConflictsAnswer`.

Two live cases need a decision rather than another attempt:

**The 32-question workload has now failed in three different places**, always
within a second or two of the same wall: 46.9 s (quality re-check, run 420),
48.0 s (additional generation batches, run 423), 48.1 s (quality re-check again,
run 424), against a 50-second shared budget. Each time a call came back unusable
twice and `withOneRetry` gave up. The place moves; the wall does not. One topic
with 32 questions, each independently reviewed, does not fit this budget
reliably — that is a sizing question, not another patch.

**The retained CI #410 canary missed its own question.** `finds the actual CI410
no-correct-option failure and accepts a sound replacement` passed in run 423 and
failed in run 424: the reviewer returned `rejected: []` for the retained
question that has no fully correct option. Same code, same prompt, different
answer — the review is a model and is fallible, as the hand-over said. Two
samples is not enough to call it either broken or noise, and it is the canary
for the whole quality feature, so it should not be quarantined quietly.


## Founder decisions after run 425 (18 Sept)

Run 425 on `c9511bb` ([35292611954](https://github.com/sebastianjudeziegler-byte/yova/actions/runs/35292611954)): step 11
(database boundaries) is green with the corrected assertion, and the synthetic
32-question trace **passed**. Live practice: 15 passed, 2 failed — the 24- and
32-question live workloads.

### The 32-question failure, from the trace and not inferred

Founder-authorised artifact `session-generation-diagnostics-35292611954`
(31 KB). The synthetic 32-question trace passed in **37.3 s**, delivering 32
questions:

| Stage | Calls | Result |
| --- | --- | --- |
| learn block + three 8-question batches | 1–4 | all returned, 7.6 s then ≤ 7.5 s in parallel |
| review, four batches of 8 (0/8/16/24 prior) | 5–8 | all returned — none `incomplete` now |
| review verdict | — | 8 of 32 rejected |
| repair of those 8 | 9 | returned, 9.4 s |
| re-review | 10 | returned, 0 rejected |

The allowance change settled the truncation: the fourth batch (24 prior
questions), which came back `incomplete` twice at 1,230 tokens in run 420,
completed in 3.0 s. 12.7 s of budget remained.

**What this does not settle:** the two *live* failures in the same run — the
24-question case at 47.6 s and the 32-question case at 48.1 s, both
`generation_failed` through `/api/sessions/shape`. That route's own diagnostics
exist (`YOVA_SHAPE_SLOT`, content-free by design) but were never captured:
the live Playwright config starts the dev server without piping its output, so
the step log has zero of those lines and no artifact holds them. Nothing here
says which live call failed or why, and nothing is inferred. The live config now
sets `stdout: "pipe"`, so the next run's step log carries each live call's
stage, outcome, timing and remaining budget.

### Retired, as decided

- `plan-schedule-date.spec.ts`: "a natural deadline and an edited date survive
  every schedule control", "shorter sessions preserve weekly availability and
  explain insufficient time", "an overfull plan returns to its schedule and
  recovers without a client crash" — the capacity maths and "doesn't fit"
  refusals Brief 2 deliberately deletes.
- `add-to-yova.spec.ts`: "speech and presentation plans bypass placement and use
  artifact-aware modes". **Behaviour change:** main gave speech and
  presentation goals a separate route — a "BUILD WITH GUIDANCE" mode label, a
  build-rehearse-refine starting approach and no placement request. On this
  branch there is one kind of plan and they go through the same topic-queue path
  as every other goal. They still get artifact-shaped topics from
  `knowledge-map-fallback.ts` (audience and argument, evidence and draft,
  rehearsal), but not the separate mode, label or placement bypass.

Each is in `retired-cases.json` with its reason, so the comparator reads them as
retired rather than missing.

### Quick-add read "Lab Report due …" as a class — fixed

Main added this deadline through the old "Add to YOVA → Track the deadline"
intake route, which Brief 2 removed; the branch's case goes through Calendar
quick add instead, and that exposed a real classifier bug. `inferEventType`
tested for "class | lecture | seminar | **lab** | tutorial" before it looked for
"due", so any title containing "lab" became a timetabled class — fixed, not due,
and never an outcome.

**Red:** five new cases in `src/lib/calendar/quick-add.test.ts`
(`Lab Report due …`, `Seminar essay due …`, `Lecture notes summary deadline …`,
`Lab practical exam due …`, `Tutorial quiz due …`) all failed.
**Green:** something that is due is now an assignment, or a test when it names
one; a lab, lecture or seminar is a class only when nothing is due. A timetabled
"Biology lab tomorrow at 2pm" still reads as a class. 82 calendar tests pass.

### The founder journey's "missing" source link — present, but collapsed

The link was never missing. Brief 2's plan screen groups blocks by topic, each
group a collapsed disclosure. The attached video belongs to the Carbon topic, so
it renders inside Carbon's group; the journey opened only Water's group, and a
link inside a closed disclosure is not in the accessibility tree, hence
"element(s) not found". The case now also asserts the source is saved on the
Carbon topic, opens Carbon's group and finds the link in that topic's source
list with the exact `href`. Red: CI runs 420, 423 and 424 at
`living-plan.spec.ts:169`. Green: the one focused local browser run the standing
rules allow, `founder journey preserves completed work, previews two topic
changes, saves a receipt and undoes the revision` — **passed in 7.2 s**.

### Deadline priority: not restored — it was replaced, and that needs a decision

My earlier note said `deadline-priority.ts` "still ships". That was wrong. The
module is present and `plan-creator.tsx` can still render its card, but on this
branch **nothing calls `buildDeadlinePriority`**. Main calls it twice in
`src/app/api/plans/generate/route.ts` — once before any AI usage is metered,
once after the subject is resolved. Codex's plan-model commit `66f4c9f` removed
both calls without recording it, and replaced the behaviour on purpose:
`route.test.ts` "keeps the full topic queue when only 1/4/5/9 minutes remain and
explains constrained suggestions" asserts that the same input main answered with
a priority card now returns the full topic queue with an "after the deadline"
constraint. Restoring the browser cases would mean reversing that. Held for the
founder; the five priority cases stay in `notReplaced` and keep blocking.


### Deadline priority restored (founder decision, 18 Sept 2026)

Codex's replacement is reversed. With every remaining window before the
deadline under ten minutes, the learner again gets one quick priority action —
"Focus on <first topic>", what to do in the minutes available, and "This card
does not record a completed session or mark the topic as learned" — instead of
the full topic queue marked "after the deadline".

**Red:** `src/app/api/plans/generate/route.test.ts` "offers a priority card when
only 1/4/5/9 minutes remain, without claiming a lesson was completed", restored
from main in place of Codex's "keeps the full topic queue when only … minutes
remain", failed four times: `expected { plan: … } to match object { kind:
'deadline_priority', … }`.

**Green:** `buildDeadlinePriority` is called again at the two points main called
it in `src/app/api/plans/generate/route.ts`: once before any AI usage is
reserved, so a three-minute learner costs nothing, and once after the accepted
subject is resolved, settling the claim. All 61 route tests pass; nothing in
`deadline-priority.ts` or the card changed.

**Browser coverage restored under main's exact titles**, so the release
comparison matches them directly rather than through a rename:
`explicit 1/3/5/9-minute availability remains a priority card` and
`consolidated: a three-minute priority records no completion`. Each asserts the
server response is the card with no plan, the card's heading and no-credit
sentence are visible, and there is no "Use this plan" button and no grouped plan;
the three-minute case also clicks Done and asserts no completion and no active
plan were saved. The three-minute case reproduces main's real deadline clipping
an ordinary 45-minute evening window, nothing fabricated. Local focused run:
`explicit 3-minute availability remains a priority card` **passed in 2.2 s**;
CI runs all five. `notReplaced` is now empty and removed from
`retired-cases.json`.

Local checkpoint: 4,566 unit tests passed, 26 runner checks, lint and types
clean.


## CI run 427 on `38a9b0a` ([35334170263](https://github.com/sebastianjudeziegler-byte/yova/actions/runs/35334170263))

**Release comparison: "No regressions versus main."** First time on this branch.
Against main `0ce2292`: 4 no regression, 2 established flaky quarantine,
2 unavailable, 10 pre-existing — **zero blocking**. Raw live counts
`{"pass":51,"fail":5,"flaky":21,"unavailable":2}`.

- **Core journey: 234 passed, 5 failed** — exactly main's own five (material
  drop zone on both projections, three mobile calendar cases). The quick-add
  deadline, the founder journey and all five restored priority-card cases pass.
- **Live practice: 15 passed, 2 failed** — the live 24- and 32-question
  workloads. Step 20's synthetic 32-question trace also failed.
- Steps 34 (the raw live gate, which fails on any live failure by design) and
  20/22 are red; step 35, the release gate, is green.

### The 24/32-question failures, from the captured trace

`stdout: "pipe"` worked: 109 content-free `YOVA_SHAPE_SLOT` lines in the live
step log. Plus the founder-authorised artifact
`session-generation-diagnostics-35334170263` (31,759 bytes).

| Request | What happened | Remaining budget |
| --- | --- | --- |
| Live 32 (`3ba96ad4`) | learn block, 3 batches, 4 review batches all `completed`; 3 of 32 rejected; repair `completed`; re-review of 3 against 29 earlier questions: provider `completed` → quality **`invalid`**, twice | 6.4 s left |
| Live 24 (`4c3a5ea3`) | all `completed`; 6 of 24 rejected; repair `completed`; re-review of 6: provider `completed` → quality **`invalid`**; retry timed out at the edge | 2.0 s |
| Synthetic 32 | a slow first call (13.0 s); 3 rejected; repair; re-review of 3 against 29 given 7.7 s → `timeout`, then `deadline` | 2.0 s |

So there are two different failures, and both sit in the same place, the
re-review of the few repaired questions against every question accepted before
them. The synthetic one is the time budget. The live ones are not: the reviewer
answered in time, and our own check rejected the answer.

Which check, from the code rather than inference: the provider records
`completed` only after the reply passes `ReviewSchema`
(`shape-slot-generator.ts:116-119`), and the reviewer's other rejection paths
are either impossible here (the target set is 3 or 6 unique repaired slots) or
the **coverage** check — every target reviewed exactly once, and nothing else.
What the trace cannot say, because it carries no content by design, is how
coverage failed: a review of an earlier question, an invented slot, a duplicate
or a missing target.

That is now recorded. An unusable review reply emits its reason as codes and
counts only — `no_reply`, `schema` (with issue codes and paths) or `coverage`
(with expected and returned counts, and how many returned reviews named an
earlier question, an unknown slot or a duplicate). Red first: `names why a
review reply was unusable, without any question content` failed without the
change and passes with it, and asserts no question text reaches the diagnostic.
386 generator and review tests pass; 4,567 overall.


## Option B — a long practice pass is one sitting in parts of at most eight (founder decision, 18 Sept 2026)

Runs 427 and 428 settled why 24- and 32-question workloads failed: one request
chained five model stages — lesson and first questions, the rest of the
questions, review, rewrite, re-review — into a 50-second budget, and it fit
only when every call was quick. The founder chose to keep one sitting sized by
the profile and deliver its practice in scaffolded parts instead.

**What changed.**

- `src/lib/practice/practice-parts.ts` splits a first pass of N questions into
  ⌈N/8⌉ near-equal parts (32 → 8·8·8·8, 20 → 7·7·6, 10 → 5·5) and orders every
  planned question easiest first — recall, misconception, application,
  prediction, comparison — so the pass builds up. The plan is deterministic, so
  the server recomputes any part from the same key points, mix and count.
- One request writes one part. The learn block writes part one with its lesson,
  and still teaches for the whole workload. Each later part is a practice
  request carrying the key points and every earlier prompt, so it asks something
  new. Retry rounds are capped at eight too. The old multi-batch fill and its
  cross-batch collision repair are gone, because a request no longer spans
  batches; a repeated prompt inside a part already fails that reply's own check
  and is retried once. Each part is independently reviewed on its own budget.
- The route refuses a malformed part (outside the first pass, past its end, or
  a later part with no key points) with 422 before any model spend; the
  generator refuses a part count that does not match the recomputed plan.
- The session asks for the next part as soon as the current one arrives, so it
  is normally waiting when the learner gets there; otherwise a short "Preparing
  the next part…" card shows. The counter reads "PART 2 OF 3 · QUESTION 1 OF 8",
  the last question of a part offers "Next part", and a part that cannot be built
  becomes an honest error only when the learner reaches it, with Try again
  asking for that part and keeping every answer. The round is judged only after
  its last part, so missed-point repair still follows the whole pass. A session
  saved before parts existed resumes as a single part. Short sessions, already
  at eight or fewer, look exactly as before.
- The workload is unchanged: a 32-question block is still 32 questions and the
  same estimate. The profile still sets the size; only the delivery changed.

**Red, then green.**

| Test | Red | Green |
| --- | --- | --- |
| `src/lib/practice/practice-parts.test.ts` (12) | module did not exist | pass |
| `shape-slot-generator.test.ts` "delivers a 24-question learn_block/practice workload as its first part of eight, recall first", "writes a later part from the same plan, harder than the first, and away from every earlier prompt", and three refusals | 6 failed | pass |
| `shape-c.test.ts` "Shape C first pass in parts" (6) | 5 failed | pass |
| `shape-slot-handler.test.ts` three malformed-part refusals | 3 failed with the guard removed | pass |

Tests written for the old one-request contract were rewritten to it, not
relaxed: a part repeating a prompt is retried once and then refused; a retry
round with nine missed points is capped at eight in one call carrying its retry
context; the learn block's first slots are built up, recall and misconception
first.

**Browser proof.** New `e2e/baseline-practice-parts.spec.ts` (stubbed slot
replies at the network boundary, as in the other baseline specs — not a test of
generation): a 16-question block shows "PART 1 OF 2 · QUESTION 1 OF 8"; the
part-two request left while part one was still open, carrying `part {2, 2}`,
all eight earlier prompts and the lesson's key points; "Next part" hands over to
"PART 2 OF 2 · QUESTION 1 OF 8"; the round finishes clean after the last part,
and exactly one part request was made. The one focused local browser run:
**passed on desktop (3.8 s) and phone (3.3 s).**

**Live gates rewritten to the new shape.** The 6/24/32-question live cases now
request a workload exactly as the session does, part by part, timing each part.
They require every part to arrive, at most one question short per part, no
repeated prompt across parts, difficulty never stepping back across the pass,
recall first, and transfer work in the later parts. The synthetic 32-question
trace runs four parts, each with its own provider and budget, requires each
part under 50 s and reviewed, and records every call by part. The profile
journey and the retry journey now wait through "Preparing the next part…" and
press "Next part". These run in CI only.

Local checkpoint: 4,590 unit tests, 26 runner checks, lint and types clean.


### CI run 429 on `c0fe502` — option B's first run ([35351341107](https://github.com/sebastianjudeziegler-byte/yova/actions/runs/35351341107))

**Parts fix the time wall.** Step 20, the synthetic 32-question trace, passed in
four parts at **14.8, 22.6, 21.7 and 25.6 s** — each well inside its own 50 s
budget, 32 questions delivered, every part reviewed (founder-authorised artifact
`session-generation-diagnostics-35351341107`, 22,496 bytes). Its part one, eight
recall questions, passed review 8 of 8.

**Release gate: INCONCLUSIVE, not blocked.** "14 of 79 live cases were
unavailable (17.7%, over the 10% ceiling). The provider was degraded, so this
sample cannot establish a regression either way." A re-run is needed.

**Live practice: 15 of 17 passed** — both profile journeys and their comparison,
outside study, both retries, Practice Test and Interleaved Review on desktop and
phone, and the 6-question workload. The two failures are both in **part one of
the live 24- and 32-question workloads**, and both came fast (22 s and 30 s), so
not the budget:

| Live request | Review of part one | Rewrite and re-check | Result |
| --- | --- | --- | --- |
| 24-question (`e12e432c`) | 6 of 8 rejected | 6 of 6 still rejected | 2 left, under the floor → refused |
| 32-question (`3130c0f0`) | 8 of 8 rejected | 3 of 8 still rejected | 5 delivered, under the gate's 7 |

The synthetic run, on the same topic and mix, accepted the same kind of part
8 of 8. The live logs carry only counts, so they cannot say why the reviewer
rejected so much of part one there — and nothing is inferred. The completed
review diagnostic now also tallies why, using only the reviewer's fixed codes
(`repeated`, `ambiguous`, `missing_conditions`, `demand_not_met`, `duplicate`,
`answer_disagrees`, …), never the question or the reviewer's prose. Red first:
`tallies why questions were rejected, as codes only`; the privacy test now
permits the codes and still forbids any private text.

**Three browser regressions of my own making, fixed.** Three journeys answer a
session by clicking through it, and none knew the new "Next part" button:
`baseline-session.spec.ts` (the try-it-first learner, whose session now has more
than eight questions), `living-plan.spec.ts` (the founder journey, which failed
on both projections at "Finish") and the live outside-study journey. Each now
waits through "Preparing the next part…", presses "Next part", and the founder
journey's step allowance rose from 40 to 90. Local focused run: the founder
journey **passed in 7.7 s**. Core journey otherwise: exactly main's own five
failures.
