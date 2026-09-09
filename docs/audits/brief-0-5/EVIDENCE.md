# Brief 0.5 — grader calibration and first-session validation

## Handoff to GitHub Actions

Local verification was stopped at the founder's request. Application source remains exactly `e978f36bd0e3684f0b3595d6c2379da3e2686d0a`; the publication commit adds audit evidence only. No further local browser or provider runs are authorized. This PR is stacked on `codex/brief-0-live-gate-triage` (PR #82), without merging either branch.

- **Three-run local evidence:** all ten scoped cases passed 30/30 attempts; the nine new grader canaries passed 27/27. The main red/green comparison below retains intermittent main successes and unavailable attempts.
- **Static gates:** 3,918 unit tests, 12 runner checks, lint, typecheck, and build passed on the tested source, then passed again after exact-lockfile dependency restoration. These are passing static runs; they are not represented as three separate final-source runs.
- **Still required in CI:** the interrupted/mobile core coverage; the legacy Study Profile phone-width comparison on main and this branch; a complete available full live gate; and Brief A compatibility on the combined revisions.

The already-finished local tail is retained, not retried: the mobile follow-up reports 9 pass / 14 fail after a long host interruption; Brief A's temporary combined deterministic delta passes and its live delta cannot resolve `api.openai.com`; the final full-live attempt reports **4 pass / 6 fail / 6 flaky / 59 unavailable**, with widespread `ENOTFOUND api.openai.com`. Raw failed wrapper rows remain visible; this transport-affected run does not establish the required full live sign-off. See [mobile report](evidence/ordinary-browser-followup/core-mobile-chromium/report.json), [Brief A manifest](evidence/brief-a-integration/manifest.json), and [full live table](evidence/full-live-gate/report.md). Brief A source restoration is recorded as true; none of its source changes are included here.

### CI availability and missing coverage

The existing `YOVA quality` pull-request workflow runs unit/build/ordinary desktop and mobile journeys and auth. It can verify the remaining ordinary coverage after this PR opens. Its current definition does not perform the explicit main/branch Study Profile comparison or a combined Brief A compatibility run.

The `Full live gate` workflow is supplied by the still-unmerged Brief 0 branch. It is scheduled/on-demand, does not automatically run for a new PR, and was absent from `main` when checked. Activating/dispatching that workflow from the default-branch setup remains a CI prerequisite; this task does not merge it. The job requires the repository Actions secret `OPENAI_API_KEY`. The available connector does not establish whether that secret is configured, so its presence is **unverified**, not asserted missing. No local or production credential was copied into GitHub settings. The live job's artifact reports missing keys as unavailable.

Brief A compatibility additionally needs a CI job that combines Brief A `340c8b6e8b663c0be8ef6fafa72c8d735e08c122` with this tested source, then runs both delta tests; the ordinary quality workflow alone cannot prove that integration while the branches remain separate. These requirements are handed off to CI, not worked around by more local runs.


## Root-cause record, before product changes

Recorded 2026-09-09 while the checkout is detached at main `e03a082659f51172c0b06bf84daffdd5599ac773`. No product source has been changed. The requested branch `codex/brief-0-5-grader-and-validators` was created from Brief 0's `d108e890e3f64e4393f617fe821ac0eb3b7b3c8e`, whose `src/lib` is identical to this main. It inherits the full gate and corrected stale expectations; the PR will be stacked on Brief 0 while that dependency remains unmerged. No merge or production setting change is authorized here.

The initial investigation identified one grader cause and **three validator/recovery causes**, rather than ten independent case-specific defects. Subsequent captured-response replay exposed a fourth independent validator heuristic, factual-year recall misclassified as arithmetic; the final count and its pre-edit discovery record appear below. The observations below come from fresh, serial calls using the existing local environment and provider key. Test-only pass-through instrumentation records synthetic provider inputs, parsed responses, rejected subject comparisons, and bounded recovery errors. It does not alter returned content, validation, retries, timing limits, or model configuration.

### G — free-form grading has no enforced decision order or consistency contract

`answer-evaluator.ts` asks for a verdict, matched ideas, missing ideas, and feedback independently. It says that an insufficient prompt warrants uncertainty but neither makes answerability an explicit first decision nor separates required rubric criteria from optional reference detail. It returns every schema-valid provider judgment unchanged. Fresh main run 1 reproduced A01/A02 as **secure plus optional missing details** (water formation; return unwinding), and A03 as **secure despite an unidentified process/condition and missing observations**. This is not a wrong-answer synonym problem.

Planned shared correction: make sufficiency and required-criterion assessment explicit in the internal provider contract, derive the public verdict and missing-idea list consistently, and retain the existing public response shape. No extra learner step or client evidence authority. Permanent live fixtures must exercise insufficient context/answers and complete answers across biology, programming, and history; deterministic tests must prove contradictory provider fields cannot create secure evidence.

### V1 — a lexical claim matcher is used as a general subject validator

`lessonIdeaSharesTargetSubject` discards tokens shorter than three characters (including mathematical variables), demands two overlapping terms for long labels, and imposes short-claim length caps for one/two-word labels. Its callers also pass whole questions, answers, feedback, and four recognition choices. A valid long chain-rule recognition surface therefore fails the same check intended to reject a short unrelated claim. A formula-only plan target can lose essentially all its mathematical subject. In X06's first recovery, “Phospholipids form a hydrophobic core that blocks most polar or charged substances” is rejected against “Explain how phospholipid structure creates selective permeability”; the mapped bilayer reference is discarded wholesale because one map topic owns two active targets.

Planned shared correction: preserve symbolic subject identity, distinguish bounded claims from complete check surfaces, and admit only individually scoped authoritative topic references where they can be attributed uniquely. Do not lend broad topic vocabulary to every target or weaken the complete deferred-content boundary. Negative tests must retain the Sept 7 photosynthesis and deferred-ATP-use protection and cover cross-target attribution and complete question surfaces.

### V2 — recognition deduplication erases mathematical meaning

