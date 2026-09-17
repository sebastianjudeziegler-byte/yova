# YOVA deployed-session audit — handoff for Claude

**Date:** 17 September 2026. **Target:** https://www.yovaapp.com/. **Reviewed and tested release:** `b75ec8d3da25695e6b008aa3e5f82855d415298e`. **Scope:** shipped Brief 1 / 1.5 sessions; Brief 2 is explicitly excluded as an implementation requirement.

## Release and test provenance

GitHub main was read live. PR #92 was merged as `e44b03d588a8e71c7cf303fcfaa30857522ae7f5` on 17 September at 09:59:21 UTC. Main's subsequent `b75ec8d` change replaces Brief 2 specification documents; it does not implement Brief 2. GitHub's successful Vercel status for that SHA names deployment `GxijDPgEkxpXbfsPQK8arPnWmv8Q`. Uncached HTML served by the production domain contains that exact deployment ID. See [deployment-verification.md](deployment-verification.md) for the full chain and headers.

**Release changed during the write-up:** PR #94's narrow plan-Undo fix merged at 13:20:40 UTC and deployed as `eeb1ff9745d57efd55656ff24128e2a30ca7c626` / `126d3npDKpj87HMWRYhcRAWH4oC1`. A complete GitHub comparison confirmed no changes to the session runtime, routing, generation, grading or completion code reviewed here. The four journeys were not rerun on the new deployment; all source anchors remain pinned to `b75ec8d`. This was not the Brief 2 plan rewrite.

The local working checkout is a dirty, different development branch. All implementation findings below were read from the exact merged commit with `git show`; do not use current working-tree line numbers as the reviewed release. No application code, deployment, production configuration, database schema, or existing project files were changed by this audit.

Testing used the real production UI, live model generation and existing signed-in release-test account “Plan Learner” (`yova-plan-release-1788794072967@example.com`). Four fresh Study Now journeys used contrasting profile settings on that one account. No mocked responses or forced network failures. A began in a narrow viewport; the remaining tests used 1440×1000 to evaluate the shipped desktop layout. This is not a full mobile audit, a new-account onboarding audit, a clean two-user randomized comparison, or a learning-retention study.

## Assessment

**The basic session machinery works, but this sample does not yet support relying on YOVA for substantial exam practice.** Specific misconception feedback and focused retries are useful. The available work is often shallow, the map interface is cumbersome, repairs are not checked, and some personalization claims describe actions that never happened. These are separate from the unfinished plan-generation work.

Do not fix underfilled sessions by forcing time to elapse or adding arbitrary repetitions. Give the learner an honest description of a short check, appropriate challenge, and useful next work. Coordinate duration/queue changes with Brief 2 rather than introducing a competing composer.

## Live journey results

| Journey | Actual route and observations | End state |
|---|---|---|
| A: A-level biology, supported learner | Short profile, mapping preference, example first. Real example shown; map source hidden; accurate feedback on reversed osmosis. Exit/resume erased all six draft values. Incorrect repair accepted without assessment. | Reached end. Two Finish attempts timed out; later list showed 0/1. |
| B: same broad biology goal, independent learner | Long profile, questions, detail-oriented, try-first. 55-minute timer; short explanation; five MCQs with 1 recall / 1 application / 2 comparisons / 1 misconception. One intentional miss generated one successful targeted retry. Try-first claim was false. | Reached end at timer 5:23; 5/6 correct across two rounds. Finish timed out; later list showed 0/1. |
| C: A-level product-rule request | Legacy plan chose conceptual foundations/Feynman. Try-first genuinely worked. Correctly identified multiplication-of-derivatives error. Correct revised solution not assessed; original error counts remained. A tip claimed a comparison question despite no question round. | Saved successfully; Recent showed 1/1 and Goal completed. |
| D: GCSE photosynthesis notes, outside YOVA | Uploaded synthetic TXT accepted. Directions referred to the file; return went straight to five source-grounded MCQs. Short/gist profile produced 2 recall / 1 application / 1 comparison / 1 misconception. All five correct options were first. Pause/+5/hide/show worked. | Clean 5/5 round reached end at 3:46/15:00. Initial Finish and one retry failed. |

Times are the app's timer during automated interaction, including inspection/generation delays. They are not measured student completion times. A/B used the same goal prompt but the legacy planner generated different first topics, so content differences alone cannot prove personalization. Profile effects are corroborated by route code and visible behaviors.

## Reproduced bugs and trust failures

### 1. Completion sometimes fails to confirm — P1 investigation

**Reproduction:** complete a normal session and click Finish. A (map), B (recall), and D (source-based recall) displayed “YOVA could not save this session. Your work is still on screen; try again.” A and D each failed again on one retry. Leaving displayed a cloud-sync warning. Final reload→Learning→Recent showed A/B/D 0/1 and C 1/1 completed.

