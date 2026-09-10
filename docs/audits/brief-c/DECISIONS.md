# Brief C — approved founder decisions

Status: approved by the founder on September 10, 2026, with the conditions below. Implementation begins only after Brief B PR #85 is merged and this branch is rebased onto the resulting main. All verification runs in GitHub Actions.

## A17: first block for a broad calculus goal

Approved: use the first prerequisite-ready, unlearned topic already assigned by the plan. Introduce where it fits in the calculus pathway, then teach that bounded objective using its source (or an AI explanation when no source exists), provide a worked example when the profile calls for one, and finish with a small practice check. Assess the block against that objective, not against coverage of limits, derivatives, and integrals in one sitting.

For the existing A17 fixture, the learner is starting with basic algebra/functions, wants an overall map and an example before guided practice, and prefers 30 minutes. A brief pathway orientation can meet the map preference without turning the first block into a whole-course survey. This does not reorder the plan or change Brief B's revision pipeline.

Tradeoff: a bounded first block provides usable practice and interpretable evidence, but postpones the broad survey. An overview-first block would make the destination more visible, but offer less practice on one teachable objective. Changing which topic the plan assigns would require separate approval to touch the revision pipeline.

Evidence: `docs/audits/BACKLOG.md` A17 records a task-family alignment failure after obsolete expectations were corrected; later samples passed intermittently. The historical failure did not preserve a full activity dump, so it does not by itself establish which learner-facing behavior should change. `src/evals/plan-cases.ts` defines the broad calculus fixture.

## Block validators

Approved with conditions: keep deterministic structural checks, including topic binding, distinct choices, deferred-topic exclusion, and evidence authority. Also retain source ownership, usable section references, schema, rendering limits, and required completion steps. Validate generated practice against the selected source section (or scoped AI explanation) for correctness, answerability, ambiguity, and alignment with exactly one bounded semantic provider call per block. Cache the judgment with the block, never call it per attempt. A semantic failure uses existing recovery with no retry loop or automatic item regeneration. An unavailable review is unavailable, not proof of quality or learning. Every Brief 0.5 negative test must stay green.

| Activity kind | Semantic contract to check | Surface checks to stop using as evidence of quality |
| --- | --- | --- |
| `watch_source_section` | The authorized usable source has a valid, bounded section relevant to the assigned topic. Its practice is supported by that section. Watched status records source completion only. | Requiring generated lesson prose, a minimum word count, or learning evidence from a watched flag. |
| `read_source_section` | The authorized usable source has relevant pages/chunks and enough information for the ensuing check. Read status records source completion only. | Exact topic-title wording and lesson-style word/sentence quotas. |
| `ai_explanation` | The explanation is accurate, stays within assigned scope, and teaches the knowledge needed for its check. It must not introduce deferred or unrelated topics as required knowledge. | Keyword-overlap thresholds, mandatory prose headings, minimum sentence lengths, and notation/symbol restrictions used as correctness proxies. |
| `flashcards` | Each front asks one clear retrieval question; its supported answer accepts equivalent wording. The front does not disclose the answer or paste a source paragraph. | Exact quote matching, minimum answer lengths, and treating repeated concepts as automatically duplicate cards. |
| `quiz` | An MCQ has one defensible answer with non-equivalent distractors; a short answer has an explicit semantic rubric accepting correct paraphrases. Questions are answerable from the section, and feedback explains the misconception. | Shared keywords as a correctness score, task-family vocabulary requirements, and cosmetic option differences as proof of distinct answers. |
| `problems` | Givens, units, and constraints make the problem well posed; the source supports the method; solution steps and the result are valid. Equivalent approaches are accepted. Use deterministic calculation checks where applicable. | Exact solution wording/notation, symbol bans, and answer length as a proxy for completeness. |

Cross-kind protections remain: reject genuinely off-topic or deferred-topic work, unsupported answers, ambiguous options, and true duplicates. A true duplicate repeats the same learner action and reasoning without a new distinction; using the same concept in a different legitimate check is not enough to reject it. Preserve and extend the photosynthesis, deferred-ATP-use, equivalent-option, and duplicate negative cases.

Tradeoff: semantic review adds provider cost and preparation latency and can still make mistakes. Saving reviewed sets avoids repeating that cost during play/resume. Deterministic checks retain authority and safety boundaries; semantic judgments replace wording proxies, not those boundaries. Keep legacy no-source compatibility covered by its permanent canaries while introducing block-specific contracts.

## Source-first and the personalization delta

The literal requirements conflict for two unlearned profiles with the same PDF: both must start with `read_source_section`, yet the delta asks for different first activity kinds.

Approved: both start with the same source section. Compare the first **practice** activity after that shared step; P1 and P2 must differ on at least three of activity kind, worked-example presence, hints available, and set size. The source-first invariant remains unconditional. Post-block receipts must also differ and reference the saved profile as specified in Brief C.

## Boundary

Brief C changes runtime block contents, cached resources, checkpoints, practice results, and the runtime UI. It does not change map-delta handling, plan composition, session scheduling, or Brief B's revision pipeline. If implementation requires changing that pipeline, stop and request authorization with the concrete change.