`normalizeRecoveryQuestion` replaces every non-ASCII letter/digit with spaces. Primes and operators disappear, so different derivative answers can be declared identical. A15's second fresh main run fails the compact schema at `recognitionCheck.choices` (“Every recognition choice must be distinct”) after the formula-only target also triggered V1. A schema failure here is not provider unavailability.

Planned shared correction: use comparison that preserves mathematical operators and primes while normalizing harmless presentation differences. Continue rejecting genuinely identical choices and repeated independent questions. Preserve all subject/deferred-topic checks on the complete recognition surface.

### V3 — recovery asks the provider to infer distinctions and structure the server already owns

`compactRecoverySlots` expands a single broad objective into repeated, identical input slots. A32's first fresh main run returned exactly the same essential idea twice, so `streamed_target_assignment_duplicate` is a **correct rejection**. A27 passed that fresh attempt with two distinct claims; prior 0/3 failure is not proof it must fail today. In addition, the recovery schema permits nullable independent checks even when the server already knows whether a check is required; a fresh WWI run supplied an incompatible shape and was rejected after generation.

Planned shared correction: communicate claim counts grouped by authoritative target and constrain the known independent-check shape in the provider schema. The duplicate-claim guard remains strict. Distinct subclaims must survive into distinct learner-visible teaching/check mappings; genuinely duplicate claims must still fail.

### Obsolete WWI subchecks

Fresh A35 run 1 generated the first, prewar-alliances teaching block and failed the global Sarajevo assertion. Fresh A36 run 1 generated two teaching blocks and failed the hard-coded three-block assertion. Before removing either, document the dated replacement contract: each streamed block teaches its assigned claims, and method-aware pacing owns teaching/check counts. Keep the full 45-minute allocation, all active/deferred coverage, required evidence, subject content, and no-later-topic checks.

## Baseline and completed local verification

The prior Brief 0 baseline and the fresh September 9 main runs are separate evidence sets. Every attempt is retained; successful baseline attempts are not discarded to manufacture three reds. A provider timeout is neither red nor green. The final implementation is pinned at `e978f36`; its three-run sample is recorded below, followed by the full gate.

### Three-run comparison for the ten scoped cases

`P` = passed, `F` = assertion/semantic failure, `U` = provider unavailable. Entries preserve run order; unavailable is neither red nor green. Main is `e03a082`; final branch source is `e978f36`. The [machine-readable comparison](evidence/scoped-comparison.json) links every attempt.

| Case | Brief 0 main runs | Fresh main runs | Final branch runs |
| --- | --- | --- | --- |
| A01 — accepts a correct biology paraphrase | F/F/F | F/P/P | P/P/P |
| A02 — accepts a concise programming explanation | F/F/F | F/F/F | P/P/P |
| A03 — admits uncertainty when the prompt lacks necessary context | F/F/F | F/F/F | P/P/P |
| A15 — One product-rule skill in short sessions | F/U/F | U/F/F | P/P/P |
| A22 — Mapped product-rule and chain-rule first lesson | F/F/F | F/F/F | P/P/P |
| A27 — Beginner JavaScript with fading support | F/F/F | P/P/P | P/P/P |
| A32 — Spanish conversation with supported transfer | F/F/F | F/F/F | P/P/P |
| X06 — builds a topic-specific teaching skeleton | F/F/F | F/P/P | P/P/P |
| A35 — delivers substantive teaching from the first generated lesson brief | F/F/F | F/F/F | P/P/P |
| A36 — creates the production 45-minute streamed teaching session | F/F/F | F/F/F | P/P/P |

All ten passed all three final runs. The historical baseline supplies the three-run red record; fresh main shows that A27 already passed 3/3, and A01/X06 passed 2/3. Those fresh successes are retained, not relabeled. A15 has one unavailable attempt in each main sample. The captured deterministic replays establish the specific broken boundaries independently of provider variability.

The nine new cross-subject grader canaries also passed 27/27 attempts. Osmosis and finance comparison cases each passed 3/3 on the final branch. The [complete final sample](evidence/final-live/cases.json) contains 63/63 passing attempts with zero test-runner retries. These scoped runs do not substitute for the complete live gate.

### Permanent red/green checks and negative coverage

| Boundary | Red evidence | Passing verification / protection retained |
| --- | --- | --- |
| Grader answerability and optional details | [Four deterministic failures](evidence/grader-unit-red.txt); [live 1](evidence/grader-canary-red-1.txt), [2](evidence/grader-canary-red-2.txt), [3](evidence/grader-canary-red-3.txt) | Nine permanent live fixtures cover complete answers, underspecified answers, and missing context across biology/programming/history. Public verdict/missing/feedback fields are checked. |
| Subject/notation and target references | [Captured main failures](evidence/validators-unit-red.txt) | Captured membrane, formula, and product/chain lessons deliver their claims and required answers. Off-topic photosynthesis, cross-target passive transport, and deferred ATP use remain rejected. |
| Answer authority and secure feedback consistency | [Three additional red cases](evidence/additional-guards-red.txt) | [111 focused checks passed](evidence/additional-guards-green.txt) on the preceding revision. An on-topic heading cannot authorize an off-topic correct answer; secure feedback cannot independently contradict assessed required criteria. |
| Explicit function arguments and eval contracts | [Captured trial failures](evidence/representation-red.txt) | Explicit common arguments pass; different arguments, different derivatives, extended equations, and genuinely duplicate choices fail. The captured short JavaScript answer and bounded product-rule lesson pass the rubric; empty answers/off-topic teaching still fail. |
| Factual years and explicit recognition binding | [Old year/binding expectations fail](evidence/year-and-binding-red.txt) | [90 focused checks passed](evidence/representation-green.txt) on final `3eaa459`. Year recall passes; date calculations with missing operands and hidden prompts fail. A neighboring Sarajevo claim cannot authorize the final chronology slot. |
| Genuine duplicate recovery claims | [Main A32 capture](evidence/main-live/run-1-session-quality-capture.jsonl) | The exact duplicate remains a negative replay. Grouped claim counts must produce distinct claims visible in teaching and evidence-map entries. |

