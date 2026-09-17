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