Console recorded `YOVA session completion sync failed [client:deadline]` at 12:21:16.141Z, 12:21:43.056Z, 12:33:15.735Z and 12:50:55.690Z. A separate auth-health request returned 200; this does **not** establish health of the completion RPC. Do not infer a failure rate, database cause, or total loss from this small sample.

**Trace:** `src/lib/supabase/learning-state-repository.ts:197,312–338,1334–1338,1369–1372`: `complete_plan_session_with_route` has a 12-second client deadline. `src/components/yova-prototype.tsx:2578–2580` creates a fresh completion identity per click; repository `:1267` passes its attempt ID. See static review for the recovery concern about bypassing the older durable completion outbox.

**Acceptance:** reproduce/instrument the RPC, distinguish timeout from a confirmed rejection, reconcile an ambiguous server result, preserve pending completion across reload, and make retry idempotent. Test delayed success, actual failure, retry and reload without duplicate credit or a permanently unfinished completed session.

### 2. Unsubmitted work lost on ordinary exit/resume — P1

**Reproduction:** in Concept Mapping, enter three concepts and one complete three-field link; Exit session → open the same plan → Start next session. Produce step and timer returned; all six fields were empty. No warning.

**Cause:** drafts are local child state in `baseline-session.tsx:601–604`; checkpoint `:381–387` and `baseline-checkpoint.ts:16–33` omit them.

**Acceptance:** persist and restore explanation text, map concepts/links and repair drafts before submission. Exercise Exit/resume and reload at each input step. Preserve generated content and previously submitted work too.

### 3. Personalization claims survive overrides or refer to unused actions — P1 trust / P2 implementation

**B reproduction:** select trying-first support + answering-questions preference. Pre-session and end say “you produced before studying and then compared.” Actual route starts with the explanation. Its first tip says “Start by answering first” on a screen with no answer input.

**Cause:** `session-route.ts:214–216` records try-first, Q6 sets retrieval at `:237–239`, return `:403` turns try-first off while retaining the decision. `shape-a.ts:76–77` uses study→questions. `rule-evidence.ts:36,145–151` and `personalization-note.ts:21` turn the retained rule into a claim.

**C reproduction:** Feynman repair tip says “practice asked one more question comparing two ideas,” although that session had no practice questions. Another tip diagnosed “right terms in the wrong order,” which did not match the actual multiplication-of-derivatives mistake.

**Acceptance:** generate claims from effective route plus actions actually shown, not merely a rule that fired before an override. Cover retrieval overriding try-first, no-practice Shape A, absent worked examples and generated tips. A valid rule ID alone does not establish truthful wording.

## Product weaknesses observed live

### 4. Long timers do not correspond to worthwhile work — high product priority

B allocated 20 minutes to roughly 90 words plus repeated key points, 25 minutes to five fairly basic MCQs and 10 to review. The single-item retry kept a 25-minute allocation. End tip told the learner to “Let the timer run.” D suggested 15 minutes outside study while its rail allocated only five to study within a 15-minute session.

This is partly **brief-compliant**: `01-SESSION-SHAPES.md:3–6` treats time as a nudge; `baseline-session.tsx:59–62` explicitly does not size content to time. `session-hub.ts:23–35,47,98` spreads a timer over fixed step weights. Question count defaults to five (`compose-practice.ts:47–54`); high map-complexity difficulty raises it to eight (`session-route.ts:328–338`). A short profile cap is also five (`:259–261`), explaining why D and B had equal first-round counts.

**Recommendation/acceptance:** align with Brief 2's content-derived block estimates, then verify both the card and hub use honest, consistent estimates. Label a short check honestly. After easy success, provide a sensible optional next task where the plan supports it. Do not make five recognition questions look like 55 minutes of practice.

### 5. Question-type labels exceed the observed intellectual demand

B really included different types, and D's questions were grounded in its source. Credit that. However, all responses were four-option MCQs. Several distractors were trivial (osmosis not involving movement; active transport only for water). The supplied A-level application goal yielded no numerical interpretation, unaided explanation or demanding transfer task in B's round.

The current “difficulty” input is topic-map complexity, not demonstrated learner ability, and mainly changes quantity. Current slot context may lose the overall academic goal when a topic is present (`baseline-session.tsx:127–141`). First-topic selection is a Brief 2 integration concern; challenge within that selected topic is a session concern.

**Acceptance:** human-review representative questions against intended level, require plausible misconceptions in distractors, preserve academic/task context, and assess fresh transfer rather than counting labels. Consider optional unaided retrieval and a “too easy” route as explicit product decisions, not assumed current requirements.

### 6. Concept Mapping is a relationship form with no map