The initial `representation-red` history positive incorrectly assumed a Sarajevo answer belonged to the final chronology claim. Inspection proved that rejection correct: it is now a permanent negative. The actual armistice-year positive is a separate captured response. This correction is not reported as a validator fix or a green result for the original Sarajevo response.

The permanent negative cases live in [`streamed-validator-calibration.test.ts`](../../../src/lib/openai/streamed-validator-calibration.test.ts), [`question-context.test.ts`](../../../src/lib/session-generation/question-context.test.ts), and [`brief-0-5-rubric.test.ts`](../../../src/evals/brief-0-5-rubric.test.ts). They exercise photosynthesis/off-topic answers, deferred ATP use in questions and distractors, cross-target authority, neighboring WWI claims, wrong or extended formulas, genuinely repeated claims/choices, missing calculation operands, and empty answers. Case-sensitive code choices remain distinct.

Static verification at `e978f36`: [3,918 unit tests and 12 gate-runner checks pass](evidence/unit-full.txt); [lint](evidence/lint.txt), [typecheck](evidence/typecheck.txt), and [build](evidence/build.txt) pass. The [static gate manifest](evidence/static-gates.json) records commands and exit codes, including silent successful checks. No migration was changed, so migration replay is not applicable.

## Deferred cases

- A16: legacy WWI unit-guide source mapping; explicitly outside this brief.
- A19: legacy biology-notes source mapping; explicitly outside this brief.
- A24: legacy beginner-WWI source handling/intent question; explicitly outside this brief.
- A30: legacy history primary-source mapping; explicitly outside this brief.
- A31: legacy literature source mapping; explicitly outside this brief.
- A33: legacy thin-biology-guide source mapping; explicitly outside this brief.
- A05: optional-placement generator/verifier disagreement; explicitly outside this brief.
- A17: broad-calculus task-alignment intent question; explicitly outside this brief.

No product-shape change, Brief B work, legacy-material repair, merge, deployment, or production configuration change is included.

## Implementation and verification refinements

The implementation keeps the public session/evaluation shapes and provider-call ceilings. The grader's internal assessment distinguishes context sufficiency, required criteria, and optional facts. Code derives verdict and missing ideas; secure feedback is assembled from established required criteria so a separate feedback sentence cannot contradict them. The original seven grader fixtures and nine permanent cross-subject canaries passed three runs of the first grader revision (17 tests per run including collection); final implementation runs follow below.

The validators share a notation-preserving comparison helper. Mathematical prime notation is included in evidence matching; distinct operator/prime expressions stay distinct recognition choices. A formula target accepts a complete right-hand answer without requiring the question's left-hand side to be repeated, but a different or extended formula is not accepted as that target. Whole checks do not inherit short-claim length caps. Correct answers and their explanations must prove subject identity independently of headings; every prompt and distractor still passes the complete deferred-content check. Shared generated map topics lend only subtopics attributable to exactly one active/deferred label. Legacy material authority is unchanged.

Compact recovery now receives one group per authoritative target with a required distinct-claim count. It does not receive duplicate copies of an otherwise identical slot. The provider schema enforces the server-known independent-check shape. The genuine duplicate-claim rejection is retained. No new provider stage was added; invalid output can now use the existing bounded recovery, with the same call ceiling.

### Dated replacement for A35/A36's obsolete subchecks

The method-aware teaching cycles in `b8f5e1026ff0cdbd57ff77e58f72a44d8fdf1a9c` (2026-09-01, `streamed-pacing.ts`) reserve the named method's repair/re-explanation and recognition activities. A36 therefore uses that pacing contract plus visible teaching-before-required-check assertions for every evidence-map entry, post-teaching recognition, exactly 45 allocated minutes, all three active ideas, and an empty deferred list. A fixed three-teaching-block/three-question count was not that contract; optional reflection remains allowed.

A35 streams the first assigned lesson brief. Its prewar-alliance block must explain European rival blocs/tensions and locate them before World War I. The lesson need not print the literal year 1914 when it explicitly says prewar/before World War I. Sarajevo and mobilization/declarations remain asserted whenever the first brief actually assigns them. The lesson-length, alliance content, and no-UI-instruction assertions remain. The prior global Sarajevo/date checks failed on otherwise substantive first-block teaching; the full failed printouts are retained in the main and trial logs.

The first three-run branch trial is retained separately in `evidence/branch-trial`: it exposed abbreviated formula rejections and over-specific replacement assertions (literal 1914; forbidding a valid trailing reflection). These are not reported as final green runs. Added deterministic guards also exposed and then corrected the heading-only subject loophole and inconsistent secure feedback. All 111 focused tests, including the old deferred-content negatives, then passed.

### Local runner environment

This host's pnpm 11 automatic dependency verification attempted to reinstall the already-present modules and stopped because no TTY was available. At that earlier attempt no install/purge was accepted and the lockfile/dependency versions were not changed. Gate commands use the installed pnpm's documented-in-code `pnpm_config_verify_deps_before_run=false` process override to execute the same package scripts against the same existing modules. Temporary pass-through capture code is removed from the checkout during lint/typecheck/build and is never shipped as application code. Live provider keys/models are unchanged; no environment values or credentials are committed.

The second three-run trial at `6b4683c` remains in `evidence/branch-trial-2`: all grader canaries passed, but A15 rejected explicit function arguments, and A35/A36 rejected short valid chronology answers (Sarajevo; 1918). This refines V1: checks need the already-validated, target-assigned teaching claim as subject authority, not only the compact curriculum label. Claims must pass the existing target/deferred/duplicate validation before they can supply this authority. Mathematical presentation normalization must preserve argument distinctions as well as operators.

That trial also exposed stale eval-only checks in A15/A27: the task-alignment text omits streamed lesson briefs, and a hard-coded 15-character typed-answer minimum rejects the valid method name `filter`. Captured-response red tests are being added before correcting the rubric; production subject specificity already reads lesson briefs, so its reported failure is being inspected separately rather than assumed to have that same cause.

