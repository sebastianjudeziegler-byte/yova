# Session runtime implementation evidence

Date: 17 September 2026. Implementation checkout: `/private/tmp/yova-plan-and-session-launch`. These are branch changes, not a deployment claim.

## Implemented

- **S2, durable input:** explanation text, stable map identities/relationships and repair drafts live in checkpointed Shape A state. Input events write the next draft synchronously, including the last keystroke before Exit. Generated content, original/revised comparisons, MCQ state and timer controls remain in the same account/session checkpoint. Exit/pagehide flush elapsed time. Failed browser storage produces an honest warning without discarding the in-memory session. The completion owner retires checkpoints only after its durable completion save.
- **S4, bounded recheck:** submitting a correction remains on Repair while the existing comparison endpoint assesses it. The request carries the original production, original feedback, source references and corrected production separately. A successful response closes further correction submissions; unresolved gaps remain visible. A transport error retains the correction and offers retry or continuation marked unchecked. Reloading an interrupted request recovers as unchecked, not as a permanent spinner. Original feedback is not overwritten by revised feedback. This is formative feedback; no client-declared learning evidence is added.
- **S5, guided map:** native text inputs and selects create up to 12 concepts and 18 labelled links. IDs survive renaming; deleting a concept removes connected links and announces the consequence. A fixed SVG grid and numbered relationship list provide a visual and keyboard/phone path without a graph dependency or generated layout. Comparison feedback can target existing item IDs; unknown targets are dropped. Original and revised maps have distinct labels and views.
- **S3, truthful personalization:** learner method preferences, the effective route and actual question/example/retry history determine visible claims. An overridden try-first rule or absent practice no longer supplies tips/receipt claims. Generated tip instructions remain, but their personalization reason is drawn from the applicable code-owned rule evidence. Profile reasons, timer/count effects, contrasting entry methods and instruction support remain visible. Timer nudges respect the extra-reading-time flag; frequent-check-in routing displays an explicit stopping point. A skipped example is described as not shown, not as material that never existed.
- **S8, recovery/outcomes:** comparison transport failure has an explicit state-machine continuation. At a retry ceiling, only outstanding tested points are marked for review; previously passed points retain their result. Untested points produce no outcome. Key points preserve their source topic through interleaved/mixed-topic practice and completion. Unknown mixed origins are not silently attributed to the first topic. Escalation promises no unavailable different method.
- **Shared Brief 2 contract:** the session uses `applyTopicWorkloadToRoute` and persisted workload counts/minutes. Shape A runs the planned MCQs after production/feedback only when that workload exists. The hub shows the common total, real source-reading allocation and planned question count rather than invented per-step time splits. Scope/goal/count changes alter the checkpoint content fingerprint; an unchanged refresh keeps it stable. Practice-test requests carry `workloadBounded` so a legacy eight-question override cannot replace the planned work.
- **Source/target continuity:** generation receives the original plan learning goal, selected subtopics and only workload-selected related topics. Sources are interleaved within the existing eight-excerpt cap and retain topic labels. Scope-outline-only material does not route learners into an empty source-reading screen. Procedural production displays the specific unsolved problem; its reference solution is only sent to comparison, not displayed before submission.
  The generated problem travels in the bounded `reference.practiceProblem` field, separate from uploaded source excerpts. Owner-scoped server hydration replaces posted excerpts without discarding the problem needed to assess the learner's solution.
- **Optional continuation:** after a clean finish within the persisted session allowance, the learner can finish or explicitly save and start the next eligible existing activity. Prerequisites must be satisfied. Practice and fixed-date learning must be due; only a learning block with a suggested date can be chosen early. Queue order is preserved. No new planner, automatic hard-mode inference or early pulling-forward of spaced practice was added. Completion saves before navigation.

## Red → green evidence

`src/lib/session-shapes/session-quality.test.ts` was run against the unmodified behavior before implementation: **5 failed**. It reproduced comparison continuation staying at Compare, repair submission jumping directly to End, no unresolved revised assessment, false try-first history after retrieval overrides, and practice claims in a writing-only session. All five pass after implementation.

`src/lib/routing/route-for-session.test.ts` gained the outline-only source case before its routing change: **1 failed / 12 passed**, because `hasSource` was true. After using the same actual source context as the session: **13 passed**.

The following scoped run after implementation passed **17 files / 115 tests**:

```
pnpm exec vitest run src/lib/session-shapes \
  src/lib/routing/route-for-session.test.ts \
  src/lib/routing/rule-evidence.test.ts \
  src/lib/routing/personalization-note.test.ts \
  src/lib/routing/personalization-delta.test.ts \
  src/lib/routing/rule-visibility.test.ts \
  src/components/baseline-session.integration.test.ts \
  src/components/guided-concept-map.test.ts
```

