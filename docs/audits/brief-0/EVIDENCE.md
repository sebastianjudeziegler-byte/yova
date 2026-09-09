# Brief 0 — full live-gate baseline

**17 of the original 36 failures are REAL, 12 are STALE, and 7 are FLAKY.** The two original provider-timeout cases both reach obsolete no-map coverage assertions when the provider responds, so both are classified STALE. There are 18 ranked REAL cases across the complete set: 17 from the original 36 plus one additional AP Biology canary. The three main runs initially identified 14 REAL cases; corrected stale assertions then exposed independent product failures in A05/A15 and a task-alignment intent question in A17, so those three cases were conservatively reclassified REAL. No product fix was made.

The records show that only selective live suites had previously run as gates; the complete set was not a gate, and the local environment/key/dependency fingerprints stayed unchanged during this audit (provider-side changes cannot be ruled out from local records).

## Reproduction and accounting

All three complete baseline runs used an actual detached checkout of `main` at **e03a082659f51172c0b06bf84daffdd5599ac773** on September 8, 2026. Only temporary audit harness changes were present: a direct local Next server command, output paths, and the mandated frozen browser clock. No baseline assertion or product implementation was corrected before these runs. The branch was created from that pin after all three finished.

Every existing `src/**/*.live.test.ts` was discovered: **17 files, 64 unit cases, and 2 live browser journeys = 66 cases per run**. Every opt-in was enabled, case filters were cleared, suites ran serially, and runner retries were disabled. Internal repetition already present in an individual canary stayed intact. Launch-session fixtures were generated before their lesson consumers; producer files were cleared before each run to prevent stale reuse. The browser clock was frozen at `2026-09-07T19:35:00.000Z` with `e2e/helpers/frozen-clock.ts`. Desktop and mobile used the same newly generated deadline fixture within each run. The isolated local browser server used the existing provider key, with Supabase/email disabled.

The ignored `.env.local`, lockfile, and installed Next/OpenAI/Vitest package fingerprints matched before and after the audit. Fingerprints of secret-bearing files are deliberately not published. Node was `v24.19.0`; plan/lesson models were `gpt-5.6-sol`, session model `gpt-5.4-mini`, matching this main pin's defaults. No production settings, keys, dependencies, or rollout settings changed.

[Baseline manifest](evidence/baseline-manifest.json), [serial launcher procedure](evidence/baseline-procedure.py), [all 66 case results](evidence/baseline-results.json), [classification data](evidence/classification.json), and [original 34 semantic unit failures plus two provider-timeout records](evidence/original-cohort.json). The two original live browser failures complete the original 36-case cohort. A09/A10 are the extra original timeout cases, not members of the 36.

| Complete main run | Pass | Semantic/assertion failure | Unavailable | Total |
| --- | ---: | ---: | ---: | ---: |
| 1 | 26 | 36 | 4 | 66 |
| 2 | 31 | 33 | 2 | 66 |
| 3 | 28 | 37 | 1 | 66 |

Unavailable attempts are neither red nor green. Case classification is distinct from an attempt's result. A historically failing case with any pass in these three runs is FLAKY. A case with semantic failures and no passes is STALE only with established behavior evidence; otherwise it is REAL. A case that reached both an obsolete assertion and a separate product failure remains REAL. Baseline pass rates stay pinned to these three runs. Later successful retries do not rewrite them. A05/A15/A17 were initially STALE but became REAL after test correction exposed independent product failures or an intent question; the [initial classification](evidence/initial-classification.json) preserves that progression. No case has two final buckets.

One early, incomplete launcher attempt used an incorrect scratch-file cleanup list and was discarded before the three complete runs. Its results are excluded from every total and pass rate. No prior-run producer fixtures were reused in the three counted runs.

## Original cases: classification and per-test evidence

Each original case has exactly one bucket. PASS/FAIL below describe the observed attempt, not the eventual gate quarantine. The permanent raw report preserves the full failure reason when this table abbreviates it.