Closer inspection distinguished two WWI outputs in trial 2: the Sarajevo recognition answer belongs to a neighboring active claim and remains rejected (permanent negative); the `1918` answer belongs to the final armistice claim and should pass. Once subject validation admits the latter, the next shared heuristic falsely treats every numeric choice set as a calculation requiring two operands. This is a fourth distinct validator cause (V4), rather than part of the lexical matcher: numeric year recall is classified as arithmetic merely because its choices contain numbers. The correction is limited to explicit factual-year recall; missing calculation data and hidden prompts remain rejected. This additional validator location is recorded before editing it. The recovery prompt will state its server-selected recognition target explicitly, retaining the final-claim boundary.

For A15's eval-only specificity failure, the broad goal names the product-rule formula while today's deterministic short window explicitly defers that formula and teaches recognition of differentiable factors. The rubric will inspect active planned targets for streamed sessions and preserve all existing teaching/evidence checks. It also recognizes the common `differentia` stem (differentiate/differentiable), includes streamed brief text, and uses the existing production schema's nonempty typed-answer contract. No product time/order/shape logic changes.


### Final root-cause count

One grader cause and **four validator/recovery causes** were found. The initial memo predicted three validator causes; V4 became reachable after V1 stopped falsely rejecting the captured `1918` answer. These are shared boundary corrections, not separate case branches or fixture-specific exceptions.

| Cause | Shared correction | Cases exercised |
| --- | --- | --- |
| G — unordered/inconsistent grading fields | Explicit answerability and required criteria; deterministic public verdict, missing details, and secure feedback | A01, A02, A03 plus nine cross-subject canaries |
| V1 — subject proof loses representation and assignment | Preserve formula notation; distinguish checks from short claims; scoped topic references and already-validated teaching claims | X06, A22, A15, A35, A36 |
| V2 — deduplication erases meaningful symbols | Preserve primes/operators/accents while normalizing presentation | A15; duplicate-choice negatives |
| V3 — recovery omits server-known grouping/shape | Grouped distinct-claim counts, fixed independent-check schema, explicit final recognition target | A27, A32; WWI recovery; genuine-duplicate and neighboring-target negatives |
| V4 — numeric choices imply arithmetic | Distinguish explicit factual-year recall from calculations needing supplied values | Captured A35 armistice question; missing-data negatives |

Eval-only corrections are separate from these product causes: the dated A35/A36 replacements, short valid typed answers, and task/scope checks against the current streamed plan slice. They do not change session shape, scheduling, plan generation, or completion behavior.

The third sampling attempt at `3eaa459` exposed one further V1 representation loss in A22: a complete answer `y'=f'(x)g(x)+f(x)g'(x)` matches the product and derivative terms but loses `+` when completion evidence is tokenized. The correct product claim is consequently displaced, producing `streamed_target_missing`. The captured response is now a deterministic replay. Before editing: extend the existing notation helper to preserve arithmetic relation symbols as their verbal terms, without lowering evidence thresholds, using feedback as evidence, or broadening target authority. The full failed sample remains separate from final verification.

The symbolic A22 replay also demonstrates why this must be shared: after completion reconciliation preserves `+`, the final content-specificity reader independently loses the same notation and rejects the same evidence. Both evidence readers must use the common notation terms while retaining their existing subject thresholds and negative cases. The captured failure is reproduced through the complete generator, not merely a helper assertion.

The final symbolic-relation replay is red in [the old implementation run](evidence/symbolic-relation-red.txt) and green in [119 focused checks](evidence/symbolic-relation-green.txt), including completion/content-specificity negative cases. Both evidence readers preserve the same notation terms; their thresholds remain unchanged.

Sampling at `1026106` exposed the other half of V2's inconsistent duplicate boundary: the normal streamed schema accepted two exactly identical `2x(x+3)+x^2` choices, while compact recovery already rejected duplicates. This is a real invalid learner choice set, not a stale expectation; it remains red. The trial was stopped after the failure was captured (`branch-trial-4` is incomplete and is not a three-run result). Before editing, the correction is to share the same distinct-choice constraint across normal streamed output, compact recovery, and the eval rubric, then exercise the existing bounded recovery on that captured invalid response. Valid differing formulas must still pass. No choice is silently deleted and session shape and provider-call ceilings are unchanged; newly rejected invalid output uses the existing recovery call.

The shared-choice negative check also exposed a case-folding hazard before the next live run: `values.map(fn)` and `values.Map(fn)` are different code choices. Choice comparison must preserve case while normalizing spacing/primes; question-text repetition retains its existing case-insensitive comparison. The captured identical choices and presentation-equivalent derivative choices remain rejected. This boundary has its own failing-then-passing test and introduces no content deletion.


[Normal duplicate-choice red](evidence/normal-duplicates-red.txt) now becomes [green with bounded recovery](evidence/normal-duplicates-green.txt). [Case-sensitive code-choice red](evidence/choice-case-red.txt) becomes [green](evidence/choice-case-green.txt); exact and presentation-equivalent duplicates remain negative cases.

The standing scheduling-clock rule required setup-only changes in `e2e/add-to-yova.spec.ts` and `e2e/plan-schedule-date.spec.ts`: they now use `freezePlanClock`, and their Node-side relative dates derive from `PLAN_FIXED_NOW`. Their learner assertions remain unchanged. Existing calendar suites already freeze their clocks, and the core/live plan journeys already use the helper. The application preview-clock implementation is unchanged. Full lint passed before these import/setup changes; [their lint](evidence/browser-clock-lint.txt) and full typecheck also pass.

The [first full gate at `10b5fc4`](evidence/full-live-gate-at-10b5fc4/report.md) passes nine scoped cases but still rejects A15. Its subsequent three captured attempts are retained in `a15-investigation` (fail/pass/pass). The failing target is “Why (fg)' is generally not f'g'”. Its correct typed answer explains both product-rule terms. Recognition already receives the validated teaching claim, but the independent typed-check wrapper omitted it. This is an incomplete application of V1's shared check contract, not a new subject exception. Before editing: require that argument for both check types at the type boundary, and add off-topic/deferred typed-check negatives alongside the complete captured replay.