This includes real component rendering from restored checkpoints, original/revised map and correction UI, transport timeout/cancellation, stable graph identity and source provenance, retry-ceiling outcomes, exact input/timer serialization, optional continuation and the permanent contrasting-profile delta. The large route-space visibility gate now checks effective and observed actions rather than requiring unsupported claims for every internally fired rule. It still verifies profile-driven method differences and traceability.

Scoped ESLint for the runtime, map, session-shapes, routing source/evidence and the affected browser tests passed with no output. Whole-project typecheck/full unit and CI results are owned by the combined execution ledger, since other implementation files were being edited concurrently.

The final comparison-context integration was checked separately with `shape-slot-context.test.ts`, `baseline-session.integration.test.ts` and `slots-client.test.ts`: **3 files / 10 tests passed**. The new server test proves that the generated procedural problem survives authorized hydration while a forged uploaded excerpt is removed. ESLint passed for those changed runtime/schema/test files.

A subsequent independent generator review found that concurrent question batches could repeat each other's prompts. Three regression cases failed before the fix. Generation now rejects duplicates within an individual batch and, after assembly, makes one bounded correction phase for only the repeated slots. Accepted prompts, original key points and the same explanation/source context accompany each correction. Calls remain at most eight questions and use the original provider's shared 50-second deadline. A code-owned variation angle distinguishes parallel batches without changing task types or subjects. Repeated collisions after that phase produce the existing honest error. The full generator file passed **46 tests**, including repair for both lesson/practice paths, repeated-collision refusal and the 32-question maximum with 24 replacement slots in three bounded calls. Scoped generator ESLint passed. Exact prompt checks do not establish semantic diversity; live output inspection is still required.

The final S2–S8 scope review reproduced two additional integration defects before fixing them: interleaved evidence from a related topic outside the session's primary topic was relabelled as primary (**2 failing provenance cases**), and server hydration expanded selected related subtopics beyond the workload (**2 failing scope cases**). Completion now validates supplied origins against plan topics and the executed workload/interleaved set; an invalid supplied origin never falls back to primary. Only a missing legacy origin can use the single-topic fallback. Hydration reads the owner-scoped session's persisted workload and uses its topic/subtopic slices as authoritative; legacy selections intersect the accepted map. Posted extra topics cannot broaden a persisted workload. Topic counts, generation modifiers and the procedural problem remain preserved. The context, handler and continuation suites pass **3 files / 20 tests**; scoped ESLint passes.

The receipt now says YOVA **offered** an explicit stopping point, matching the optional pause prompt. Optional continuation uses the workload's ceiling for the offer, not the smaller estimate of the just-completed block. For example, a 33-minute block completed in 35 minutes can offer the next queued learning block inside a 60-minute allowance. The learner must opt in; no work is automatically appended. Future practice, fixed-date learning, unmet prerequisites and skipping over the next queued item remain blocked. Three regression cases failed before these changes; the combined receipt/continuation/component suites pass **3 files / 21 tests**, with scoped ESLint passing. This does not claim every single memorization block fills a 60-minute allowance; the 32-question ceiling remains bounded and visible.

## Browser evidence prepared; execution not asserted here

`e2e/baseline-session-launch.spec.ts` retains successful videos and has two named transport-fixture journeys:

1. **guided map preserves the last keystroke and original/revised provenance across retry and reload** — immediate Exit after the final keystroke; exact map restoration; correction transport failure; correction restoration and retry; original versus revised map feedback. It attaches a timestamped journey index identifying fixture dependencies.
2. **comparison transport failure can continue without claiming feedback** — the learner advances to actual planned practice or an end screen explicitly saying feedback was unavailable.

The map selectors in existing baseline tests now use endpoint selects. The live contrasting-profile test keeps the real model route, captures generated questions for inspection, and handles planned practice after Shape A. Its deterministic answer-key path proves runtime completion, not student learning or question difficulty.

No browser suite or live gate was run by this implementation agent. The root agent owns the single focused local browser case and CI recordings. Do not label a video or browser result as passing until its actual output has been inspected.

## Limits and review follow-ups

- Unit/transport fixtures do not establish that the model correctly judges the audit's osmosis or product-rule corrections. The combined live suite must retain those actual outputs.
- The visual map uses bounded deterministic layout; dense maps can contain crossing arrows, with the labelled relationship list as the accessible reference. It is deliberately not a free-form graph editor.
- Draft persistence is scoped to the current browser/account. It is not cross-device draft sync. Original/revised work stays in the checkpoint until confirmed completion; the existing completion record stores the resulting gap summary, not a new full answer-history schema.
- No claim of zero future model/network failures or established learner retention is made. The work supplies bounded requests, recoverable state and honest outcomes.
- No application merge, deployment or deletion of old plans was performed. A proposed broad legacy-plan start guard was rejected by automatic approval review because it could disrupt existing plans without migration authorization. That guard was not applied; the parent chose the safe compatibility path, keeping existing legacy sessions usable.
- The founder explicitly deferred Undo. It was not a prerequisite and was not implemented here.
