# Brief C — evidence

Status: narrowly approved source-binding correction passes three CI runs. Brief C block-runtime implementation and its remaining gates are in progress.

- Branch: `codex/brief-c-source-first-practice`.
- Starting source: `971e258c539046276e8d165fdaa4651639831044`, Brief B's current head.
- Main observed at preparation: `c7b3ca99964524cefc04437b7236b37fe8fe2666`. Brief B was not merged when this branch was created. Its screenshot's merge suggestion is context, not release authorization.
- Work is serial. No local test, browser, live-gate, build, database, merge, deployment, or production-setting operation has been run for Brief C.
- PR #85 merged on September 10, 2026 at 11:36:25 UTC. Rebase completed onto `80323614fec32563a340528fb558a84657a00773`; HEAD and merge-base with origin/main both equal that merge commit before Brief C changes.
- Founder decisions are approved in [DECISIONS.md](DECISIONS.md), including one cached semantic check per block and no validation retry loops.

## Verification to collect in GitHub Actions

Initial CI: [34472411719](https://github.com/sebastianjudeziegler-byte/yova/actions/runs/34472411719), tested commit `c3422c4` on base `8032361`. Mixed-source entry **one red / two green controls**; five validator suites **101/101 green**. Only tests, workflow and documentation differ from main product code. [Raw evidence](evidence/initial-source-boundary/) and [root cause / proposed pipeline correction](SOURCE-BINDING-DECISION.md). The unsourced Enzymes session cannot open because the pipeline commits the other topic's PDF requirement onto it. No correction or green claim yet.

Every behavior row below needs an observed failing assertion before implementation and a passing assertion afterward. These are planned checks, not results.

### Pre-existing Brief B source-binding seam

Expanded red run [34473280983](https://github.com/sebastianjudeziegler-byte/yova/actions/runs/34473280983), source `958f53ed7f63340d5a4bdb94ebba7e896a62f8ac`: **42 pass / 2 fail / 1 skipped** across the source boundary, normal pipeline and Brief B revision suites. Both failures are the unsourced topic inheriting another topic's PDF requirement. The source-revision byte-identical assertion passes. The five validator protection suites remain **101/101 pass**. Product files at this revision are identical to main `80323614fec32563a340528fb558a84657a00773`, establishing this as a pre-existing Brief B seam. [Expanded raw evidence](evidence/expanded-source-boundary-red/).

Founder approval is limited to topic-scoped source binding. The correction changes only the source requirements and binding provenance committed by the existing normal pipeline, with corresponding runtime source checks. Topic IDs, methods, schedule and revision composition logic remain under their existing owners. Legacy committed routes retain their old source contract; new routes require exactly their assigned topics' sources. Missing, substituted or subsequently changed sources still fail closed. No green claim until CI completes.

First correction run [34473797339](https://github.com/sebastianjudeziegler-byte/yova/actions/runs/34473797339), `59f1fc4`: all six source-boundary assertions pass, including byte-identical unrelated sessions; the surrounding Brief B explicit-copy test catches a URL classification regression (**44 pass / 1 fail / 1 skipped**). Learner-attached URLs were incorrectly classified as `trusted_external_source`, whose existing schema requires outside-YOVA execution. Corrected the source classification to learner-provided (`user_materials`) for both topic attachments, retaining opaque URL bindings and the unchanged execution environment. No execution/schema constraint was relaxed. Typecheck, lint and all 101 validator protections passed in this run.

Green [34474037490](https://github.com/sebastianjudeziegler-byte/yova/actions/runs/34474037490), `6b1bedc6eaac2dabd3a34bb174b740c6f9c205a8`: **45 pass / 0 fail / 1 skipped, in each of three consecutive runs**. Both original main failures now pass, the source-revision byte-identical test stays green, and Brief B's existing URL/explicit-copy protection passes unchanged. Typecheck and lint pass; validator protections **101/101 pass**. The skipped database fixture needs its dedicated database gate and is not counted as a pass. [Raw three-run evidence](evidence/source-boundary-green/). This completes the approved source-binding correction; it does not constitute the full Brief C gate.

### Saved block content boundary

Red [34474179366](https://github.com/sebastianjudeziegler-byte/yova/actions/runs/34474179366), `ab93975c0ec8dc7851998d27541c364d1044a472`: three learner-visible cache assertions fail because the existing resource reader drops the proposed block entirely: no objective/source instructions, no source-first sequence or saved prompts, and no preserved P1/P2 support delta. These are deterministic prepared-content fixtures, not provider quality evidence. The source-boundary tests continue passing all three samples; typecheck, lint and 101 validator protections pass. The implementation adds a separately versioned public block resource (V19; reserved V18 remains untouched), validates its structural bindings, and retains the saved content on reopening. Provider generation, server-owned scoring and the UI journey are separate outstanding gates; the cached semantic-review descriptor is not scoring authority.

Green [34474665624](https://github.com/sebastianjudeziegler-byte/yova/actions/runs/34474665624), `1c8bb9ecf4fdafd84d35b01c7555e5fbb2a839b7`: **23/23 pass** across the saved-block assertions and existing resource reader suite. All three original red assertions pass; new controls reject cross-topic questions/sources, duplicate choices/prompts, missing practice, source/mode mismatch, stale route receipts and forged evidence fields. Typecheck, lint, three source-boundary samples and 101 validator protections pass. [Raw cache evidence](evidence/block-cache-green/).

### Production generation defaults

Red [34474938914](https://github.com/sebastianjudeziegler-byte/yova/actions/runs/34474938914), `33fab1c399b3c86ff2119edc6093bd4780e487be`: **six failures** before implementation. Production returns no source-first work block, no no-source AI block, no practice-only covered block, no delivered profile delta and no single cached semantic review; a failed-review fixture incorrectly resolves through the existing lesson path. The tests use injected provider fixtures and assert the resulting learner-visible content; they are not live-provider canaries. [Raw red evidence](evidence/block-generation-red/). Block cache tests, source-boundary tests, typecheck, lint and all 101 validator protections remain green in that run.

Provider integration follows the existing configured session model and the official [Responses structured-output contract](https://developers.openai.com/api/docs/guides/structured-outputs). Each preparation/review request explicitly disables SDK retries, has a finite timeout, and uses `store: false`. Block contents and answer keys are prepared once; semantic review is a separate bounded call over the whole block, never an attempt-level call. No pipeline or production configuration change accompanies this runtime work.

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