The typed-check correction is [red](evidence/independent-scope-red.txt) then [green](evidence/independent-scope-green.txt) through the complete captured generator path. `taughtIdea` is now required by the shared check function's TypeScript contract, so either caller omitting that validated authority is a compile error.

### Additional main comparison after the first full gate

The osmosis launch case and finance plan case each ran three times on actual detached main `e03a082`, with the same keys/modules. Main `src/lib` was byte-identical to that commit. Three test-only files from Brief 0 were supplied: isolated launch fixture output paths, their path helper, and the already-established no-map coverage correction in the eval rubric. Learner assertions and product code were unchanged. The branch and its audit notes were restored automatically afterward.

The original osmosis launch case passed twice and failed once on main with `streamed_target_subject`; the branch's first full run failed with missing target coverage. This is a pre-existing generation/validation failure and is deferred. Finance passed 3/3 on main and 3/3 in the final branch comparison; its earlier branch trial failure remains explicitly recorded. This does not establish a reproduced main defect or a finance fix. Its plan-generation and plan-rubric code is unchanged by Brief 0.5.

[All main comparison logs and captures](evidence/pass-to-fail-main/cases.json) are retained. Three supplementary same-context attempts were **not run** because the temporary harness only collected `src` tests; their “No test files found” reports are neither red nor green and make no provider-availability claim. They are not part of the 75-case gate or either three-run original-case result.


### Browser-run interruptions and environment restoration

The first ordinary-browser run is retained in [ordinary-browser](evidence/ordinary-browser/). It was interrupted twice by the local environment. The [power-log observation](evidence/ordinary-browser/power-interruption.txt) shows clamshell sleep from 10:17 BST, followed by maintenance wakes and full wake at 10:50:36. This overlaps the 17.2-minute recurring-calendar timeout and a Calendar server-startup timeout with no tests run. It does not explain the earlier cross-tab Calendar failure.

Later, root dependency links disappeared while the core suite was running; a worker could no longer import `@playwright/test`, 17 following core tests did not run, and the final five suites could not start. The deleting process was not identified. These missing-module/unexecuted results are unavailable, not product reds or greens. Earlier locator/API-response timeouts remain explicit failures rather than being retroactively reclassified as provider outages.

[Dependency restoration](evidence/dependency-restore.txt) reused all 524 packages from the local cache with the existing frozen lockfile (zero downloads). The unqualified `pnpm` command had resolved to the bundled fallback version 11.19.0; `corepack pnpm` resolves the repository-pinned 11.16.0. Node 24.19.0, Next 16.3.3, Playwright 1.62.1, and Vitest 4.1.10 match the earlier sample. The manifest and lockfile are unchanged. The [restoration record](evidence/dependency-restoration.json) separates this event from the earlier no-TTY auto-verification attempt; a dependency restore was explicitly performed only after the actual links disappeared. No provider key/model or production setting changed.

After restoration, all 3,918 unit tests and 12 runner checks passed again, along with lint, typecheck, and build. Logs are in [static-after-restoration](evidence/static-after-restoration/). Remaining gates use the pinned package manager. Browser replays retain the original assertions and zero runner retries.

The unchanged main comparison reproduced the desktop cross-tab Calendar failure and the desktop misconception-repair/evaluation timeout; the other eight comparison attempts passed. Both observations are now in BACKLOG and receive no product fix here. The [completed main/branch comparison](evidence/browser-comparison/report.md) is 8 pass / 2 fail on main and 9 pass / 1 fail on the branch. The only remaining branch failure is the identical desktop cross-tab Calendar timeout. The broader browser coverage follows below.

Raw browser trace/video archives are retained locally with SHA-256 hashes in [local-trace-archive.json](evidence/ordinary-browser/local-trace-archive.json); screenshots, reports, error contexts, and logs remain in this PR. Unrelated environment fields and credential values are omitted from published browser JSON.

## Authorized release dependency follow-up — 2026-09-09

The founder authorized merge/deployment, then explicitly authorized the minimal dependency update after the release audit failed. The prior no-local-verification instruction remains in force.