| Case / test | Main run 1 | Main run 2 | Main run 3 | Bucket | Pass rate | One-line evidence |
| --- | --- | --- | --- | --- | --- | --- |
| [A01](#a01) — accepts a correct biology paraphrase | FAIL | FAIL | FAIL | REAL | 0/3 | A correct paraphrase received secure plus non-empty missingIdeas even though those details are explicitly optional in the fixture rubric. |
| [A02](#a02) — accepts a concise programming explanation | FAIL | FAIL | FAIL | REAL | 0/3 | A correct paraphrase received secure plus non-empty missingIdeas even though those details are explicitly optional in the fixture rubric. |
| [A03](#a03) — admits uncertainty when the prompt lacks necessary context | FAIL | FAIL | FAIL | REAL | 0/3 | The rate-change answer was graded secure with no stated process, observations, or changed condition. |
| [A04](#a04) — builds an arbitrary three-target teaching-first session repeatedly | FAIL | PASS | FAIL | FLAKY | 1/3 | Passed 1/3 complete main runs; 2 semantic failure(s), 0 unavailable attempt(s). AssertionError: expected [ { run: 1, …(1) }, { run: 2, …(1) } ] to deeply equal [] - Expected + Received - [] + [ + { + "generationStats": { + "attempts": 2, + "cacheWriteTokens": 0, + "cachedInputTokens": 6912, + "cause |
| [A05](#a05) — real placement questions and a map-only scope correction preserve demonstrated ATP | FAIL | FAIL | FAIL | REAL | 0/3 | The complete branch run rejected generated placement questions as ambiguous or unsupported before the corrected evidence/deferral assertion; a focused follow-up passed that assertion. |
| [A06](#a06) — Biology test with learner notes | FAIL | FAIL | FAIL | STALE | 0/3 | No map was supplied: the old rubric rejects 0/0 coverage; the no-map contract has explicitly been a no-op since 6f348ab (Aug 20). |
| [A07](#a07) — Calculus problem-solving plan | FAIL | FAIL | FAIL | STALE | 0/3 | No map was supplied: the old rubric rejects 0/0 coverage; the no-map contract has explicitly been a no-op since 6f348ab (Aug 20). |
| [A08](#a08) — One product-rule skill in short sessions | UNAVAILABLE | FAIL | FAIL | STALE | 0/3 | No map was supplied: the old rubric rejects 0/0 coverage; the no-map contract has explicitly been a no-op since 6f348ab (Aug 20). |
| [A09](#a09) — World War I unit guide in short sessions | FAIL | FAIL | FAIL | STALE | 0/3 | No map was supplied: the old rubric rejects 0/0 coverage; the no-map contract has explicitly been a no-op since 6f348ab (Aug 20). |
| [A10](#a10) — Full beginner calculus pathway | FAIL | FAIL | FAIL | STALE | 0/3 | No map was supplied: the old rubric rejects 0/0 coverage; the no-map contract has explicitly been a no-op since 6f348ab (Aug 20). |
| [A11](#a11) — General-learning startup funding pathway | FAIL | FAIL | FAIL | STALE | 0/3 | No map was supplied: the old rubric rejects 0/0 coverage; the no-map contract has explicitly been a no-op since 6f348ab (Aug 20). |
| [A12](#a12) — History essay using outside sources | UNAVAILABLE | UNAVAILABLE | FAIL | STALE | 0/3 | No map was supplied: the old rubric rejects 0/0 coverage; the no-map contract has explicitly been a no-op since 6f348ab (Aug 20). |
| [A13](#a13) — Beginner JavaScript practice | FAIL | FAIL | UNAVAILABLE | STALE | 0/3 | No map was supplied: the old rubric rejects 0/0 coverage; the no-map contract has explicitly been a no-op since 6f348ab (Aug 20). |
| [A14](#a14) — General-learning finance pathway | FAIL | FAIL | FAIL | STALE | 0/3 | No map was supplied: the old rubric rejects 0/0 coverage; the no-map contract has explicitly been a no-op since 6f348ab (Aug 20). |
| [A15](#a15) — One product-rule skill in short sessions | FAIL | UNAVAILABLE | FAIL | REAL | 0/3 | Session generation failed its bounded compact-recovery schema twice after the stale no-map assertion was corrected; telemetry says the formula-only active slice leaked the deferred factor-identification target. |
| [A16](#a16) — World War I unit guide in short sessions | FAIL | FAIL | FAIL | REAL | 0/3 | Generation refused the supplied material with “no readable explanatory source is mapped to the active target”; some attempts instead reached an obsolete rubric assertion. |
| [A17](#a17) — Full beginner calculus pathway | FAIL | FAIL | FAIL | REAL | 0/3 | The corrected connected journey generated a five-activity Worked Examples lesson scoring 85/100, then failed the required “Activities fit the learning task” check. No full learner activity dump was retained by that existing canary, so this is an unresolved intent question rather than a claim that the lesson was definitively wrong. |
| [A18](#a18) — History essay using outside sources | FAIL | FAIL | FAIL | STALE | 0/3 | No map was supplied: the old rubric rejects 0/0 coverage; the no-map contract has explicitly been a no-op since 6f348ab (Aug 20). |
| [A19](#a19) — Biology teaching from learner notes | FAIL | FAIL | FAIL | REAL | 0/3 | Generation refused the supplied material with “no readable explanatory source is mapped to the active target”; some attempts instead reached an obsolete rubric assertion. |
| [A20](#a20) — Fifteen-minute temperature and reaction-rate explanation | FAIL | FAIL | FAIL | STALE | 0/3 | The old 4/5 activity cap predates the method-aware Learn budget and recognition phase in b8f5e102 (Sep 1). |
| [A21](#a21) — Fifteen-minute first product-rule lesson | FAIL | PASS | FAIL | FLAKY | 1/3 | Passed 1/3 complete main runs; 2 semantic failure(s), 0 unavailable attempt(s). SessionGenerationFailure: OpenAI did not return a complete streamed teaching skeleton after 1 repair attempt. The compact teaching recovery did not match its bounded content schema. |
| [A22](#a22) — Mapped product-rule and chain-rule first lesson | FAIL | FAIL | FAIL | REAL | 0/3 | SessionGenerationFailure: OpenAI did not return a complete streamed teaching skeleton after 1 repair attempt. The compact teaching recovery did not match its bounded content schema. |
| [A23](#a23) — Production-shaped derivative-foundations verification | PASS | FAIL | PASS | FLAKY | 2/3 | Passed 2/3 complete main runs; 1 semantic failure(s), 0 unavailable attempt(s). SessionGenerationFailure: OpenAI did not return a complete, safe guided session after the bounded repair attempts. The required knowledge check mapped to “The power rule, constant multiple rule, and sum or difference rul |
| [A24](#a24) — World War I teaching for a complete beginner | FAIL | FAIL | FAIL | REAL | 0/3 | Generation refused the supplied material with “no readable explanatory source is mapped to the active target”; some attempts instead reached an obsolete rubric assertion. |
| [A25](#a25) — Mapped 45-minute World War I baseline lesson | PASS | FAIL | PASS | FLAKY | 2/3 | Passed 2/3 complete main runs; 1 semantic failure(s), 0 unavailable attempt(s). AssertionError: expected [ 'Activities fit the learning task' ] to deeply equal [] - Expected + Received - [] + [ + "Activities fit the learning task", + ] |
| [A26](#a26) — Calculus repair after a weak check | FAIL | FAIL | PASS | FLAKY | 1/3 | Passed 1/3 complete main runs; 2 semantic failure(s), 0 unavailable attempt(s). SessionGenerationFailure: OpenAI did not return a complete subject lesson after one repair attempt. |
| [A27](#a27) — Beginner JavaScript with fading support | FAIL | FAIL | FAIL | REAL | 0/3 | SessionGenerationFailure: OpenAI did not return a complete streamed teaching skeleton after 1 repair attempt. The compact teaching recovery could not be finalized inside the authoritative session scope (streamed_target_assignment_duplicate:other). Stage: finalize. |
| [A28](#a28) — General-learning finance application | FAIL | FAIL | FAIL | STALE | 0/3 | The old 4/5 activity cap predates the method-aware Learn budget and recognition phase in b8f5e102 (Sep 1). |
| [A29](#a29) — Startup funding foundations for a new learner | FAIL | FAIL | FAIL | STALE | 0/3 | The old 4/5 activity cap predates the method-aware Learn budget and recognition phase in b8f5e102 (Sep 1). |
| [A30](#a30) — History reasoning from a primary-source excerpt | FAIL | FAIL | FAIL | REAL | 0/3 | Generation refused the supplied material with “no readable explanatory source is mapped to the active target”; some attempts instead reached an obsolete rubric assertion. |
| [A31](#a31) — Literature close reading from a short passage | FAIL | FAIL | FAIL | REAL | 0/3 | Generation refused the supplied material with “no readable explanatory source is mapped to the active target”; some attempts instead reached an obsolete rubric assertion. |
| [A32](#a32) — Spanish conversation with supported transfer | FAIL | FAIL | FAIL | REAL | 0/3 | SessionGenerationFailure: OpenAI did not return a complete streamed teaching skeleton after 1 repair attempt. The compact teaching recovery could not be finalized inside the authoritative session scope (streamed_target_assignment_duplicate:other). Stage: finalize. |
| [A33](#a33) — Teaching from a thin biology study guide | FAIL | FAIL | FAIL | REAL | 0/3 | Generation refused the supplied material with “no readable explanatory source is mapped to the active target”; some attempts instead reached an obsolete rubric assertion. |
| [A34](#a34) — builds the production 15-minute two-target teaching skeleton | FAIL | FAIL | FAIL | STALE | 0/3 | A 15-minute method-bounded slice keeps one active claim and explicitly defers the second topic; scope narrowing dates to c924f5d (Aug 23). |
| [A35](#a35) — delivers substantive teaching from the first generated lesson brief | FAIL | FAIL | FAIL | REAL | 0/3 | SessionGenerationFailure: OpenAI did not return a complete streamed teaching skeleton after 1 repair attempt. The compact teaching recovery could not be finalized inside the authoritative session scope (streamed_target_subject:other). Stage: draft. |
| [A36](#a36) — creates the production 45-minute streamed teaching session | FAIL | FAIL | FAIL | REAL | 0/3 | SessionGenerationFailure: OpenAI did not return a complete streamed teaching skeleton after 1 repair attempt. The compact teaching recovery could not be finalized inside the authoritative session scope (streamed_target_subject:other). Stage: draft. |
| [A37](#a37) — a live-generated deadline lesson streams, finishes unrated and preserves completion on reload (desktop) | PASS | PASS | FAIL | FLAKY | 2/3 | Passed 2/3 complete main runs; 1 semantic failure(s), 0 unavailable attempt(s). TimeoutError: locator.click: Timeout 60000ms exceeded. Call log:  - waiting for getByRole('button', { name: 'I got the key idea', exact: true })  |
| [A38](#a38) — a live-generated deadline lesson streams, finishes unrated and preserves completion on reload (mobile) | PASS | PASS | FAIL | FLAKY | 2/3 | Passed 2/3 complete main runs; 1 semantic failure(s), 0 unavailable attempt(s). TimeoutError: locator.click: Timeout 60000ms exceeded. Call log:  - waiting for getByRole('button', { name: 'I got the key idea', exact: true })  |

## Additional cases surfaced by the complete set

Twenty-one additional cases passed all three runs. The remaining seven are below. X01 had only a provider outage followed by two passes, so its outage is UNAVAILABLE and it is not quarantined; a later semantic failure would still block.

| Case / test | Main run 1 | Main run 2 | Main run 3 | Bucket | Pass rate | One-line evidence |
| --- | --- | --- | --- | --- | --- | --- |
| [X01](#x01) — streams the validated calculus teaching | UNAVAILABLE | PASS | PASS | UNAVAILABLE | 2/3 | 1/3 attempts unavailable; 2/3 passed. No semantic failure observed. |
| [X02](#x02) — calculus | FAIL | PASS | PASS | FLAKY | 2/3 | Passed 2/3 complete main runs; 1 semantic failure(s), 0 unavailable attempt(s). SessionGenerationFailure: OpenAI did not return a complete streamed teaching skeleton after 1 repair attempt. The compact teaching recovery did not match its bounded content schema. |
| [X03](#x03) — generates from a material map and reports latency | UNAVAILABLE | PASS | FAIL | FLAKY | 1/3 | Passed 1/3 complete main runs; 1 semantic failure(s), 1 unavailable attempt(s). MapDiagnosticGenerationError: The placement check did not cover its assigned questions safely. |
| [X04](#x04) — generates from a ai_generated map and reports latency | FAIL | PASS | PASS | FLAKY | 2/3 | Passed 2/3 complete main runs; 1 semantic failure(s), 0 unavailable attempt(s). MapDiagnosticGenerationError: The placement check did not cover its assigned questions safely. |
| [X05](#x05) — keeps two current targets and defers the third in a 15-minute window | FAIL | PASS | PASS | FLAKY | 2/3 | Passed 2/3 complete main runs; 1 semantic failure(s), 0 unavailable attempt(s). SessionGenerationFailure: YOVA could not build a safe degraded session for this setup. Review the session setup or choose a source-independent route. |
| [X06](#x06) — builds a topic-specific teaching skeleton | FAIL | FAIL | FAIL | REAL | 0/3 | The initial and compact recovery path ended in streamed_target_subject:other before a usable skeleton was returned. |
| [X07](#x07) — explains every glycolysis product before accepting a learner's paraphrase | PASS | PASS | FAIL | FLAKY | 2/3 | Passed 2/3 complete main runs; 1 semantic failure(s), 0 unavailable attempt(s). AssertionError: expected '# Glycolysis: From Glucose to Pyruvat…' to match /electron\|carrier\|reducing/i - Expected: /electron\|carrier\|reducing/i + Received: "# Glycolysis: From Glucose to Pyruvate Glycolysis breaks one g |

## STALE corrections: established behavior, not product decisions

Only test/eval expectations and their execution infrastructure changed. The production plan/session/evidence code is unchanged.

| Cases | Old expectation | Existing behavior and dated evidence | Corrected assertion |
| --- | --- | --- | --- |
| A06–A15, A17–A18 | No-map fixtures fail “0/0 mapped targets covered.” | [6f348ab, Aug 20](https://github.com/sebastianjudeziegler-byte/yova/commit/6f348ab): `accountForEveryKnowledgeMapTopic` returns unchanged when there is no map; `topic-accounting.test.ts` permanently tests that contract. | Coverage is not applicable without a map; supplied maps still reject missing/unknown topics. Learner session titles and objectives remain checked. |
| A20, A28, A29 | Fixed 4/5 activity caps reject valid Learn phases. | [b8f5e102, Sep 1](https://github.com/sebastianjudeziegler-byte/yova/commit/b8f5e102): method-aware Learn budget includes recognition after teaching. Existing `validateSessionTimeBudget` enforces required minutes, words, method phases and global maximum. | Eval uses that established validator, while still rejecting excess activities/overtime. |
| A05 | A demonstrated ATP topic must have a dedicated session and “Quick verification” title. | [d7d772b, Aug 27](https://github.com/sebastianjudeziegler-byte/yova/commit/d7d772b): confirmed gaps precede demonstrated prerequisites; a demonstrated prerequisite may be explicitly deferred for capacity. Permanent envelope tests cover this. | Preserve accepted ATP title and exact demonstrated evidence; either all scheduled ATP sessions are study sessions, or explicit meaningful capacity/deadline deferral explains its absence. |
| A34 | A 15-minute Rayleigh session must keep two active topics. | [c924f5d, Aug 23](https://github.com/sebastianjudeziegler-byte/yova/commit/c924f5d) introduces method-capacity narrowing; Sep 1 recognition and [1f7035c, Sep 7](https://github.com/sebastianjudeziegler-byte/yova/commit/1f7035c) honest minimum idea time preserve this boundary. The canary's old count predates them. | One active light/air-molecule claim, explicit second-topic deferral, 15 focused minutes, and existing free-response/no-invented-sunset checks. |

Mixed cases A05/A15/A16/A22/A24/A35/A36 remain REAL because generation failed independently of an obsolete assertion. A17 remains REAL because its task-alignment failure requires a product-intent decision; no alignment assertion was changed. Shared rubric corrections naturally apply wherever that rubric is called; no product failure assertion was loosened. A05 was initially corrected as STALE; its valid evidence/deferral assertion remains after reclassification, and the independent generator failure remains visible. A35's global Sarajevo expectation and A36's old three-block expectation remain untouched and documented as stale subchecks within unresolved REAL cases. Legacy material fixtures were not given invented mappings: [6cdcabeb, Aug 22](https://github.com/sebastianjudeziegler-byte/yova/commit/6cdcabeb) explicitly preserves the unmapped pure-material path, and [e97a719, Aug 10](https://github.com/sebastianjudeziegler-byte/yova/commit/e97a719) tests synthetic source anchoring. Whether outline-only content still belongs in that contract is a founder decision, so it stays REAL.

The browser cases are FLAKY (2/3 each), and their assertions are unchanged. Run 3's duplicate activity title selects an instruction as the answer fixture; the UI shows uncertain/no-evidence feedback and Continue, while the test waits for “I got the key idea.” [1fe44f62, Aug 31](https://github.com/sebastianjudeziegler-byte/yova/commit/1fe44f62) already withholds self-rating on uncertain/no-evidence checks. This is not newly caused by the Sept 7 unrated completion change. Run 3's error-context files and screenshots preserve that learner-visible state.

A17/A18 also exposed a second stale eval assumption after the first no-map failure was removed: the old keyword allowlist rejected the exact production phrases “Show the overall relationship before the details” and “Keep the current action prominent and make the full path optional.” These decision explanations date to [bf02043, Aug 14](https://github.com/sebastianjudeziegler-byte/yova/commit/bf02043). The eval now uses its existing `validateVisibleAdaptation` provenance check and minimum-length requirement without that extra vocabulary filter. The production validator is unchanged, and the new test still rejects an unsupported “visual learner” claim.

## Red/green evidence

The final valid new rubric tests were run against the exact `e03a082` rubric implementations, producing **4 failures / 6 passes**, then against the corrected evals plus fresh-fixture helper, producing **11 passes**. The new runner accounting tests produced **11 failures before implementation / 11 passes after**. A separate early fixture probe with too few multiple-choice options is excluded from behavioral evidence; the final red run uses the valid three-choice fixture.

- [Final rubric red on main](evidence/red/final-rubrics-on-main.txt) → [rubric and fixture green](evidence/green/rubrics-and-fixtures.txt).
- [Runner red](evidence/red/runner.txt) → [runner green](evidence/green/runner.txt).
- [Policy-backed copy red: 1 failed / 7 passed](evidence/red/visible-copy.txt) → [green: 8 passed](evidence/green/visible-copy.txt).
- [Serialized timeout accounting red: 1 failed / 11 passed](evidence/red/serialized-errors.txt) → [green: 12 passed](evidence/green/serialized-errors.txt). Vitest already serializes assertion values; retaining that string avoids double encoding and preserves the unavailable/semantic distinction.
- [Fresh-fixture helper absent before implementation](evidence/red/rubrics-and-fixtures.txt); the helper test then proves a new run cannot consume an earlier run's generated lesson.
- [Missing-key full-command artifact](evidence/unavailable-probe/report.md): **0 pass / 0 fail / 0 flaky / 66 unavailable**, exit 0. This verifies collection and unavailable accounting; it is not a provider pass.

Each corrected expectation below links its actual baseline red and its branch result. Provider outages are not accepted as green. A05/A15/A17 are now REAL: A05 has a passing corrected assertion but an independently observed generator failure; A15 still fails generation; A17 still fails task alignment and needs a product-intent decision. None is claimed fixed. The final STALE cohort contains 14 cases, including the two original timeout cases.

| Corrected expectation / case | Old expectation on main | Live result on branch |
| --- | --- | --- |
| A05 — real placement questions and a map-only scope correction preserve demonstrated ATP | FAIL — [run 1](evidence/baseline-1/plan-creation-blockers.txt) | FAIL — [log](evidence/branch-live-gate/run-1-plan-creation-blockers.txt); supplemental **PASSED** — [log](evidence/stale-verification/A05.txt) |
| A06 — Biology test with learner notes | FAIL — [run 1](evidence/baseline-1/plan-quality.txt) | UNAVAILABLE — [log](evidence/branch-live-gate/run-1-plan-quality.txt); supplemental **PASSED** — [log](evidence/stale-verification/A06.txt) |
| A07 — Calculus problem-solving plan | FAIL — [run 1](evidence/baseline-1/plan-quality.txt) | PASS — [log](evidence/branch-live-gate/run-1-plan-quality.txt) |
| A08 — One product-rule skill in short sessions | FAIL — [run 2](evidence/baseline-2/plan-quality.txt) | PASS — [log](evidence/branch-live-gate/run-1-plan-quality.txt) |
| A09 — World War I unit guide in short sessions | FAIL — [run 1](evidence/baseline-1/plan-quality.txt) | UNAVAILABLE — [log](evidence/branch-live-gate/run-1-plan-quality.txt); supplemental **PASSED** — [log](evidence/stale-verification/A09.txt) |
| A10 — Full beginner calculus pathway | FAIL — [run 1](evidence/baseline-1/plan-quality.txt) | PASS — [log](evidence/branch-live-gate/run-1-plan-quality.txt) |
| A11 — General-learning startup funding pathway | FAIL — [run 1](evidence/baseline-1/plan-quality.txt) | PASS — [log](evidence/branch-live-gate/run-1-plan-quality.txt) |
| A12 — History essay using outside sources | FAIL — [run 3](evidence/baseline-3/plan-quality.txt) | PASS — [log](evidence/branch-live-gate/run-1-plan-quality.txt) |
| A13 — Beginner JavaScript practice | FAIL — [run 1](evidence/baseline-1/plan-quality.txt) | PASS — [log](evidence/branch-live-gate/run-1-plan-quality.txt) |
| A14 — General-learning finance pathway | FAIL — [run 1](evidence/baseline-1/plan-quality.txt) | PASS — [log](evidence/branch-live-gate/run-1-plan-quality.txt) |
| A15 — One product-rule skill in short sessions | FAIL — [run 1](evidence/baseline-1/plan-session-journey.txt) | FAIL — [log](evidence/branch-live-gate/run-1-plan-session-journey.txt); supplemental **FAILED** — [log](evidence/stale-verification/A15.txt) |
| A17 — Full beginner calculus pathway | FAIL — [run 1](evidence/baseline-1/plan-session-journey.txt) | FAIL — [log](evidence/branch-live-gate/run-1-plan-session-journey.txt); supplemental **FAILED** — [log](evidence/stale-verification/A17.txt) |
| A18 — History essay using outside sources | FAIL — [run 1](evidence/baseline-1/plan-session-journey.txt) | FAIL — [log](evidence/branch-live-gate/run-1-plan-session-journey.txt); supplemental **PASSED** — [log](evidence/stale-verification/A18.txt) |
| A20 — Fifteen-minute temperature and reaction-rate explanation | FAIL — [run 1](evidence/baseline-1/session-quality.txt) | PASS — [log](evidence/branch-live-gate/run-1-session-quality.txt) |
| A28 — General-learning finance application | FAIL — [run 1](evidence/baseline-1/session-quality.txt) | PASS — [log](evidence/branch-live-gate/run-1-session-quality.txt) |
| A29 — Startup funding foundations for a new learner | FAIL — [run 1](evidence/baseline-1/session-quality.txt) | PASS — [log](evidence/branch-live-gate/run-1-session-quality.txt) |
| A34 — builds the production 15-minute two-target teaching skeleton | FAIL — [run 1](evidence/baseline-1/streamed-rayleigh.txt) | PASS — [log](evidence/branch-live-gate/run-1-streamed-rayleigh.txt) |

## Full gate verification on this branch

The new single-command run tests commit `b91bb5fb03d921424a3966306d44e6bcdd5ec212`. Its counts are `{"pass": 35, "fail": 17, "flaky": 10, "unavailable": 4}`. [Full table and per-suite logs](evidence/branch-live-gate/report.md).

This full run completed all 66 cases and exited 1: **35 pass / 17 fail / 10 flaky / 4 unavailable**. Both live browser journeys passed; they remain reported as flaky because of their baseline history. The later vocabulary-only eval correction and serialized-error accounting correction have separate red/green logs; focused live verification covers every STALE case without a pass in the complete run. Those follow-ups do not replace the original full-run table or change baseline pass rates. The complete run also exposed a diagnostic-generator failure in A05 and compact-recovery schema failure in A15 before their corrected assertions; both are retained in the logs and backlog and reclassified REAL, not fixed or counted as provider outages. A17 subsequently reached an unchanged task-alignment assertion: the five-activity lesson scored 85/100, but the existing keyword-based test rejected it. Because deciding whether that first foundational Learn lesson must satisfy the plan-wide problem-solving criterion requires product intent, A17 is REAL and the assertion remains unchanged. The complete-run artifact retains the classifications in force when it ran; the classification table above and current gate policy contain the final decisions.

The gate still executes quarantined flakes; semantic REAL/STALE/new failures block. Provider unavailability does not block or become green. Required audited identities prevent deleting/skipping a canary from silently shrinking the gate. Unknown future live files are discovered automatically. Raw provider reports are temporary; published artifacts retain bounded errors, redacted logs, and learner browser receipts/screenshots.

Run locally with `pnpm test:live` (or `node scripts/run-live-gate.mjs`); `--runs 3` repeats the entire set serially. [Runbook and bucket definitions](../../testing/live-gate.md). The CI workflow schedules main nightly at 03:17 UTC and accepts an explicit same-repository PR number on demand, checks its exact head, publishes one artifact, and attaches the Full live gate commit status. It does not expose credentials to fork PR code. This workflow becomes schedulable after it exists on main; it has not been deployed by this PR. Existing repository secret availability is unverified, and no secrets or branch-protection settings were changed.

Final test/runner implementation: `93791f9c54fcbbf082a91ff489971e446fd15590`. The final ordinary checks and focused live follow-ups exercised these exact source changes; the following commit only adds audit evidence. All **14 final STALE cases** have a live pass after their baseline red. The final classification and required inventory agree on all 66 cases.

## Ordinary regression gates

Ordinary browser runs used this [temporary harness](evidence/ordinary-browser-harness.ts.txt), substituting the direct local Next command for the package-manager wrapper. It was removed after verification. Text artifacts redact configured secrets, omit browser-server environment values, normalize the repo path, and remove ANSI color/trailing whitespace; assertion content is retained.

| Gate | Result | Evidence |
| --- | --- | --- |
| Ordinary unit suite | 3,888 passed; 75 opt-in cases skipped | [log](evidence/green/unit.txt) |
| Live-runner accounting unit tests | 12 passed | [log](evidence/green/runner.txt) |
| Lint | Passed | [log](evidence/green/lint.txt) |
| Typecheck | Passed | [log](evidence/green/typecheck.txt) |
| Build and readiness check | Passed | [build](evidence/green/build.txt), [readiness](evidence/green/readiness.txt) |
| Desktop + mobile ordinary journeys | 256 passed; 19 deliberate skips; 9 failed | [log](evidence/green/browser-normal.txt), [per-test report](evidence/green/browser-normal/report.json) |
| Isolated auth/cloud-sync journeys | 15 passed; 1 deliberate skips; 0 failed | [log](evidence/green/browser-auth.txt), [per-test report](evidence/green/browser-auth/report.json) |
| Migration replay | Not applicable: no migrations changed | Diff contains no SQL or migration files |


The initial ordinary-browser run lasted 61 minutes, logged Next dev-server memory-threshold restarts, and ended with nine mobile timeouts/delayed UI transitions. Its failures are retained above. Replays use the same assertions, timeouts, keys-disabled preview configuration, and heap settings, with a fresh server for each affected file. No ordinary test was quarantined or product code changed.

| Fresh-server replay | Result | Evidence |
| --- | --- | --- |
| e2e/accessibility-regression.spec.ts (mobile-chromium) | 2 passed / 0 failed | [log](evidence/green/browser-replay-1.txt), [per-test report](evidence/green/browser-replay-1/report.json) |
| e2e/add-to-yova.spec.ts (mobile-chromium) | 1 passed / 0 failed | [log](evidence/green/browser-replay-2.txt), [per-test report](evidence/green/browser-replay-2/report.json) |
| e2e/core-learning-loop.spec.ts (mobile-chromium) | 4 passed / 0 failed | [log](evidence/green/browser-replay-3.txt), [per-test report](evidence/green/browser-replay-3/report.json) |
| e2e/plan-schedule-date.spec.ts (mobile-chromium) | 2 passed / 0 failed | [log](evidence/green/browser-replay-4.txt), [per-test report](evidence/green/browser-replay-4/report.json) |

Ordinary browser coverage is complete: 256 initial passes plus nine unchanged fresh-server passes cover all 265 non-skipped ordinary cases; the isolated authentication run adds 15 passes. The failed initial attempt remains visible and is not described as a clean full-run pass. This infrastructure instability is recorded in BACKLOG and left unfixed.

## Ranked REAL failures

This list ranks cases, not distinct root causes. Causes are informed hypotheses, not product fixes. [BACKLOG](../BACKLOG.md) contains a reproduction command, observed behavior, severity and create → activate → session → complete exposure for each.

| Rank | Case | Severity | Most likely cause |
| --- | --- | --- | --- |
| 1 | [A03](#a03) — admits uncertainty when the prompt lacks necessary context | P1 | The evaluator trusts a vague reference/rubric instead of detecting missing observations and withholding judgment. |
| 2 | [X06](#x06) — builds a topic-specific teaching skeleton | P1 | The target-to-subject validator rejects the provider’s bounded membrane/transport claims during finalization. |
| 3 | [A22](#a22) — Mapped product-rule and chain-rule first lesson | P1 | The bounded compact-recovery output does not match the schema expected by session finalization. |
| 4 | [A15](#a15) — One product-rule skill in short sessions | P1 | The authoritative slice separates the product-rule formula from identifying its factors, but generated teaching/checks cross that boundary and compact recovery does not satisfy the schema. |
| 5 | [A27](#a27) — Beginner JavaScript with fading support | P1 | The provider/recovery assigns duplicate explanatory claims to the current slice, and deterministic finalization rejects them. |
| 6 | [A32](#a32) — Spanish conversation with supported transfer | P1 | The provider/recovery assigns duplicate explanatory claims to the current slice, and deterministic finalization rejects them. |
| 7 | [A35](#a35) — delivers substantive teaching from the first generated lesson brief | P1 | The generated teaching claims fail the authoritative subject/scope validator; repair does not reliably recover that boundary. |
| 8 | [A36](#a36) — creates the production 45-minute streamed teaching session | P1 | The generated teaching claims fail the authoritative subject/scope validator; repair does not reliably recover that boundary. |
| 9 | [A16](#a16) — World War I unit guide in short sessions | P1 (legacy material path) | The retained legacy pure-material path reaches a fallback that requires mapped source authority; source-outline roles may also be inconsistent. The contract still promises legacy support, so this is a product-intent question, not permission to invent fixture mappings. |
| 10 | [A19](#a19) — Biology teaching from learner notes | P1 (legacy material path) | The retained legacy pure-material path reaches a fallback that requires mapped source authority; source-outline roles may also be inconsistent. The contract still promises legacy support, so this is a product-intent question, not permission to invent fixture mappings. |
| 11 | [A24](#a24) — World War I teaching for a complete beginner | P1 (legacy material path) | The retained legacy pure-material path reaches a fallback that requires mapped source authority; source-outline roles may also be inconsistent. The contract still promises legacy support, so this is a product-intent question, not permission to invent fixture mappings. |
| 12 | [A30](#a30) — History reasoning from a primary-source excerpt | P1 (legacy material path) | The retained legacy pure-material path reaches a fallback that requires mapped source authority; source-outline roles may also be inconsistent. The contract still promises legacy support, so this is a product-intent question, not permission to invent fixture mappings. |
| 13 | [A31](#a31) — Literature close reading from a short passage | P1 (legacy material path) | The retained legacy pure-material path reaches a fallback that requires mapped source authority; source-outline roles may also be inconsistent. The contract still promises legacy support, so this is a product-intent question, not permission to invent fixture mappings. |
| 14 | [A33](#a33) — Teaching from a thin biology study guide | P1 (legacy material path) | The retained legacy pure-material path reaches a fallback that requires mapped source authority; source-outline roles may also be inconsistent. The contract still promises legacy support, so this is a product-intent question, not permission to invent fixture mappings. |
| 15 | [A05](#a05) — real placement questions and a map-only scope correction preserve demonstrated ATP | P2 (optional placement) | The diagnostic generator and answer verifier sometimes disagree about answer support, consistent with the diagnostic failures seen in X03/X04. |
| 16 | [A17](#a17) — Full beginner calculus pathway | P2 (product-intent question) | The journey applies its plan-wide problem_solving task family to a foundational first Learn lesson; either the lexical test is too narrow or the lesson needs more explicit problem work. Founder decision required before changing that assertion. |
| 17 | [A01](#a01) — accepts a correct biology paraphrase | P2 | The verdict follows the required rubric while missingIdeas still pulls optional details from the reference answer. |
| 18 | [A02](#a02) — accepts a concise programming explanation | P2 | The verdict follows the required rubric while missingIdeas still pulls optional details from the reference answer. |

## Deliberately left open

No product code, REAL defect, quarantined flaky assertion, Brief A/B behavior, session runtime, calendar, material handling, or gap-evidence rule was changed. No merge, deployment, production setting, rollout flip, or branch-protection change was performed. The new gate is expected to remain blocking while REAL cases fail; this triage PR records that state rather than silently waiving it. The founder decides the next fixes using the ranked backlog.

## Per-test records

<a id="a01"></a>

### A01 — accepts a correct biology paraphrase

`src/evals/answer-evaluation-quality.live.test.ts` — `live OpenAI answer evaluation quality > 'accepts a correct biology paraphrase'`

**REAL**, 0/3 passed, 3 assertion/semantic failures, 0 unavailable attempts. A correct paraphrase received secure plus non-empty missingIdeas even though those details are explicitly optional in the fixture rubric.

- [run 1](evidence/baseline-1/answer-evaluation-quality.txt) — **FAIL**: AssertionError: expected [ Array(1) ] to deeply equal []  - Expected + Received  - [] + [ +   "oxygen accepts hydrogen ions to form water", + ]
- [run 2](evidence/baseline-2/answer-evaluation-quality.txt) — **FAIL**: AssertionError: expected [ Array(1) ] to deeply equal []  - Expected + Received  - [] + [ +   "oxygen combines with electrons and hydrogen ions to form water", + ]
- [run 3](evidence/baseline-3/answer-evaluation-quality.txt) — **FAIL**: AssertionError: expected [ Array(1) ] to deeply equal []  - Expected + Received  - [] + [ +   "oxygen accepts hydrogen ions to form water", + ]

<a id="a02"></a>

### A02 — accepts a concise programming explanation

`src/evals/answer-evaluation-quality.live.test.ts` — `live OpenAI answer evaluation quality > 'accepts a concise programming explana…'`

**REAL**, 0/3 passed, 3 assertion/semantic failures, 0 unavailable attempts. A correct paraphrase received secure plus non-empty missingIdeas even though those details are explicitly optional in the fixture rubric.

- [run 1](evidence/baseline-1/answer-evaluation-quality.txt) — **FAIL**: AssertionError: expected [ Array(1) ] to deeply equal []  - Expected + Received  - [] + [ +   "function returns back through earlier calls", + ]
- [run 2](evidence/baseline-2/answer-evaluation-quality.txt) — **FAIL**: AssertionError: expected [ Array(1) ] to deeply equal []  - Expected + Received  - [] + [ +   "Earlier recursive calls return after the base case is reached", + ]
- [run 3](evidence/baseline-3/answer-evaluation-quality.txt) — **FAIL**: AssertionError: expected [ Array(1) ] to deeply equal []  - Expected + Received  - [] + [ +   "Base case allows the recursive calls to terminate", + ]

<a id="a03"></a>

### A03 — admits uncertainty when the prompt lacks necessary context

`src/evals/answer-evaluation-quality.live.test.ts` — `live OpenAI answer evaluation quality > 'admits uncertainty when the prompt la…'`

**REAL**, 0/3 passed, 3 assertion/semantic failures, 0 unavailable attempts. The rate-change answer was graded secure with no stated process, observations, or changed condition.

- [run 1](evidence/baseline-1/answer-evaluation-quality.txt) — **FAIL**: AssertionError: expected [ 'uncertain' ] to include 'secure'
- [run 2](evidence/baseline-2/answer-evaluation-quality.txt) — **FAIL**: AssertionError: expected [ 'uncertain' ] to include 'secure'
- [run 3](evidence/baseline-3/answer-evaluation-quality.txt) — **FAIL**: AssertionError: expected [ 'uncertain' ] to include 'secure'

<a id="a04"></a>

### A04 — builds an arbitrary three-target teaching-first session repeatedly

`src/evals/outside-teaching-reliability.live.test.ts` — `live outside-YOVA teaching reliability > builds an arbitrary three-target teaching-first session repeatedly`

**FLAKY**, 1/3 passed, 2 assertion/semantic failures, 0 unavailable attempts. Passed 1/3 complete main runs; 2 semantic failure(s), 0 unavailable attempt(s). AssertionError: expected [ { run: 1, …(1) }, { run: 2, …(1) } ] to deeply equal [] - Expected + Received - [] + [ + { + "generationStats": { + "attempts": 2, + "cacheWriteTokens": 0, + "cachedInputTokens": 6912, + "cause

- [run 1](evidence/baseline-1/outside-teaching-reliability.txt) — **FAIL**: AssertionError: expected [ { run: 1, …(1) }, { run: 2, …(1) } ] to deeply equal []  - Expected + Received  - [] + [ +   { +     "generationStats": { +       "attempts": 2, +       "cacheWriteTokens": 0, +       "cachedInputTokens": 6912, +       "cause": "semantic_validation", +       "elapsedMs": 21791, +       "failedValidator": "session_method_fidelity", +       "firstAttemptPassed": false, +       "inputTokens": 24047, +       "outputTokens": 3354, +       "repairAttempted": true, +       "repairDetail": "The session produced a error_repair runtime, but self_explanation does not use a method runtime. Follow-up repair failure: reexplain is attached to an activity type that cannot perform that learning phase.", +       "repairReason": "semantic_validation", +       "repairSucceeded": false, +       "stage": "validation", +       "strategy": "full", +       "validationIssueCode": null, +     }, +     "run": 1, +   }, +   { +     "generationStats": { +       "attempts": 2, +       "cacheWriteTokens": 0, +       "cachedInputTokens": 18432, +       "cause": "semantic_validation", +       "elapsedMs": 22782, +       "failedValidator": "session_method_fidelity", +       "firstAttemptPassed": false, +       "inputTokens": 24043, +       "outputTokens": 3316, +       "repairAttempted": true, +       "repairDetail": "reexplain is attached to an activity type that cannot perform that learning phase. Follow-up repair failure: connect is attached to an activity type that cannot perform that learning phase.", +       "repairReason": "semantic_validation", +       "repairSucceeded": false, +       "stage": "validation", +       "strategy": "full", +       "validationIssueCode": null, +     }, +     "run": 2, +   }, + ]
- [run 2](evidence/baseline-2/outside-teaching-reliability.txt) — **PASS**: All existing assertions passed.
- [run 3](evidence/baseline-3/outside-teaching-reliability.txt) — **FAIL**: AssertionError: expected [ { run: 1, …(1) }, { run: 2, …(1) } ] to deeply equal []  - Expected + Received  - [] + [ +   { +     "generationStats": { +       "attempts": 2, +       "cacheWriteTokens": 0, +       "cachedInputTokens": 18432, +       "cause": "semantic_validation", +       "elapsedMs": 15677, +       "failedValidator": "session_content_specificity", +       "firstAttemptPassed": false, +       "inputTokens": 24047, +       "outputTokens": 3385, +       "repairAttempted": true, +       "repairDetail": "The session produced a error_repair runtime, but self_explanation does not use a method runtime. Follow-up repair failure: These essential ideas are checked later but are not actually taught in the lesson model: \"Income, preferences, input costs, and expectations can shift demand or supply in a definite direction.\". Teach every listed relationship explicitly, or move it to deferredContent and remove its evidence-map entry.", +       "repairReason": "semantic_validation", +       "repairSucceeded": false, +       "stage": "validation", +       "strategy": "full", +       "validationIssueCode": null, +     }, +     "run": 1, +   }, +   { +     "generationStats": { +       "attempts": 2, +       "cacheWriteTokens": 0, +       "cachedInputTokens": 18432, +       "cause": "semantic_validation", +       "elapsedMs": 18351, +       "failedValidator": "session_method_runtime", +       "firstAttemptPassed": false, +       "inputTokens": 24041, +       "outputTokens": 3534, +       "repairAttempted": true, +       "repairDetail": "explain is attached to an activity type that cannot perform that learning phase. Follow-up repair failure: The session produced a error_repair runtime, but self_explanation does not use a method runtime.", +       "repairReason": "semantic_validation", +       "repairSucceeded": false, +       "stage": "validation", +       "strategy": "full", +       "validationIssueCode": null, +     }, +     "run": 2, +   }, + ]

<a id="a05"></a>

### A05 — real placement questions and a map-only scope correction preserve demonstrated ATP

`src/evals/plan-creation-blockers.live.test.ts` — `live provider launch canaries > real placement questions and a map-only scope correction preserve demonstrated ATP`

**REAL**, 0/3 passed, 3 assertion/semantic failures, 0 unavailable attempts. The complete branch run rejected generated placement questions as ambiguous or unsupported before the corrected evidence/deferral assertion; a focused follow-up passed that assertion.

Initially STALE; reclassified REAL after an independent post-correction product failure or intent question. Follow-up evidence: [log](evidence/branch-live-gate/run-1-plan-creation-blockers.txt), [log](evidence/stale-verification/A05.txt).

- [run 1](evidence/baseline-1/plan-creation-blockers.txt) — **FAIL**: AssertionError: expected undefined to be 'study' // Object.is equality  - Expected: "study"  + Received: undefined
- [run 2](evidence/baseline-2/plan-creation-blockers.txt) — **FAIL**: AssertionError: expected undefined to be 'study' // Object.is equality  - Expected: "study"  + Received: undefined
- [run 3](evidence/baseline-3/plan-creation-blockers.txt) — **FAIL**: AssertionError: expected undefined to be 'study' // Object.is equality  - Expected: "study"  + Received: undefined

<a id="a06"></a>

### A06 — Biology test with learner notes

`src/evals/plan-quality.live.test.ts` — `live OpenAI plan quality > 'Biology test with learner notes'`

**STALE**, 0/3 passed, 3 assertion/semantic failures, 0 unavailable attempts. No map was supplied: the old rubric rejects 0/0 coverage; the no-map contract has explicitly been a no-op since 6f348ab (Aug 20).

- [run 1](evidence/baseline-1/plan-quality.txt) — **FAIL**: AssertionError: expected [ Array(1) ] to deeply equal []  - Expected + Received  - [] + [ +   "Every mapped topic is scheduled or explicitly deferred", + ]
- [run 2](evidence/baseline-2/plan-quality.txt) — **FAIL**: AssertionError: expected [ Array(1) ] to deeply equal []  - Expected + Received  - [] + [ +   "Every mapped topic is scheduled or explicitly deferred", + ]
- [run 3](evidence/baseline-3/plan-quality.txt) — **FAIL**: AssertionError: expected [ Array(1) ] to deeply equal []  - Expected + Received  - [] + [ +   "Every mapped topic is scheduled or explicitly deferred", + ]

<a id="a07"></a>

### A07 — Calculus problem-solving plan

`src/evals/plan-quality.live.test.ts` — `live OpenAI plan quality > 'Calculus problem-solving plan'`

**STALE**, 0/3 passed, 3 assertion/semantic failures, 0 unavailable attempts. No map was supplied: the old rubric rejects 0/0 coverage; the no-map contract has explicitly been a no-op since 6f348ab (Aug 20).

- [run 1](evidence/baseline-1/plan-quality.txt) — **FAIL**: AssertionError: expected [ Array(1) ] to deeply equal []  - Expected + Received  - [] + [ +   "Every mapped topic is scheduled or explicitly deferred", + ]
- [run 2](evidence/baseline-2/plan-quality.txt) — **FAIL**: AssertionError: expected [ Array(1) ] to deeply equal []  - Expected + Received  - [] + [ +   "Every mapped topic is scheduled or explicitly deferred", + ]
- [run 3](evidence/baseline-3/plan-quality.txt) — **FAIL**: AssertionError: expected [ Array(1) ] to deeply equal []  - Expected + Received  - [] + [ +   "Every mapped topic is scheduled or explicitly deferred", + ]

<a id="a08"></a>

### A08 — One product-rule skill in short sessions

`src/evals/plan-quality.live.test.ts` — `live OpenAI plan quality > 'One product-rule skill in short sessi…'`

**STALE**, 0/3 passed, 2 assertion/semantic failures, 1 unavailable attempts. No map was supplied: the old rubric rejects 0/0 coverage; the no-map contract has explicitly been a no-op since 6f348ab (Aug 20).

- [run 1](evidence/baseline-1/plan-quality.txt) — **UNAVAILABLE**: Provider request timed out (cause recorded in suite log)
- [run 2](evidence/baseline-2/plan-quality.txt) — **FAIL**: AssertionError: expected [ Array(1) ] to deeply equal []  - Expected + Received  - [] + [ +   "Every mapped topic is scheduled or explicitly deferred", + ]
- [run 3](evidence/baseline-3/plan-quality.txt) — **FAIL**: AssertionError: expected [ Array(1) ] to deeply equal []  - Expected + Received  - [] + [ +   "Every mapped topic is scheduled or explicitly deferred", + ]

<a id="a09"></a>

### A09 — World War I unit guide in short sessions

`src/evals/plan-quality.live.test.ts` — `live OpenAI plan quality > 'World War I unit guide in short sessi…'`

**STALE**, 0/3 passed, 3 assertion/semantic failures, 0 unavailable attempts. No map was supplied: the old rubric rejects 0/0 coverage; the no-map contract has explicitly been a no-op since 6f348ab (Aug 20).

- [run 1](evidence/baseline-1/plan-quality.txt) — **FAIL**: AssertionError: expected [ Array(1) ] to deeply equal []  - Expected + Received  - [] + [ +   "Every mapped topic is scheduled or explicitly deferred", + ]
- [run 2](evidence/baseline-2/plan-quality.txt) — **FAIL**: AssertionError: expected [ Array(1) ] to deeply equal []  - Expected + Received  - [] + [ +   "Every mapped topic is scheduled or explicitly deferred", + ]
- [run 3](evidence/baseline-3/plan-quality.txt) — **FAIL**: AssertionError: expected [ Array(1) ] to deeply equal []  - Expected + Received  - [] + [ +   "Every mapped topic is scheduled or explicitly deferred", + ]

<a id="a10"></a>

### A10 — Full beginner calculus pathway

`src/evals/plan-quality.live.test.ts` — `live OpenAI plan quality > 'Full beginner calculus pathway'`

**STALE**, 0/3 passed, 3 assertion/semantic failures, 0 unavailable attempts. No map was supplied: the old rubric rejects 0/0 coverage; the no-map contract has explicitly been a no-op since 6f348ab (Aug 20).

- [run 1](evidence/baseline-1/plan-quality.txt) — **FAIL**: AssertionError: expected [ Array(1) ] to deeply equal []  - Expected + Received  - [] + [ +   "Every mapped topic is scheduled or explicitly deferred", + ]
- [run 2](evidence/baseline-2/plan-quality.txt) — **FAIL**: AssertionError: expected [ Array(1) ] to deeply equal []  - Expected + Received  - [] + [ +   "Every mapped topic is scheduled or explicitly deferred", + ]
- [run 3](evidence/baseline-3/plan-quality.txt) — **FAIL**: AssertionError: expected [ Array(1) ] to deeply equal []  - Expected + Received  - [] + [ +   "Every mapped topic is scheduled or explicitly deferred", + ]

<a id="a11"></a>

### A11 — General-learning startup funding pathway

`src/evals/plan-quality.live.test.ts` — `live OpenAI plan quality > 'General-learning startup funding path…'`

**STALE**, 0/3 passed, 3 assertion/semantic failures, 0 unavailable attempts. No map was supplied: the old rubric rejects 0/0 coverage; the no-map contract has explicitly been a no-op since 6f348ab (Aug 20).

- [run 1](evidence/baseline-1/plan-quality.txt) — **FAIL**: AssertionError: expected [ Array(1) ] to deeply equal []  - Expected + Received  - [] + [ +   "Every mapped topic is scheduled or explicitly deferred", + ]
- [run 2](evidence/baseline-2/plan-quality.txt) — **FAIL**: AssertionError: expected [ Array(1) ] to deeply equal []  - Expected + Received  - [] + [ +   "Every mapped topic is scheduled or explicitly deferred", + ]
- [run 3](evidence/baseline-3/plan-quality.txt) — **FAIL**: AssertionError: expected [ Array(1) ] to deeply equal []  - Expected + Received  - [] + [ +   "Every mapped topic is scheduled or explicitly deferred", + ]

<a id="a12"></a>

### A12 — History essay using outside sources

`src/evals/plan-quality.live.test.ts` — `live OpenAI plan quality > 'History essay using outside sources'`

**STALE**, 0/3 passed, 1 assertion/semantic failures, 2 unavailable attempts. No map was supplied: the old rubric rejects 0/0 coverage; the no-map contract has explicitly been a no-op since 6f348ab (Aug 20).

- [run 1](evidence/baseline-1/plan-quality.txt) — **UNAVAILABLE**: Provider request timed out (cause recorded in suite log)
- [run 2](evidence/baseline-2/plan-quality.txt) — **UNAVAILABLE**: Provider request timed out (cause recorded in suite log)
- [run 3](evidence/baseline-3/plan-quality.txt) — **FAIL**: AssertionError: expected [ Array(1) ] to deeply equal []  - Expected + Received  - [] + [ +   "Every mapped topic is scheduled or explicitly deferred", + ]

<a id="a13"></a>

### A13 — Beginner JavaScript practice

`src/evals/plan-quality.live.test.ts` — `live OpenAI plan quality > 'Beginner JavaScript practice'`

**STALE**, 0/3 passed, 2 assertion/semantic failures, 1 unavailable attempts. No map was supplied: the old rubric rejects 0/0 coverage; the no-map contract has explicitly been a no-op since 6f348ab (Aug 20).

- [run 1](evidence/baseline-1/plan-quality.txt) — **FAIL**: AssertionError: expected [ Array(1) ] to deeply equal []  - Expected + Received  - [] + [ +   "Every mapped topic is scheduled or explicitly deferred", + ]
- [run 2](evidence/baseline-2/plan-quality.txt) — **FAIL**: AssertionError: expected [ Array(1) ] to deeply equal []  - Expected + Received  - [] + [ +   "Every mapped topic is scheduled or explicitly deferred", + ]
- [run 3](evidence/baseline-3/plan-quality.txt) — **UNAVAILABLE**: Provider request timed out (cause recorded in suite log)

<a id="a14"></a>

### A14 — General-learning finance pathway

`src/evals/plan-quality.live.test.ts` — `live OpenAI plan quality > 'General-learning finance pathway'`

**STALE**, 0/3 passed, 3 assertion/semantic failures, 0 unavailable attempts. No map was supplied: the old rubric rejects 0/0 coverage; the no-map contract has explicitly been a no-op since 6f348ab (Aug 20).

- [run 1](evidence/baseline-1/plan-quality.txt) — **FAIL**: AssertionError: expected [ Array(1) ] to deeply equal []  - Expected + Received  - [] + [ +   "Every mapped topic is scheduled or explicitly deferred", + ]
- [run 2](evidence/baseline-2/plan-quality.txt) — **FAIL**: AssertionError: expected [ Array(1) ] to deeply equal []  - Expected + Received  - [] + [ +   "Every mapped topic is scheduled or explicitly deferred", + ]
- [run 3](evidence/baseline-3/plan-quality.txt) — **FAIL**: AssertionError: expected [ Array(1) ] to deeply equal []  - Expected + Received  - [] + [ +   "Every mapped topic is scheduled or explicitly deferred", + ]

<a id="a15"></a>

### A15 — One product-rule skill in short sessions

`src/evals/plan-session-journey.live.test.ts` — `live plan-to-session journeys > 'One product-rule skill in short sessi…'`

**REAL**, 0/3 passed, 2 assertion/semantic failures, 1 unavailable attempts. Session generation failed its bounded compact-recovery schema twice after the stale no-map assertion was corrected; telemetry says the formula-only active slice leaked the deferred factor-identification target.

Initially STALE; reclassified REAL after an independent post-correction product failure or intent question. Follow-up evidence: [log](evidence/branch-live-gate/run-1-plan-session-journey.txt), [log](evidence/stale-verification/A15.txt).

- [run 1](evidence/baseline-1/plan-session-journey.txt) — **FAIL**: AssertionError: expected [ Array(1) ] to deeply equal []  - Expected + Received  - [] + [ +   "Every mapped topic is scheduled or explicitly deferred", + ]
- [run 2](evidence/baseline-2/plan-session-journey.txt) — **UNAVAILABLE**: Provider request timed out (cause recorded in suite log)
- [run 3](evidence/baseline-3/plan-session-journey.txt) — **FAIL**: AssertionError: expected [ Array(1) ] to deeply equal []  - Expected + Received  - [] + [ +   "Every mapped topic is scheduled or explicitly deferred", + ]

<a id="a16"></a>

### A16 — World War I unit guide in short sessions

`src/evals/plan-session-journey.live.test.ts` — `live plan-to-session journeys > 'World War I unit guide in short sessi…'`

**REAL**, 0/3 passed, 3 assertion/semantic failures, 0 unavailable attempts. Generation refused the supplied material with “no readable explanatory source is mapped to the active target”; some attempts instead reached an obsolete rubric assertion.

- [run 1](evidence/baseline-1/plan-session-journey.txt) — **FAIL**: AssertionError: expected [ Array(1) ] to deeply equal []  - Expected + Received  - [] + [ +   "Every mapped topic is scheduled or explicitly deferred", + ]
- [run 2](evidence/baseline-2/plan-session-journey.txt) — **FAIL**: SessionGenerationFailure: YOVA could not build a trustworthy session because no readable explanatory source is mapped to the active target. Attach or reprocess readable material, or review the session setup and choose a source-independent route.
- [run 3](evidence/baseline-3/plan-session-journey.txt) — **FAIL**: AssertionError: expected [ Array(1) ] to deeply equal []  - Expected + Received  - [] + [ +   "Every mapped topic is scheduled or explicitly deferred", + ]

<a id="a17"></a>

### A17 — Full beginner calculus pathway

`src/evals/plan-session-journey.live.test.ts` — `live plan-to-session journeys > 'Full beginner calculus pathway'`

**REAL**, 0/3 passed, 3 assertion/semantic failures, 0 unavailable attempts. The corrected connected journey generated a five-activity Worked Examples lesson scoring 85/100, then failed the required “Activities fit the learning task” check. No full learner activity dump was retained by that existing canary, so this is an unresolved intent question rather than a claim that the lesson was definitively wrong.

Initially STALE; reclassified REAL after an independent post-correction product failure or intent question. Follow-up evidence: [log](evidence/branch-live-gate/run-1-plan-session-journey.txt), [log](evidence/stale-verification/A17.txt).

- [run 1](evidence/baseline-1/plan-session-journey.txt) — **FAIL**: AssertionError: expected [ Array(1) ] to deeply equal []  - Expected + Received  - [] + [ +   "Every mapped topic is scheduled or explicitly deferred", + ]
- [run 2](evidence/baseline-2/plan-session-journey.txt) — **FAIL**: AssertionError: expected [ Array(1) ] to deeply equal []  - Expected + Received  - [] + [ +   "Every mapped topic is scheduled or explicitly deferred", + ]
- [run 3](evidence/baseline-3/plan-session-journey.txt) — **FAIL**: AssertionError: expected [ Array(1) ] to deeply equal []  - Expected + Received  - [] + [ +   "Every mapped topic is scheduled or explicitly deferred", + ]

<a id="a18"></a>

### A18 — History essay using outside sources

`src/evals/plan-session-journey.live.test.ts` — `live plan-to-session journeys > 'History essay using outside sources'`

**STALE**, 0/3 passed, 3 assertion/semantic failures, 0 unavailable attempts. No map was supplied: the old rubric rejects 0/0 coverage; the no-map contract has explicitly been a no-op since 6f348ab (Aug 20).

- [run 1](evidence/baseline-1/plan-session-journey.txt) — **FAIL**: AssertionError: expected [ Array(1) ] to deeply equal []  - Expected + Received  - [] + [ +   "Every mapped topic is scheduled or explicitly deferred", + ]
- [run 2](evidence/baseline-2/plan-session-journey.txt) — **FAIL**: AssertionError: expected [ Array(1) ] to deeply equal []  - Expected + Received  - [] + [ +   "Every mapped topic is scheduled or explicitly deferred", + ]
- [run 3](evidence/baseline-3/plan-session-journey.txt) — **FAIL**: AssertionError: expected [ Array(1) ] to deeply equal []  - Expected + Received  - [] + [ +   "Every mapped topic is scheduled or explicitly deferred", + ]

<a id="a19"></a>

### A19 — Biology teaching from learner notes

`src/evals/session-quality.live.test.ts` — `live OpenAI session quality > 'Biology teaching from learner notes'`

**REAL**, 0/3 passed, 3 assertion/semantic failures, 0 unavailable attempts. Generation refused the supplied material with “no readable explanatory source is mapped to the active target”; some attempts instead reached an obsolete rubric assertion.

- [run 1](evidence/baseline-1/session-quality.txt) — **FAIL**: SessionGenerationFailure: YOVA could not build a trustworthy session because no readable explanatory source is mapped to the active target. Attach or reprocess readable material, or review the session setup and choose a source-independent route.
- [run 2](evidence/baseline-2/session-quality.txt) — **FAIL**: SessionGenerationFailure: YOVA could not build a trustworthy session because no readable explanatory source is mapped to the active target. Attach or reprocess readable material, or review the session setup and choose a source-independent route.
- [run 3](evidence/baseline-3/session-quality.txt) — **FAIL**: SessionGenerationFailure: YOVA could not build a trustworthy session because no readable explanatory source is mapped to the active target. Attach or reprocess readable material, or review the session setup and choose a source-independent route.

<a id="a20"></a>

### A20 — Fifteen-minute temperature and reaction-rate explanation

`src/evals/session-quality.live.test.ts` — `live OpenAI session quality > 'Fifteen-minute temperature and reacti…'`

**STALE**, 0/3 passed, 3 assertion/semantic failures, 0 unavailable attempts. The old 4/5 activity cap predates the method-aware Learn budget and recognition phase in b8f5e102 (Sep 1).

- [run 1](evidence/baseline-1/session-quality.txt) — **FAIL**: AssertionError: expected [ 'Activity count fits the session' ] to deeply equal []  - Expected + Received  - [] + [ +   "Activity count fits the session", + ]
- [run 2](evidence/baseline-2/session-quality.txt) — **FAIL**: AssertionError: expected [ 'Activity count fits the session' ] to deeply equal []  - Expected + Received  - [] + [ +   "Activity count fits the session", + ]
- [run 3](evidence/baseline-3/session-quality.txt) — **FAIL**: AssertionError: expected [ 'Activity count fits the session' ] to deeply equal []  - Expected + Received  - [] + [ +   "Activity count fits the session", + ]

<a id="a21"></a>

### A21 — Fifteen-minute first product-rule lesson

`src/evals/session-quality.live.test.ts` — `live OpenAI session quality > 'Fifteen-minute first product-rule les…'`

**FLAKY**, 1/3 passed, 2 assertion/semantic failures, 0 unavailable attempts. Passed 1/3 complete main runs; 2 semantic failure(s), 0 unavailable attempt(s). SessionGenerationFailure: OpenAI did not return a complete streamed teaching skeleton after 1 repair attempt. The compact teaching recovery did not match its bounded content schema.

- [run 1](evidence/baseline-1/session-quality.txt) — **FAIL**: SessionGenerationFailure: OpenAI did not return a complete streamed teaching skeleton after 1 repair attempt. The compact teaching recovery did not match its bounded content schema.
- [run 2](evidence/baseline-2/session-quality.txt) — **PASS**: All existing assertions passed.
- [run 3](evidence/baseline-3/session-quality.txt) — **FAIL**: SessionGenerationFailure: OpenAI did not return a complete streamed teaching skeleton after 1 repair attempt. The compact teaching recovery did not match its bounded content schema.

<a id="a22"></a>

### A22 — Mapped product-rule and chain-rule first lesson

`src/evals/session-quality.live.test.ts` — `live OpenAI session quality > 'Mapped product-rule and chain-rule fi…'`

**REAL**, 0/3 passed, 3 assertion/semantic failures, 0 unavailable attempts. SessionGenerationFailure: OpenAI did not return a complete streamed teaching skeleton after 1 repair attempt. The compact teaching recovery did not match its bounded content schema.

- [run 1](evidence/baseline-1/session-quality.txt) — **FAIL**: AssertionError: expected [ 'Activity count fits the session' ] to deeply equal []  - Expected + Received  - [] + [ +   "Activity count fits the session", + ]
- [run 2](evidence/baseline-2/session-quality.txt) — **FAIL**: SessionGenerationFailure: OpenAI did not return a complete streamed teaching skeleton after 1 repair attempt. The compact teaching recovery did not match its bounded content schema.
- [run 3](evidence/baseline-3/session-quality.txt) — **FAIL**: AssertionError: expected [ 'Activity count fits the session' ] to deeply equal []  - Expected + Received  - [] + [ +   "Activity count fits the session", + ]

<a id="a23"></a>

### A23 — Production-shaped derivative-foundations verification

`src/evals/session-quality.live.test.ts` — `live OpenAI session quality > 'Production-shaped derivative-foundati…'`

**FLAKY**, 2/3 passed, 1 assertion/semantic failures, 0 unavailable attempts. Passed 2/3 complete main runs; 1 semantic failure(s), 0 unavailable attempt(s). SessionGenerationFailure: OpenAI did not return a complete, safe guided session after the bounded repair attempts. The required knowledge check mapped to “The power rule, constant multiple rule, and sum or difference rul

- [run 1](evidence/baseline-1/session-quality.txt) — **PASS**: All existing assertions passed.
- [run 2](evidence/baseline-2/session-quality.txt) — **FAIL**: SessionGenerationFailure: OpenAI did not return a complete, safe guided session after the bounded repair attempts. The required knowledge check mapped to “The power rule, constant multiple rule, and sum or difference rule apply to simple functions.” does not visibly assess that essential idea.
- [run 3](evidence/baseline-3/session-quality.txt) — **PASS**: All existing assertions passed.

<a id="a24"></a>

### A24 — World War I teaching for a complete beginner

`src/evals/session-quality.live.test.ts` — `live OpenAI session quality > 'World War I teaching for a complete b…'`

**REAL**, 0/3 passed, 3 assertion/semantic failures, 0 unavailable attempts. Generation refused the supplied material with “no readable explanatory source is mapped to the active target”; some attempts instead reached an obsolete rubric assertion.

- [run 1](evidence/baseline-1/session-quality.txt) — **FAIL**: SessionGenerationFailure: YOVA could not build a trustworthy session because no readable explanatory source is mapped to the active target. Attach or reprocess readable material, or review the session setup and choose a source-independent route.
- [run 2](evidence/baseline-2/session-quality.txt) — **FAIL**: AssertionError: expected [ 'Activity count fits the session' ] to deeply equal []  - Expected + Received  - [] + [ +   "Activity count fits the session", + ]
- [run 3](evidence/baseline-3/session-quality.txt) — **FAIL**: SessionGenerationFailure: YOVA could not build a trustworthy session because no readable explanatory source is mapped to the active target. Attach or reprocess readable material, or review the session setup and choose a source-independent route.

<a id="a25"></a>

### A25 — Mapped 45-minute World War I baseline lesson

`src/evals/session-quality.live.test.ts` — `live OpenAI session quality > 'Mapped 45-minute World War I baseline…'`

**FLAKY**, 2/3 passed, 1 assertion/semantic failures, 0 unavailable attempts. Passed 2/3 complete main runs; 1 semantic failure(s), 0 unavailable attempt(s). AssertionError: expected [ 'Activities fit the learning task' ] to deeply equal [] - Expected + Received - [] + [ + "Activities fit the learning task", + ]

- [run 1](evidence/baseline-1/session-quality.txt) — **PASS**: All existing assertions passed.
- [run 2](evidence/baseline-2/session-quality.txt) — **FAIL**: AssertionError: expected [ 'Activities fit the learning task' ] to deeply equal []  - Expected + Received  - [] + [ +   "Activities fit the learning task", + ]
- [run 3](evidence/baseline-3/session-quality.txt) — **PASS**: All existing assertions passed.

<a id="a26"></a>

### A26 — Calculus repair after a weak check

`src/evals/session-quality.live.test.ts` — `live OpenAI session quality > 'Calculus repair after a weak check'`

**FLAKY**, 1/3 passed, 2 assertion/semantic failures, 0 unavailable attempts. Passed 1/3 complete main runs; 2 semantic failure(s), 0 unavailable attempt(s). SessionGenerationFailure: OpenAI did not return a complete subject lesson after one repair attempt.

- [run 1](evidence/baseline-1/session-quality.txt) — **FAIL**: SessionGenerationFailure: OpenAI did not return a complete subject lesson after one repair attempt.
- [run 2](evidence/baseline-2/session-quality.txt) — **FAIL**: SessionGenerationFailure: OpenAI did not return a complete subject lesson after one repair attempt.
- [run 3](evidence/baseline-3/session-quality.txt) — **PASS**: All existing assertions passed.

<a id="a27"></a>

### A27 — Beginner JavaScript with fading support

`src/evals/session-quality.live.test.ts` — `live OpenAI session quality > 'Beginner JavaScript with fading suppo…'`

**REAL**, 0/3 passed, 3 assertion/semantic failures, 0 unavailable attempts. SessionGenerationFailure: OpenAI did not return a complete streamed teaching skeleton after 1 repair attempt. The compact teaching recovery could not be finalized inside the authoritative session scope (streamed_target_assignment_duplicate:other). Stage: finalize.

- [run 1](evidence/baseline-1/session-quality.txt) — **FAIL**: SessionGenerationFailure: OpenAI did not return a complete streamed teaching skeleton after 1 repair attempt. The compact teaching recovery could not be finalized inside the authoritative session scope (streamed_target_assignment_duplicate:other). Stage: finalize.
- [run 2](evidence/baseline-2/session-quality.txt) — **FAIL**: SessionGenerationFailure: OpenAI did not return a complete streamed teaching skeleton after 1 repair attempt. The compact teaching recovery could not be finalized inside the authoritative session scope (streamed_target_assignment_duplicate:other). Stage: finalize.
- [run 3](evidence/baseline-3/session-quality.txt) — **FAIL**: SessionGenerationFailure: OpenAI did not return a complete streamed teaching skeleton after 1 repair attempt. The compact teaching recovery could not be finalized inside the authoritative session scope (streamed_target_assignment_duplicate:other). Stage: finalize.

<a id="a28"></a>

### A28 — General-learning finance application

`src/evals/session-quality.live.test.ts` — `live OpenAI session quality > 'General-learning finance application'`

**STALE**, 0/3 passed, 3 assertion/semantic failures, 0 unavailable attempts. The old 4/5 activity cap predates the method-aware Learn budget and recognition phase in b8f5e102 (Sep 1).

- [run 1](evidence/baseline-1/session-quality.txt) — **FAIL**: AssertionError: expected [ 'Activity count fits the session' ] to deeply equal []  - Expected + Received  - [] + [ +   "Activity count fits the session", + ]
- [run 2](evidence/baseline-2/session-quality.txt) — **FAIL**: AssertionError: expected [ 'Activity count fits the session' ] to deeply equal []  - Expected + Received  - [] + [ +   "Activity count fits the session", + ]
- [run 3](evidence/baseline-3/session-quality.txt) — **FAIL**: AssertionError: expected [ 'Activity count fits the session' ] to deeply equal []  - Expected + Received  - [] + [ +   "Activity count fits the session", + ]

<a id="a29"></a>

### A29 — Startup funding foundations for a new learner

`src/evals/session-quality.live.test.ts` — `live OpenAI session quality > 'Startup funding foundations for a new…'`

**STALE**, 0/3 passed, 3 assertion/semantic failures, 0 unavailable attempts. The old 4/5 activity cap predates the method-aware Learn budget and recognition phase in b8f5e102 (Sep 1).

- [run 1](evidence/baseline-1/session-quality.txt) — **FAIL**: AssertionError: expected [ 'Activity count fits the session' ] to deeply equal []  - Expected + Received  - [] + [ +   "Activity count fits the session", + ]
- [run 2](evidence/baseline-2/session-quality.txt) — **FAIL**: AssertionError: expected [ 'Activity count fits the session' ] to deeply equal []  - Expected + Received  - [] + [ +   "Activity count fits the session", + ]
- [run 3](evidence/baseline-3/session-quality.txt) — **FAIL**: AssertionError: expected [ 'Activity count fits the session' ] to deeply equal []  - Expected + Received  - [] + [ +   "Activity count fits the session", + ]

<a id="a30"></a>

### A30 — History reasoning from a primary-source excerpt

`src/evals/session-quality.live.test.ts` — `live OpenAI session quality > 'History reasoning from a primary-sour…'`

**REAL**, 0/3 passed, 3 assertion/semantic failures, 0 unavailable attempts. Generation refused the supplied material with “no readable explanatory source is mapped to the active target”; some attempts instead reached an obsolete rubric assertion.

- [run 1](evidence/baseline-1/session-quality.txt) — **FAIL**: SessionGenerationFailure: YOVA could not build a trustworthy session because no readable explanatory source is mapped to the active target. Attach or reprocess readable material, or review the session setup and choose a source-independent route.
- [run 2](evidence/baseline-2/session-quality.txt) — **FAIL**: SessionGenerationFailure: YOVA could not build a trustworthy session because no readable explanatory source is mapped to the active target. Attach or reprocess readable material, or review the session setup and choose a source-independent route.
- [run 3](evidence/baseline-3/session-quality.txt) — **FAIL**: SessionGenerationFailure: YOVA could not build a trustworthy session because no readable explanatory source is mapped to the active target. Attach or reprocess readable material, or review the session setup and choose a source-independent route.

<a id="a31"></a>

### A31 — Literature close reading from a short passage

`src/evals/session-quality.live.test.ts` — `live OpenAI session quality > 'Literature close reading from a short…'`

**REAL**, 0/3 passed, 3 assertion/semantic failures, 0 unavailable attempts. Generation refused the supplied material with “no readable explanatory source is mapped to the active target”; some attempts instead reached an obsolete rubric assertion.

- [run 1](evidence/baseline-1/session-quality.txt) — **FAIL**: SessionGenerationFailure: YOVA could not build a trustworthy session because no readable explanatory source is mapped to the active target. Attach or reprocess readable material, or review the session setup and choose a source-independent route.
- [run 2](evidence/baseline-2/session-quality.txt) — **FAIL**: SessionGenerationFailure: YOVA could not build a trustworthy session because no readable explanatory source is mapped to the active target. Attach or reprocess readable material, or review the session setup and choose a source-independent route.
- [run 3](evidence/baseline-3/session-quality.txt) — **FAIL**: SessionGenerationFailure: YOVA could not build a trustworthy session because no readable explanatory source is mapped to the active target. Attach or reprocess readable material, or review the session setup and choose a source-independent route.

<a id="a32"></a>

### A32 — Spanish conversation with supported transfer

`src/evals/session-quality.live.test.ts` — `live OpenAI session quality > 'Spanish conversation with supported t…'`

**REAL**, 0/3 passed, 3 assertion/semantic failures, 0 unavailable attempts. SessionGenerationFailure: OpenAI did not return a complete streamed teaching skeleton after 1 repair attempt. The compact teaching recovery could not be finalized inside the authoritative session scope (streamed_target_assignment_duplicate:other). Stage: finalize.

- [run 1](evidence/baseline-1/session-quality.txt) — **FAIL**: SessionGenerationFailure: OpenAI did not return a complete streamed teaching skeleton after 1 repair attempt. The compact teaching recovery could not be finalized inside the authoritative session scope (streamed_target_assignment_duplicate:other). Stage: finalize.
- [run 2](evidence/baseline-2/session-quality.txt) — **FAIL**: SessionGenerationFailure: OpenAI did not return a complete streamed teaching skeleton after 1 repair attempt. The compact teaching recovery could not be finalized inside the authoritative session scope (streamed_target_assignment_duplicate:other). Stage: finalize.
- [run 3](evidence/baseline-3/session-quality.txt) — **FAIL**: SessionGenerationFailure: OpenAI did not return a complete streamed teaching skeleton after 1 repair attempt. The compact teaching recovery could not be finalized inside the authoritative session scope (streamed_target_assignment_duplicate:other). Stage: finalize.

<a id="a33"></a>

### A33 — Teaching from a thin biology study guide

`src/evals/session-quality.live.test.ts` — `live OpenAI session quality > 'Teaching from a thin biology study gu…'`

**REAL**, 0/3 passed, 3 assertion/semantic failures, 0 unavailable attempts. Generation refused the supplied material with “no readable explanatory source is mapped to the active target”; some attempts instead reached an obsolete rubric assertion.

- [run 1](evidence/baseline-1/session-quality.txt) — **FAIL**: SessionGenerationFailure: YOVA could not build a trustworthy session because no readable explanatory source is mapped to the active target. Attach or reprocess readable material, or review the session setup and choose a source-independent route.
- [run 2](evidence/baseline-2/session-quality.txt) — **FAIL**: SessionGenerationFailure: YOVA could not build a trustworthy session because no readable explanatory source is mapped to the active target. Attach or reprocess readable material, or review the session setup and choose a source-independent route.
- [run 3](evidence/baseline-3/session-quality.txt) — **FAIL**: SessionGenerationFailure: YOVA could not build a trustworthy session because no readable explanatory source is mapped to the active target. Attach or reprocess readable material, or review the session setup and choose a source-independent route.

<a id="a34"></a>

### A34 — builds the production 15-minute two-target teaching skeleton

`src/evals/streamed-rayleigh.live.test.ts` — `live streamed Rayleigh-scattering session > builds the production 15-minute two-target teaching skeleton`

**STALE**, 0/3 passed, 3 assertion/semantic failures, 0 unavailable attempts. A 15-minute method-bounded slice keeps one active claim and explicitly defers the second topic; scope narrowing dates to c924f5d (Aug 23).

- [run 1](evidence/baseline-1/streamed-rayleigh.txt) — **FAIL**: AssertionError: expected [ Array(1) ] to have a length of 2 but got 1  - Expected + Received  - 2 + 1
- [run 2](evidence/baseline-2/streamed-rayleigh.txt) — **FAIL**: AssertionError: expected [ Array(1) ] to have a length of 2 but got 1  - Expected + Received  - 2 + 1
- [run 3](evidence/baseline-3/streamed-rayleigh.txt) — **FAIL**: AssertionError: expected [ Array(1) ] to have a length of 2 but got 1  - Expected + Received  - 2 + 1

<a id="a35"></a>

### A35 — delivers substantive teaching from the first generated lesson brief

`src/evals/streamed-world-war-one-lesson.live.test.ts` — `live streamed World War I lesson > delivers substantive teaching from the first generated lesson brief`

**REAL**, 0/3 passed, 3 assertion/semantic failures, 0 unavailable attempts. SessionGenerationFailure: OpenAI did not return a complete streamed teaching skeleton after 1 repair attempt. The compact teaching recovery could not be finalized inside the authoritative session scope (streamed_target_subject:other). Stage: draft.

- [run 1](evidence/baseline-1/streamed-world-war-one-lesson.txt) — **FAIL**: SessionGenerationFailure: OpenAI did not return a complete streamed teaching skeleton after 1 repair attempt. The compact teaching recovery could not be finalized inside the authoritative session scope (streamed_target_subject:other). Stage: draft.
- [run 2](evidence/baseline-2/streamed-world-war-one-lesson.txt) — **FAIL**: AssertionError: expected '# European Alliance Blocs Before 1914…' to match /Sarajevo\|Franz Ferdinand/i  - Expected: /Sarajevo\|Franz Ferdinand/i  + Received: "# European Alliance Blocs Before 1914  Before the First World War, Europe was divided into two rival alliance blocs. These alliances did not automatically make war inevitable, but they increased mistrust and created the danger that a dispute involving a few countries could draw in several others.  ## The two blocs  The **Triple Alliance** consisted of:  - Germany - Austria-Hungary - Italy  The **Triple Entente** linked:  - Britain - France - Russia  An alliance was an agreement to support another state under particular conditions, especially if it was attacked. Meanwhile, competition over military strength, territory, and influence produced tension between the blocs. Governments prepared for the possibility of war because they feared their rivals were doing the same.  This created a dangerous chain: rivalry encouraged military preparation, preparation increased suspicion, and suspicion made further preparation seem necessary. Europe therefore became divided into armed, distrustful groups before 1914.  ## An important boundary  A common mix-up is to treat the alliances as two perfectly fixed teams whose members were automatically required to fight in every conflict. In reality, alliance commitments had specific conditions, and governments still made decisions when war began. Italy, although a member of the Triple Alliance, did not enter the war alongside Germany and Austria-Hungary in 1914.  The key causal idea is not simply that alliances existed. It is that rival alliances connected European powers, so a local crisis had the potential to expand into a much wider war."
- [run 3](evidence/baseline-3/streamed-world-war-one-lesson.txt) — **FAIL**: SessionGenerationFailure: OpenAI did not return a complete streamed teaching skeleton after 1 repair attempt. The compact teaching recovery could not be finalized inside the authoritative session scope (streamed_target_subject:other). Stage: draft.

<a id="a36"></a>

### A36 — creates the production 45-minute streamed teaching session

`src/evals/streamed-world-war-one-skeleton.live.test.ts` — `live exact World War I baseline skeleton > creates the production 45-minute streamed teaching session`

**REAL**, 0/3 passed, 3 assertion/semantic failures, 0 unavailable attempts. SessionGenerationFailure: OpenAI did not return a complete streamed teaching skeleton after 1 repair attempt. The compact teaching recovery could not be finalized inside the authoritative session scope (streamed_target_subject:other). Stage: draft.

- [run 1](evidence/baseline-1/streamed-world-war-one-skeleton.txt) — **FAIL**: AssertionError: expected [ { …(16) }, { …(16) } ] to have a length of 3 but got 2  - Expected + Received  - 3 + 2
- [run 2](evidence/baseline-2/streamed-world-war-one-skeleton.txt) — **FAIL**: AssertionError: expected [ { …(16) }, { …(16) } ] to have a length of 3 but got 2  - Expected + Received  - 3 + 2
- [run 3](evidence/baseline-3/streamed-world-war-one-skeleton.txt) — **FAIL**: SessionGenerationFailure: OpenAI did not return a complete streamed teaching skeleton after 1 repair attempt. The compact teaching recovery could not be finalized inside the authoritative session scope (streamed_target_subject:other). Stage: draft.

<a id="a37"></a>

### A37 — a live-generated deadline lesson streams, finishes unrated and preserves completion on reload

`e2e/plan-launch-live.spec.ts` — `a live-generated deadline lesson streams, finishes unrated and preserves completion on reload` — desktop-chromium

**FLAKY**, 2/3 passed, 1 assertion/semantic failures, 0 unavailable attempts. Passed 2/3 complete main runs; 1 semantic failure(s), 0 unavailable attempt(s). TimeoutError: locator.click: Timeout 60000ms exceeded. Call log:  - waiting for getByRole('button', { name: 'I got the key idea', exact: true })

- [run 1](evidence/baseline-1/browser.txt) — **PASS**: All existing assertions passed.
- [run 2](evidence/baseline-2/browser.txt) — **PASS**: All existing assertions passed.
- [run 3](evidence/baseline-3/browser.txt) — **FAIL**: TimeoutError: locator.click: Timeout 60000ms exceeded. Call log:   - waiting for getByRole('button', { name: 'I got the key idea', exact: true })

<a id="a38"></a>

### A38 — a live-generated deadline lesson streams, finishes unrated and preserves completion on reload

`e2e/plan-launch-live.spec.ts` — `a live-generated deadline lesson streams, finishes unrated and preserves completion on reload` — mobile-chromium

**FLAKY**, 2/3 passed, 1 assertion/semantic failures, 0 unavailable attempts. Passed 2/3 complete main runs; 1 semantic failure(s), 0 unavailable attempt(s). TimeoutError: locator.click: Timeout 60000ms exceeded. Call log:  - waiting for getByRole('button', { name: 'I got the key idea', exact: true })

- [run 1](evidence/baseline-1/browser.txt) — **PASS**: All existing assertions passed.
- [run 2](evidence/baseline-2/browser.txt) — **PASS**: All existing assertions passed.
- [run 3](evidence/baseline-3/browser.txt) — **FAIL**: TimeoutError: locator.click: Timeout 60000ms exceeded. Call log:   - waiting for getByRole('button', { name: 'I got the key idea', exact: true })

<a id="x01"></a>

### X01 — streams the validated calculus teaching

`src/evals/launch-lesson-streams.live.test.ts` — `launch lesson delivery > streams the validated calculus teaching`

**UNAVAILABLE**, 2/3 passed, 0 assertion/semantic failures, 1 unavailable attempts. 1/3 attempts unavailable; 2/3 passed. No semantic failure observed.

- [run 1](evidence/baseline-1/launch-lesson-streams.txt) — **UNAVAILABLE**: Fresh producer fixture missing; producer result is reported separately
- [run 2](evidence/baseline-2/launch-lesson-streams.txt) — **PASS**: All existing assertions passed.
- [run 3](evidence/baseline-3/launch-lesson-streams.txt) — **PASS**: All existing assertions passed.

<a id="x02"></a>

### X02 — calculus

`src/evals/launch-session-journeys.live.test.ts` — `launch session journeys with committed recipes > 'calculus'`

**FLAKY**, 2/3 passed, 1 assertion/semantic failures, 0 unavailable attempts. Passed 2/3 complete main runs; 1 semantic failure(s), 0 unavailable attempt(s). SessionGenerationFailure: OpenAI did not return a complete streamed teaching skeleton after 1 repair attempt. The compact teaching recovery did not match its bounded content schema.

- [run 1](evidence/baseline-1/launch-session-journeys.txt) — **FAIL**: SessionGenerationFailure: OpenAI did not return a complete streamed teaching skeleton after 1 repair attempt. The compact teaching recovery did not match its bounded content schema.
- [run 2](evidence/baseline-2/launch-session-journeys.txt) — **PASS**: All existing assertions passed.
- [run 3](evidence/baseline-3/launch-session-journeys.txt) — **PASS**: All existing assertions passed.

<a id="x03"></a>

### X03 — generates from a material map and reports latency

`src/lib/diagnostics/map-diagnostic.live.test.ts` — `live map diagnostic generation > generates from a material map and reports latency`

**FLAKY**, 1/3 passed, 1 assertion/semantic failures, 1 unavailable attempts. Passed 1/3 complete main runs; 1 semantic failure(s), 1 unavailable attempt(s). MapDiagnosticGenerationError: The placement check did not cover its assigned questions safely.

- [run 1](evidence/baseline-1/map-diagnostic.txt) — **UNAVAILABLE**: Provider request timed out (cause recorded in suite log)
- [run 2](evidence/baseline-2/map-diagnostic.txt) — **PASS**: All existing assertions passed.
- [run 3](evidence/baseline-3/map-diagnostic.txt) — **FAIL**: MapDiagnosticGenerationError: The placement check did not cover its assigned questions safely.

<a id="x04"></a>

### X04 — generates from a ai_generated map and reports latency

`src/lib/diagnostics/map-diagnostic.live.test.ts` — `live map diagnostic generation > generates from a ai_generated map and reports latency`

**FLAKY**, 2/3 passed, 1 assertion/semantic failures, 0 unavailable attempts. Passed 2/3 complete main runs; 1 semantic failure(s), 0 unavailable attempt(s). MapDiagnosticGenerationError: The placement check did not cover its assigned questions safely.

- [run 1](evidence/baseline-1/map-diagnostic.txt) — **FAIL**: MapDiagnosticGenerationError: The placement check did not cover its assigned questions safely.
- [run 2](evidence/baseline-2/map-diagnostic.txt) — **PASS**: All existing assertions passed.
- [run 3](evidence/baseline-3/map-diagnostic.txt) — **PASS**: All existing assertions passed.

<a id="x05"></a>

### X05 — keeps two current targets and defers the third in a 15-minute window

`src/evals/material-osmosis-session.live.test.ts` — `live shortened material-backed osmosis session > keeps two current targets and defers the third in a 15-minute window`

**FLAKY**, 2/3 passed, 1 assertion/semantic failures, 0 unavailable attempts. Passed 2/3 complete main runs; 1 semantic failure(s), 0 unavailable attempt(s). SessionGenerationFailure: YOVA could not build a safe degraded session for this setup. Review the session setup or choose a source-independent route.

- [run 1](evidence/baseline-1/material-osmosis-session.txt) — **FAIL**: SessionGenerationFailure: YOVA could not build a safe degraded session for this setup. Review the session setup or choose a source-independent route.
- [run 2](evidence/baseline-2/material-osmosis-session.txt) — **PASS**: All existing assertions passed.
- [run 3](evidence/baseline-3/material-osmosis-session.txt) — **PASS**: All existing assertions passed.

<a id="x06"></a>

### X06 — builds a topic-specific teaching skeleton

`src/evals/streamed-ap-biology.live.test.ts` — `live streamed AP Biology session > builds a topic-specific teaching skeleton`

**REAL**, 0/3 passed, 3 assertion/semantic failures, 0 unavailable attempts. The initial and compact recovery path ended in streamed_target_subject:other before a usable skeleton was returned.

- [run 1](evidence/baseline-1/streamed-ap-biology.txt) — **FAIL**: SessionGenerationFailure: OpenAI did not return a complete streamed teaching skeleton after 1 repair attempt. The compact teaching recovery could not be finalized inside the authoritative session scope (streamed_target_subject:other). Stage: finalize.
- [run 2](evidence/baseline-2/streamed-ap-biology.txt) — **FAIL**: SessionGenerationFailure: OpenAI did not return a complete streamed teaching skeleton after 1 repair attempt. The compact teaching recovery could not be finalized inside the authoritative session scope (streamed_target_subject:other). Stage: finalize.
- [run 3](evidence/baseline-3/streamed-ap-biology.txt) — **FAIL**: SessionGenerationFailure: OpenAI did not return a complete streamed teaching skeleton after 1 repair attempt. The compact teaching recovery could not be finalized inside the authoritative session scope (streamed_target_subject:other). Stage: finalize.

<a id="x07"></a>

### X07 — explains every glycolysis product before accepting a learner's paraphrase

`src/evals/teaching-assessment-contract.live.test.ts` — `live teaching and assessment alignment > explains every glycolysis product before accepting a learner's paraphrase`

**FLAKY**, 2/3 passed, 1 assertion/semantic failures, 0 unavailable attempts. Passed 2/3 complete main runs; 1 semantic failure(s), 0 unavailable attempt(s). AssertionError: expected '# Glycolysis: From Glucose to Pyruvat…' to match /electron|carrier|reducing/i - Expected: /electron|carrier|reducing/i + Received: "# Glycolysis: From Glucose to Pyruvate Glycolysis breaks one g

- [run 1](evidence/baseline-1/teaching-assessment-contract.txt) — **PASS**: All existing assertions passed.
- [run 2](evidence/baseline-2/teaching-assessment-contract.txt) — **PASS**: All existing assertions passed.
- [run 3](evidence/baseline-3/teaching-assessment-contract.txt) — **FAIL**: AssertionError: expected '# Glycolysis: From Glucose to Pyruvat…' to match /electron\|carrier\|reducing/i  - Expected: /electron\|carrier\|reducing/i  + Received: "# Glycolysis: From Glucose to Pyruvate  Glycolysis breaks one glucose molecule into two smaller molecules called **pyruvate**. The word helps describe the process: “glyco” refers to sugar, while “lysis” means splitting.  ## Follow one glucose molecule  1. **One glucose enters glycolysis.** 2. Its six-carbon structure is rearranged and split. 3. The process finishes with **two pyruvate molecules**. 4. Energy released during these reactions is captured as **ATP** and **NADH**.  For every glucose molecule, glycolysis produces:  - **2 pyruvate** - **2 NADH** - a **net gain of 2 ATP**  NADH is an energy-carrying molecule, so glycolysis stores some released energy in NADH as well as ATP.  ## Why ATP is described as “net”  Glycolysis makes ATP, but it also requires some ATP during its early reactions. Therefore, the total ATP produced is not the same as the final gain. After subtracting the ATP used from the ATP produced, the cell gains **2 ATP overall**.  A common mix-up is to call all ATP formed during glycolysis the net yield. **Net ATP** means the amount left after accounting for ATP spent. The complete output per glucose is therefore two pyruvate, two NADH, and a net two ATP."
