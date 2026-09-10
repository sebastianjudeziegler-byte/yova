# Brief C — evidence

Status: initial CI regression evidence pending. No product behavior has changed.

- Branch: `codex/brief-c-source-first-practice`.
- Starting source: `971e258c539046276e8d165fdaa4651639831044`, Brief B's current head.
- Main observed at preparation: `c7b3ca99964524cefc04437b7236b37fe8fe2666`. Brief B was not merged when this branch was created. Its screenshot's merge suggestion is context, not release authorization.
- Work is serial. No local test, browser, live-gate, build, database, merge, deployment, or production-setting operation has been run for Brief C.
- PR #85 merged on September 10, 2026 at 11:36:25 UTC. Rebase completed onto `80323614fec32563a340528fb558a84657a00773`; HEAD and merge-base with origin/main both equal that merge commit before Brief C changes.
- Founder decisions are approved in [DECISIONS.md](DECISIONS.md), including one cached semantic check per block and no validation retry loops.

## Verification to collect in GitHub Actions

Every behavior row below needs an observed failing assertion before implementation and a passing assertion afterward. These are planned checks, not results.

| Behavior | Learner-visible assertion and protected boundary | Red | Green |
| --- | --- | --- | --- |
| Block shape | Objective, source, instructions, activities, stopping point, and duration are visible. | Pending | Pending |
| Source-first | A usable attached section opens before practice; no-source learn opens with AI explanation; covered/evidenced work opens with practice and optional help/source. | Pending | Pending |
| Help and continuation | Help stays in place; a failed request preserves progress; after an explanation the learner can continue without a forced retry. | Pending | Pending |
| Practice quality | Cards, MCQ/short-answer quizzes, and worked problems are section-supported, answerable, unambiguous, and give useful feedback. Negative cases retain off-topic/deferred-topic/duplicate protection under the approved contract. | Pending | Pending |
| Stable set | Leave/resume, reveal, and report-bad-question retain the saved set and progress. Another resource or route cannot inherit that progress. | Pending | Pending |
| Profile delta | Same lecture PDF/topic: differ on at least three of first practice kind, example presence, hint availability, and set size; receipts also differ and reference the profile. Record side-by-side P1/P2 printouts. | Pending | Pending |
| Completion and evidence | Source completion alone cannot finish a block or create topic evidence. Only checked practice produces evidence; forged client outcomes and stale/wrong-resource receipts are rejected. | Pending | Pending |
| Receipt | The completed block states what was demonstrated, what changed, and what comes next, referencing profile or actual result. | Pending | Pending |
| A17 | First block meets the founder-approved broad-calculus behavior. | Pending | Pending |
| Founder journey | Frozen clock, sourced PDF topic plus unsourced topic; source-first versus AI explanation; leave/resume mid-quiz; practice required; receipt. Desktop and mobile screenshots/video. | Pending | Pending |

The closeout gate runs in GitHub Actions: unit, lint, typecheck, build, migration replay/database tests if changed, desktop/mobile browser journeys, Brief A/B compatibility, no-source streamed/graded/completed flow, and live canaries. Compare failed cases with main at recorded source revisions. A pass-to-fail or lower scoped pass rate blocks; intermittent non-regressions are quarantined with captures and backlogged; provider/environment unavailability is neither red nor green. Do not count Brief B's prior results as Brief C verification.

The founder's validator conditions also require a permanent assertion that semantic review makes one bounded provider call per block, saves its judgment with the block, and makes zero further semantic-review calls on answer attempts, resume, or reveal. Semantic failure must reach the existing recovery state without an automatic retry loop. Structural negatives remain deterministic.

Retain every Brief 0.5 negative, including the suites recorded in that brief's evidence: `src/lib/openai/streamed-validator-calibration.test.ts`, `src/lib/session-generation/question-context.test.ts`, and `src/evals/brief-0-5-rubric.test.ts`, plus surrounding completion/lesson-claim tests. These protect photosynthesis/off-topic answers, deferred ATP use in prompts and distractors, cross-topic authority, neighboring history claims, wrong/extended formulas, duplicate claims and choices, missing operands, empty answers, malformed equations, and unbound or mismatched variables. The complete unit gate—not a selectively reduced list—must remain green.

Known pre-existing failures/flakes remain outside this brief: deferred legacy-material cases, osmosis, A05, and cross-tab Calendar timeout. A17 follows the approved bounded-first-topic decision here; it is not silently treated as a new regression.

## Default generation path inventory

See [DEFAULT-GENERATION-PATHS.md](DEFAULT-GENERATION-PATHS.md). Its current entries describe the starting source, not the promised final state. At closeout, identify every remaining default AI lesson-generation call and prove that each is reachable only for unlearned work without a source. Optional targeted help remains separate from default lesson generation.
