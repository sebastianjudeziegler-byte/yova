# Brief 0.5 — grader calibration and first-session validation

## Root-cause record, before product changes

Recorded 2026-09-09 while the checkout is detached at main `e03a082659f51172c0b06bf84daffdd5599ac773`. No product source has been changed. The requested branch `codex/brief-0-5-grader-and-validators` was created from Brief 0's `d108e890e3f64e4393f617fe821ac0eb3b7b3c8e`, whose `src/lib` is identical to this main. It inherits the full gate and corrected stale expectations; the PR will be stacked on Brief 0 while that dependency remains unmerged. No merge or production setting change is authorized here.

The two areas in the brief contain one grader cause and **three validator/recovery causes**, not ten independent case-specific defects. The observations below come from fresh, serial calls using the existing local environment and provider key. Test-only pass-through instrumentation records synthetic provider inputs, parsed responses, rejected subject comparisons, and bounded recovery errors. It does not alter returned content, validation, retries, timing limits, or model configuration.

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

## Baseline and final verification

In progress. Record every attempt, including passes and provider unavailability; never manufacture three red attempts by selecting only failures. The prior Brief 0 baseline and this fresh three-run baseline are separate evidence sets. A provider timeout is neither red nor green.

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