- **Red (GitHub Actions):** [run 34349726024](https://github.com/sebastianjudeziegler-byte/yova/actions/runs/34349726024), job `verify`, `Audit production dependencies`, exited 1 for `next > sharp 0.35.3`, [GHSA-rgj7-g3m4-5g8c](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c). Subsequent quality gates were skipped, not passed.
- **Change:** pin `sharp` to the advisory's patched `0.35.4`, with its matching `@img/sharp*` binaries and libvips `1.3.3`. Preserve every unrelated resolved dependency (including Next 16.3.3). Lockfile preparation only; no local install/build/test/browser run.
- **Green:** pending the pushed revision's GitHub Actions audit and full quality run. No passing result claimed yet.

### Combined release for CI

The release branch incorporates Brief A commit `340c8b6` and Brief 0 commit `d108e89` before the authorized merge. Conflicts were limited to the audit backlog and browser-test imports: both backlog histories are retained, and Brief 0.5's explicit frozen-clock setup plus Brief 0's live fixture import are retained. Brief A application changes merge without conflicts. This permits CI to test the exact combined release instead of claiming compatibility from separate branch runs.

### Remote release verification update

At combined release `0922ffa`, [GitHub Actions run 34350488557](https://github.com/sebastianjudeziegler-byte/yova/actions/runs/34350488557) passed dependency installation, the security audit, configuration validation, every migration replay, database lint/boundary checks, unit tests, lint and build. The browser step had started when the provider configuration was resolved. This run is superseded by a fresh run after the founder added the Actions secret.

The sharp audit is now **red → green** on GitHub: original run `34349726024` failed the advisory; combined run `34350488557` passed the same audit command with sharp 0.35.4. No local verification was used.

Read-only GitHub Settings inspection confirmed no repository/environment secrets existed. The founder subsequently confirmed adding `OPENAI_API_KEY`. A fresh quality run is required to pick up the newly configured secret. The full live step executes serially even if an earlier check fails, ensuring its artifact is produced; failures in earlier steps are not suppressed. Both live browser journeys and Brief A compatibility are included in the combined source. No production setting was changed.

### Final combined-source CI red — 2026-09-09

[Run 34351456255](https://github.com/sebastianjudeziegler-byte/yova/actions/runs/34351456255) tested merge revision `587fe5ac7d58aacc53205b5b9877795faf4e0b6e` (head `a08e909`, main `e03a082`). It passed dependency audit, configuration fixtures, migration replay, database checks, **3,937 unit tests plus 12 runner checks**, lint, build, **265 ordinary desktop/mobile journeys**, and **15 authentication journeys**. Expected skips are not passes. The exact Study Profile phone-width comparison passed on both main and the combined release; its [report](evidence/ci-release/study-profile-comparison/report.md) records both source revisions.

The [full live artifact](evidence/ci-release/full-live-gate/report.md) reports **53 pass / 7 fail / 12 quarantined flaky / 4 unavailable**. Brief A's live personalization delta and all nine grader canaries passed. Six semantic failures are the unchanged deferred material-source cases (A16, A19, A24, A30, A31, A33); A17 and other provider timeouts are unavailable, not green. A35 is the seventh failure. Both quarantined live browser cases failed this attempt; they are not counted as passes.

**Before further test edits:** A35's captured lesson says “Before the First World War” and correctly teaches Europe's rival alliance blocs. The corrected first-block scope assertion still recognized only `prewar`, `before 1914`, and `before World War I`; its rejection of the equivalent First World War name is a test defect. Keep the temporal requirement and all substantive teaching assertions, but accept the equivalent war name. No validator/product change is required.

Both browser screenshots show the existing uncertain-answer comparison with an enabled Continue button and an explicit statement that no correct/incorrect evidence was recorded. The test unconditionally waits for `I got the key idea`, which is deliberately absent in that state. This behavior was introduced in `1fe44f62` on 2026-08-31 (`yova-prototype.tsx`, the `semanticEvaluationHasNoEvidence` branch). The test must wait for either the comparison controls or that explicit no-evidence receipt, assert the correct state, then continue; it must not fabricate a learner rating. The final unrated-completion, saved-completion, answer-count and successful live-lesson assertions remain. This is a correction to test expectations only. Three fresh full live runs will execute serially in GitHub Actions; no local verification is authorized.

The live browser's answer lookup also selected the earlier instruction when instruction and recall shared a title (already reproduced on both branches and documented in BACKLOG under Brief A). Restrict that fixture lookup to question activities. The explicit uncertain-result branch remains necessary and asserted; passing does not depend on inventing a self-rating.

### Combined release stability sample — two remaining scoped failures

[GitHub Actions run 34357438000](https://github.com/sebastianjudeziegler-byte/yova/actions/runs/34357438000) tested merge `d8e29b21178be12a83c493ca19b67d3e639215ef`, release head `122f2bd`, against main `e03a082`. The [complete three-run artifact](evidence/ci-stability/report.md) records 228 observations: **159 pass / 27 fail / 36 quarantined flaky / 6 unavailable**. These are observations, not 228 distinct tests. The policy labels remain unchanged.

| Scoped case | Run 1 | Run 2 | Run 3 |
| --- | --- | --- | --- |
| A03, A01, A02 — grader | PASS | PASS | PASS |
| X06 — membrane subject | PASS | PASS | PASS |
| A22 — product/chain rule | FAIL | PASS | PASS |
| A15 — short product rule | PASS | PASS | PASS |
| A35 — WWI streamed lesson | PASS | FAIL | PASS |
| A36 — WWI skeleton | PASS | PASS | PASS |
| A27 — JavaScript claims | PASS | PASS | PASS |
| A32 — Spanish claims | PASS | PASS | PASS |

All nine permanent grader canaries and Brief A's live delta passed 3/3. Both live browser journeys actually passed 3/3, while retaining their historical FLAKY policy labels. The previous lexical A35 test correction therefore passes when generation succeeds. Ordinary gates passed: dependency audit, configuration, migration replay/database checks, 3,937 unit tests and 12 runner checks, lint/build, 265 desktop/mobile journeys, 15 authentication journeys, and the exact main/release phone-width comparison. No local verification was performed.

**Root-cause memo before further product edits:** A35's failing question is titled “World War I ending date”; `question-context.ts` still recognizes factual dates only through the literal “what/which year” or “year did/was/were/of” forms. This is an incomplete V4 correction: equivalent factual date recall is incorrectly treated as arithmetic. Add alternative date-recall wording with four year choices, and retain negatives for missing arithmetic data, hidden questions, and date calculations. The original live response was not captured, so a derived wording fixture must not be described as the exact provider response.

A22 fails at `scope_input` with one idea/assignment remaining for two active targets, after the complete initial assignment validation succeeded. That locates the loss inside completion reconciliation, consistent with V1, but the aggregate log does not establish which valid representation was lost. Capture the same fixture through a pass-through CI harness before selecting a correction. Preserve the missing-target invariant, off-topic/deferred-topic negatives, duplicate checks, and the existing provider-call limit. No product change is justified solely by the failure count.

A temporary focused CI workflow will collect this diagnostic evidence and the new date-recall red test. It is explicitly **not** the full gate; the complete workflow will be restored before release verification and merge.

[Focused CI run 34368691318](https://github.com/sebastianjudeziegler-byte/yova/actions/runs/34368691318), head `771ccf3`, reproduced all **four new date-recall failures**, with 29 existing/negative checks passing. The [JSON results and pass-through captures](evidence/ci-validator-red/) are retained. No production implementation had changed in that revision. Three further A22 live attempts passed, but the first only passed after recovery; the capture records the original correct product-rule claim being discarded at reconciliation.

**A22 refinement, before changing notation code:** the captured claim says “Differentiate a product by adding the derivative…” and its correctly mapped question answers `f'(x)g(x) + f(x)g'(x)`. The matcher counts `product` and `derivative`, but normalizes the answer's `+` to `plus` without normalizing the claim's `adding` to the same relation. The three-term threshold then drops a correctly taught/checked topic. Extend the shared arithmetic representation to equivalent addition wording rather than reducing that threshold or trusting a concept heading as evidence. The captured normal response becomes a permanent full-pipeline regression that must retain both lessons without using a recovery call. Wrong/missing formula terms, off-topic questions, deferred ATP use, and genuine duplicates must remain rejected.

[CI run 34369079085](https://github.com/sebastianjudeziegler-byte/yova/actions/runs/34369079085), head `002f955`, records **45 passing checks and three addition reds**: the exact captured full-generator response, “adding”, and “sum”. All four date-recall regressions now pass, as do the wrong-formula, off-topic, hidden-context, missing-date-arithmetic, deferred-topic and duplicate negatives in the focused suites. The [raw results](evidence/ci-addition-red/date-recall.json) preserve the failing assertions. The addition correction is now applied only in the shared notation helper, with unchanged matching thresholds.

The attempted main comparisons in that diagnostic run are **UNAVAILABLE (harness configuration)**: the plan opt-in variable was misnamed, and the current session rubric imports a new helper absent on main. No main plan/provider outcome was observed in those attempts. The next comparison uses the correct opt-in and Brief 0's already-corrected rubrics from `d108e89`, leaving main `src/lib` byte-identical to `e03a082`. The old versus current rubric distinction is explicit; capacity, progression, and missing-claim failures occur independently of those removed stale expectations.

The first notation correction passes both new completion-contract checks and all existing negatives in remote run `34369366041`, but the new full-response test still fails. Its original “no repair” requirement overstates the capture: the normal provider response also omits the required self-explanation repair phase. Keep that method contract. The full replay will feed the exact captured product-rule claim/question through the already-captured, server-owned recovery shape, leaving its second claim and recognition unchanged. This is explicitly an adapted recovery fixture, not a claim that the incomplete normal response is valid. A serial CI replay with the old notation implementation will establish red again before claiming green for that corrected regression fixture.

The corrected [main comparison in run 34369366041](https://github.com/sebastianjudeziegler-byte/yova/actions/runs/34369366041) is retained in [ci-main-comparison](evidence/ci-main-comparison/). Main `e03a082` reproduced A07's exact `PlanScheduleCapacityError` (FAIL/PASS/PASS); A09's history plan and A28's finance session passed 3/3 in this sample. This reproduces A07 as pre-existing, but does not reproduce A09's progression reason or A28's missing-claim reason. Their earlier branch observations remain failures; a passing supplementary sample is not a fix. The A07/A09 legacy plan generator, prompt, scheduling, quality and progression implementations are unchanged by the combined release. A28 also has an earlier documented main duplicate-claim failure in Brief A's retained baseline, distinct from this sample. No changes to any of these cases are included.

### Remote validator regressions complete; full gate restored

[Run 34370080929](https://github.com/sebastianjudeziegler-byte/yova/actions/runs/34370080929), head `6a2d0d1`, replays the adapted recovery fixture and the addition contract against the exact old `002f955` notation implementation: **three expected failures / 45 passes**. Restoring the new helper, with the same tests and dependencies, gives **48 passes / zero failures**. [Old-code red](evidence/ci-validator-green/old-notation-red.json), [new-code green](evidence/ci-validator-green/date-recall.json). This includes the four date-recall regressions and all existing focused wrong-formula, off-topic, deferred, hidden-context, missing-data, neighboring-target and duplicate negatives.

The same run also passed the unchanged A22 live case three times. These focused runs do not replace the release gate. The complete quality workflow is now restored byte-for-byte from `122f2bd`: dependency audit, config, migration replay and database checks, unit/runner checks, lint/build, ordinary desktop/mobile and auth journeys, exact Study Profile comparison, then three serial complete live samples. Temporary pass-through instrumentation is retained only as audit text and is not active in application or full-gate code. No local verification was run.


### Full combined gate at 2098e66 — merge remains held

[Run 34370432851](https://github.com/sebastianjudeziegler-byte/yova/actions/runs/34370432851) tested merge `a013b63229834d0b8e579e995040ff4613154521`, release head `2098e66`, against main `e03a082`. All static and ordinary browser gates passed: audit/config, migration replay/database checks, **3,950 unit tests plus 12 runner checks**, lint, TypeScript during the production build, **265 desktop/mobile journeys** (19 expected skips), **15 authentication journeys** (one expected skip), and the exact main/release phone-width comparison at 320/360/390/430px with no retries. The [raw live artifact](evidence/ci-combined-2098/full-live-gate/report.md), [actual-outcome table](evidence/ci-combined-2098/actual-outcomes.md), and [artifact hashes](evidence/ci-combined-2098/artifact-provenance.json) are retained.

The policy counts are **162 pass / 23 fail / 35 quarantined flaky / 8 unavailable** across 228 observations. Actual outcomes, separately from quarantine labels, are 194 pass / 26 fail / 8 unavailable. All nine permanent grader canaries, Brief A's live delta and both actual live browser journeys passed 3/3. A03/A01/A02/X06/A22/A35/A36/A32 passed 3/3. **A15 is PASS/FAIL/PASS; A27 is PASS/PASS/FAIL.** These results do not satisfy the ten-case release gate; no merge or deployment occurred.

**Investigation memo before further product changes:** A15 successfully generated a 15-minute product-rule lesson, but the evaluation's majority-of-activities task-word regex failed. The log does not retain the lesson, so capture its output before deciding whether this is invalid teaching or a stale expectation; do not simply relax the rubric. A27's recovery is rejected because the claim “map returns a new array by transforming each element” appears in more than one teaching block. Capture both block assignments to distinguish genuine duplication from a false rejection; preserve genuine-duplicate and cross-topic negatives.

Two additional previously passing canaries failed once: the natural-selection misconception returned uncertain instead of needs_review, and launch recall rejected an evidence-map reference absent from its essential-idea list. The grader's calibration currently gives any unclear required criterion precedence over a separate definitely incorrect required criterion, even when context is sufficient. That precedence is a candidate shared calibration defect, not yet a demonstrated explanation of the uncaptured live response. Add a permanent mixed-criterion red across biology/programming/history and retain the missing-context/wholly-unclear boundaries. Capture actual provider assessments and compare unchanged main before claiming the live observation is new or fixed. The launch recall reference needs the same capture/comparison; do not weaken the evidence-map membership check.

A09 again failed its legacy history-plan progression assertion once. A16/A17/A19/A24/A30/A31/A33 remain deferred observations; no material or broad-calculus repair is included. The failed calculus launch also left its dependent stream fixture unavailable (X01); this is a missing prerequisite output, not a provider timeout or a green test. Other unavailable rows retain their provider reasons. A focused serial CI capture/main comparison will run next; the complete workflow must be restored and run again before merge. Local verification remains stopped.


[Focused run 34381102335](https://github.com/sebastianjudeziegler-byte/yova/actions/runs/34381102335), head `427d335`, completed its red-establishment step, which requires exactly three failed mixed-criterion tests and passing existing/negative checks. The main/release captures are still running. The deterministic calibration now gives a definite missing/incorrect required criterion precedence over an unclear criterion **only after the existing sufficient-context check**. Wholly unclear responses remain uncertain; missing prompt context still clears both evidence lists. Green is pending remote verification. This corrects the independently demonstrated precedence case; attribution of the original live misconception response still awaits its provider capture.


**Allocation hypothesis before changing enrichment code:** `enrichStreamedLessonBriefs` de-duplicates proposed assignments, but if one block receives all available ideas and another is empty, its final fallback copies `activeIdeas[0]` into that empty block. The strict duplicate validator then rejects the output. Prepare a derived red proving that two available claims can be distributed across two already-budgeted blocks without adding claims, changing time, or weakening duplicate rejection. A one-claim/two-block genuinely duplicate draft must still fail. This static code path is not yet claimed as the captured cause of A27; the pass-through comparison remains in progress.

### Captured comparison on `427d335` (remote only)

[Run 34381102335](https://github.com/sebastianjudeziegler-byte/yova/actions/runs/34381102335) is complete. Its successful diagnostic job records failures; it is **not** a green product gate. [Raw per-case captures/results](evidence/ci-observations-427/) and [provenance](evidence/ci-observations-427/artifact-provenance.json) retain the exact source/artifact identities. The main comparison uses unchanged `e03a082` product code and Brief 0's corrected eval expectations. Samples are serial, same key/environment, without retries.

| Case | Main, three samples | Release, three samples |
| --- | --- | --- |
| A15, short product-rule journey | FAIL / FAIL / FAIL | PASS / FAIL / PASS |
| A27, JavaScript scaffold | FAIL / PASS / PASS | PASS / PASS / PASS |
| Biology misconception | PASS / PASS / PASS | FAIL / PASS / PASS |
| Launch recall | PASS / FAIL / PASS | PASS / PASS / PASS |
| A09, legacy history plan | PASS / PASS / PASS | PASS / PASS / PASS |

The mixed-criterion grader unit step establishes **3 red / 9 green**, including passing missing-context and uncertainty negatives. The failed release biology capture confirms the shared cause: the provider returned `needs_review`, with two required ideas missing and population-level change unclear; deterministic post-processing replaced it with `uncertain`. The pending correction preserves the sufficient-context guard, then prioritizes an established required correction. The original grader canary remains permanent.

**A15 root-cause memo before claim/rubric changes:** the unchanged main sample 1 generated a valid, bounded prerequisite lesson about two function factors multiplied together; the task-alignment regex counted too few activities because it recognized calculus/solution words but not the mathematical operation being taught. The current scoped-session contract already allows this prerequisite and explicitly defers the full worked formula. Correct the eval vocabulary only, preserving its majority threshold and an off-topic-content negative even when decorative concept labels say “product of two functions.” Release sample 2 instead contains the exact complete claim `(fg)' = f'g + fg'`. `isCompleteLessonClaim` rejects it for fewer than five words, then the recovery is correctly rejected for omitting the explicit sum. Recognize syntactically complete symbolic equations at the claim boundary; retain equation-equivalence, subject, deferred-content, and malformed/incomplete-equation guards. The permanent generator fixture contains the **unchanged initial provider output and context**, not adapted recovery.

A27 passed all three fresh release captures, so the earlier full-gate duplicate is not reproduced here. The derived allocation test still establishes a separately identifiable path that can manufacture duplicate teaching from two available claims; do not label this fresh capture as proof of the earlier response's exact cause. Main's failed A27 has duplicate target assignment, the original scoped defect. Main recall failed phase order, **not** the release's earlier absent evidence-map reference; the exact reference failure remains unclassified, and no generic-runtime change is included. A09's earlier isolated progression failure is not reproduced by these samples; its legacy generation/progression code is unchanged. Deferred material defects remain outside this release.

[Remote boundary run 34382604180](https://github.com/sebastianjudeziegler-byte/yova/actions/runs/34382604180), head `5096304`: grader **12/12 green** after its three recorded reds; equation/allocation/rubric **seven expected red / 56 green**, exact [per-test artifact](evidence/ci-boundary-red-509/). The new captured initial equation fails before replacement generation; the derived allocation produces the repeated first claim; the scoped product-of-functions lesson fails task vocabulary. Only after these red results, the shared equation boundary accepts a complete algebraic equality, the allocator gives each teaching block a distinct proposed claim before filling spare capacity, and the eval counts explicit function-factor/multiplication teaching. No method, duration, source authority, duplicate validator, subject threshold, or deferred-topic protection is relaxed. Remote green and live samples are pending.