Learners type concepts, then retype From/relationship/To in separate boxes; no graph appears. `baseline-session.tsx:688–691` renders only fields. `shape-a.ts:177–189` accepts one concept plus any filled link without matching endpoints to concepts.

The initial comparison was useful. Preserve it while making mapping visual and editable: concept-based endpoints, visible labelled links, feedback attached to the affected relationship. A graph is a product improvement, not a missing implementation requirement from the current brief. This matters especially because the less-text/visual-support option routes here.

### 7. A repair is neither rechecked nor clearly distinguished from original feedback

A repeated the wrong osmosis direction in Repair; C supplied the correct derivative. Both immediately reached the same kind of completion screen without evaluating the revision. C retained “5 missing · 2 to correct.” The app does say “feedback, not a verdict”; do not claim it awarded mastery for nonsense.

**Trace:** `shape-a.ts:160–162` accepts any nonempty repair; `baseline-session.tsx:404–417` omits repair from the completion payload; checkpoint removal is in `yova-prototype.tsx:2634`.

**Acceptance:** preserve revised work, clearly label original versus revised feedback, and offer a bounded recheck when the learner chooses to repair. Optional repair can stay optional. It should still help someone establish whether their chosen correction worked.

### 8. Model option order is shipped unchanged

D's five correct choices were all first. B's positions varied, so this is one observed pattern, not a prevalence estimate. `compose-practice.ts:96` preserves choices/index; `baseline-session.tsx:775–781` displays that order. No deterministic shuffle exists on this path.

**Acceptance:** permute choices in code and remap the correct index, keeping the permutation stable across resume and ensuring grading still matches. Retain content-quality review; shuffling alone cannot fix easy distractors.

## Additional source-established issues — not live-reproduced failures

See [static-review.md](static-review.md) for precise anchors and reproduction proposals. These should be verified before being counted as observed production bugs:

| Finding | Main source anchor | Required check |
|---|---|---|
| Comparison-error “Move on without feedback” dispatch is ignored in compare state | `baseline-session.tsx:488,704`; `shape-a.ts:156–163` | Fail comparison transport; recovery must advance honestly. |
| Escalation marks every point needs_review, including earlier successes | `baseline-session.tsx:399–403` | Pass four points, repeatedly miss one, inspect per-point outcomes. |
| Escalation promises a different next produce method without implementing the follow-up | `baseline-session.tsx:518`; `yova-prototype.tsx:2573–2638` | Inspect next block or remove unsupported promise. Coordinate with Brief 2. |
| Stopping-point/pace flags have no session renderer consumers | `session-route.ts:269–301,416–417`; `rule-evidence.ts:43–47` | Compare actual flows before claiming added check-ins/disabled pace prompts. |
| Interleaved outcomes all attach to current session's first topic | `route-for-session.ts:115–136`; `yova-prototype.tsx:2577,2596–2602` | Preserve originating topic on each mixed key point. Retest with Brief 2 relationships. |
| Exposed Practice Problems produce screen asks for a comparable problem without supplying one | `baseline-session.tsx:680–695`; `slots-schema.ts:166–176` | Reach procedural route; ensure a specific solvable prompt is present. Full Shape B remains deferred. |

## Brief 2 boundary and suggested work order

Do not count absent topic-sized plans, complete profile→plan routing, new materials/setup screens or future practice scheduling as failed shipped features. All four journeys were Study Now, so “nothing queued” is not evidence that complete multi-session plans have no value. Original broad goals were reduced to a first topic by the existing planner; judge that again after Brief 2. Its rewritten spec already includes content-based estimates, profile ceilings and practice placeholders.

1. Investigate completion and fix draft persistence.
2. Fix false session claims and the narrow recovery/evidence bugs after reproducing them.
3. Improve task-appropriate challenge, repair checking and map interaction through explicit product decisions.
4. Integrate Brief 2 and retest exact same material/topic under contrasting profiles, full planned blocks, next-work continuity and time estimates.

For the next release gate, retain structural tests but add human review of actual generated task quality. One passing round with type labels and a correct rule ID does not prove adequate challenge or honest personalization.

## Supporting artifacts

- [Plain-English report](PLAIN-ENGLISH-REPORT.md)
- [Live journey notes, exact prompts and observations](journey-notes.md)
- [Pinned-release static review](static-review.md)
- [Brief 2 scope crosscheck](scope-crosscheck.md)
- [Deployment verification](deployment-verification.md)
- [Synthetic source used for D](source-photosynthesis.txt)

Screenshots were captured in the audit conversation. Browser file export was unsupported; no downloadable screenshot files are claimed. No forced provider errors, interleaved live case, full retry-ceiling case, mobile suite, exam-mode case, tutor conversation, full planned-course journey or longitudinal retention test was run. Original profile answers were restored; the four audit-created plans and synthetic uploaded source were retained for inspection. No account or plan data was deleted.
