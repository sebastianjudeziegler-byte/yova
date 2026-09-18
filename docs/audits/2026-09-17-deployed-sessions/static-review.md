# Merged session implementation: static review

Date: 17 September 2026. Reviewed commit: `b75ec8d3da25695e6b008aa3e5f82855d415298e` (`origin/main` at review time).

All source line references below refer to that exact commit, read with `git show origin/main:<path> | nl -ba`. They do not refer to the dirty working checkout. No application code was changed and no model calls or tests were run by this reviewer. This document complements the root agent's live testing rather than replacing it.

## Scope and evidence labels

The current `BaselineSession` runner is the subject of this review. The old general-purpose session implementation remains in the repository but is not the basis for these findings. Brief 2 and its future plan-generation work are excluded. Current-session claims and the existing plan/session interface are still legitimate things to test.

- **Static fact:** directly established by the merged implementation.
- **Live confirmed by root:** root agent reported reproducing the behavior in the deployed UI; see the companion journey notes for primary live evidence.
- **Runtime hypothesis:** a static path suggests a failure, but this reviewer has not reproduced it live.

## Executive assessment

The merged work creates a more structured and predictable session loop, with genuine choices of method, study order, instructions and question mix. Learning value is less mature than that structure. A long timer can accompany a very short check; recall practice is exclusively multiple choice; concept mapping is a collection of text fields; and the repair step accepts work without checking the repair.

Those limitations exist inside the current session implementation. Better plan generation might improve topic selection and scope, but it would not automatically fix them. Some are faithful implementations of the present brief rather than implementation bugs. They should be reported as product decisions that do not yet deliver a compelling study experience.

## Findings: functional defects and trust problems

### S01 — Unsubmitted work is lost on exit and resume

**Priority:** P1/P2, depending on the amount of work lost. **Evidence:** static fact; concept-map draft loss live confirmed by root.

The explanation text, concepts, links and repair text are held in local `ShapeAStepCard` state. The parent checkpoint contains reducer state and generated content, but those drafts do not enter reducer state until submitted. Leaving unmounts the component; resuming reconstructs empty draft fields even though the app resumes the same step.

- `src/components/baseline-session.tsx:601–604`: local draft state.
- `src/components/baseline-session.tsx:381–387`: checkpoint payload omits draft state.
- `src/lib/session-shapes/baseline-checkpoint.ts:16–33`: checkpoint type has no draft fields.
- `src/components/yova-prototype.tsx:3629–3632`: exit changes stage and removes the session component.

Reproduce: reach Produce, enter a meaningful explanation or map without submitting, Exit session, resume. Expected: the input remains. Actual root observation: concept-map draft disappeared.

Fix: lift draft state into checkpointed state, persist meaningful input changes, and restore the drafts. Cover explanation, concepts, links and repair, not just the map.

### S02 — “Move on without feedback” is an inert recovery action

**Priority:** P2. **Evidence:** static fact about event wiring; runtime hypothesis pending an actual comparison failure.

The comparison-error button calls `onSkipRepair`, which dispatches `skip_repair`. The reducer ignores that event when the current step is `compare`, so the advertised way out cannot advance the session.

- `src/components/baseline-session.tsx:704`: failed-comparison recovery button.
- `src/components/baseline-session.tsx:488`: callback dispatches `skip_repair`.
- `src/lib/session-shapes/shape-a.ts:156–163`: comparison accepts only a ready comparison or Continue with an existing comparison; skipping is handled only in Repair.

Fix: introduce an explicit comparison-skipped transition and keep the eventual receipt honest about feedback being unavailable.

### S03 — Exhausting retries marks already-passed points as needing review

**Priority:** P2. **Evidence:** static fact; progress UI effect not live reproduced.

The completion outcome condition is `outstandingKeyPointIds.includes(keyPoint.id) || cState.phase === "escalate"`. The second clause marks every key point `needs_review` if even one point remains at the retry ceiling. That discards the distinction between a point already passed and the actual unresolved point.

- `src/components/baseline-session.tsx:399–403`: incorrect outcome construction.
- `src/lib/session-shapes/shape-c.ts:141–150`: reducer correctly maintains the outstanding subset; the information exists before completion construction.

Reproduce: answer four key points correctly, keep missing just one through the round ceiling, Finish. Inspect the recorded concept outcomes.

Fix: determine each outcome from its own outstanding status. Do not turn a session-level escalation into an outcome for every point.

### S04 — Failed practice promises a changed next method without applying it

**Priority:** P2. **Evidence:** static fact about the visible promise and completion path; next-session effect not live reproduced.

At the retry ceiling, the UI says, “Your next learn block on this topic will use a different produce step.” `completeBaselineSession` passes no adaptation, follow-up, continuation or successor route to the cloud writer and simply completes the current session locally. The existing next session is readied without modifying its method.

- `src/components/baseline-session.tsx:518`: promise.
- `src/components/yova-prototype.tsx:2573–2638`: baseline completion path.
- `src/components/yova-prototype.tsx:2607`: all adaptation/follow-up arguments are null.
- `src/components/yova-prototype.tsx:2629`: local completion contains no adaptation.
- `src/lib/learning/complete-plan-session.ts:57–66`: next session is readied unchanged without adaptation.

Fix: implement the specific promised method change, or remove that promise until the feature exists. This does not require judging unimplemented Brief 2; it concerns a promise made by the current completed-session screen.

### S05 — Some personalization receipts claim session effects that are not wired up

**Priority:** P2. **Evidence:** static fact.

Routing assigns `stoppingPoints` and `pacePrompts`, but no session renderer consumes either property. Repository-wide searches found their consumers in routing, tests and onboarding summary only. Receipts nevertheless say additional stopping points occurred and pace prompts were switched off.

- `src/lib/routing/session-route.ts:269–301`: assignments and reasons.
- `src/lib/routing/session-route.ts:416–417`: returned fields.
- `src/lib/routing/rule-evidence.ts:43–47`: learner-visible claims.
- `src/components/baseline-session.tsx:452–455`: timer nudge displayed without checking `pacePrompts`.

The timer duration does change; that part is real. Every journey already advances by buttons, so the existence of ordinary Continue buttons does not establish extra personalized check-ins.

Fix: implement an observable behavior difference or revise claims to precisely describe what changed. Verify matched journeys with and without each preference.

### S06 — Interleaved review loses originating-topic attribution

**Priority:** P2. **Evidence:** static fact; niche runtime path not live reproduced.

Interleaved key points are assembled from multiple previously passed topics as `{id, text}`. Completion later assigns the current session's first topic ID to every key-point outcome, including facts taken from other topics.

- `src/lib/routing/route-for-session.ts:115–136`: mixed-topic key point collection and loss of topic metadata.
- `src/components/yova-prototype.tsx:2577`: single topic ID selected.
- `src/components/yova-prototype.tsx:2596–2602`: single topic ID applied to every outcome.

Fix: preserve originating topic IDs through key-point selection, question answers and completion outcomes. Otherwise mixed practice contaminates the target topic's evidence.

## Findings: learning value and usability

### S07 — Session duration does not determine the amount of study

**Evidence:** static fact; whether a particular subject feels too short requires live judgment. **Classification:** product gap, potentially brief-compliant.

An ordinary first round targets five questions. A high-difficulty topic targets eight. One clean round ends practice; subsequent rounds happen only after misses and cover only outstanding points. There is no loop that provides useful additional work for remaining time. The runner's own comment says it “never sizes it to a time slot.”

- `src/components/baseline-session.tsx:59–62`: explicit design statement.
- `src/lib/practice/compose-practice.ts:40–49`: first-round and retry question counts.
- `src/lib/routing/session-route.ts:328–338`: five/eight question targeting.
- `src/lib/session-shapes/shape-c.ts:141–150`: clean round ends the topic.

Sidebar step minutes are calculated by splitting the profile timer using fixed weights. They are not estimates derived from the actual explanation or questions:

- `src/lib/session-shapes/session-hub.ts:23–35`, `:47`, `:98`.

The user's reported three short rounds should not be generalized as the current mandatory flow: the merged runner can finish after just one successful round. This makes the long-timer mismatch more fundamental.

Recommendation: either present these honestly as short checks and offer useful next work, or supply adaptive deeper/transfer practice when the learner wants a longer session. Do not pad time or force redundant repeats after demonstrated success.

### S08 — Active Recall is exclusively four-option multiple choice

**Evidence:** static fact. **Classification:** product limitation.

Question mixes genuinely vary between recall, application, prediction, comparison and misconception prompts, but every answer is chosen from four visible alternatives. The active runner has no typed retrieval path and no in-session request for harder material. Recognition checks can be useful, but this weakens the app's case as serious active-recall practice for capable learners.

- `src/lib/practice/compose-practice.ts:16–25`: all questions require four choices.
- `src/components/baseline-session.tsx:769–793`: interaction and feedback.
- `src/lib/openai/shape-slot-generator.ts:210–212`: generation contract.

Recommendation: add response forms suitable for the target skill, including unaided short answers, derivations or explanations where appropriate. Validate transfer rather than relying only on repeated recognition.

### S09 — Concept Mapping provides neither a visual map nor consistent graph structure

**Evidence:** static fact; root tested the live mapping journey. **Classification:** substantial product gap.

Users type concepts in one list, then independently retype From/relationship/To strings in another. No nodes or edges are displayed, endpoint fields are not bound to the concept list, and only one nonempty concept plus one filled link is needed to submit. The map is flattened to text for comparison. This is a particularly poor match for the support preference “less text and more visual structure,” which can force this method.

- `src/components/baseline-session.tsx:688–691`: complete mapping input UI.
- `src/lib/session-shapes/shape-a.ts:177–189`: minimal validity and plain-text flattening.
- `src/lib/routing/session-route.ts:282–285`: visual-support override.

Recommendation: show the actual graph as the learner builds it; select endpoints from existing concepts; give a clear scope and purpose; preserve drafts; provide relationship-specific feedback that can be applied to the graph.

### S10 — Repair accepts any nonempty text without checking the correction

**Evidence:** static fact; root live confirmed deliberately wrong repair was immediately accepted with no further feedback. **Classification:** product weakness, not necessarily a deviation from the brief's optional-repair design.

The first comparison can be useful: root reports that it correctly caught a reversed explanation of osmosis. The next step does not determine whether the learner repaired that misconception. Any nonempty text advances immediately. The completion callback also omits the repair; after successful completion the session checkpoint is cleared. “Save repair” saves it transiently within the current session state rather than preserving a durable corrected artifact.

- `src/components/baseline-session.tsx:714–724`: repair interaction.
- `src/lib/session-shapes/shape-a.ts:160–162`: unconditional advance for nonempty repair.
- `src/components/baseline-session.tsx:404–417`: completion payload lacks repair.
- `src/components/yova-prototype.tsx:2634`: checkpoint cleared after completion.

Recommendation: offer a short targeted recheck or compare the revised response. Optional participation can coexist with meaningful feedback for learners who choose to repair. Clarify what “Save” means.

### S11 — Academic challenge personalization is narrower than the surrounding messaging

**Evidence:** static fact. **Classification:** product limitation and plan/session interface issue.

Topic difficulty is subtopic count plus number of prerequisites. Only the high band changes behavior, by asking more questions. It does not tune cognitive challenge from the learner's demonstrated ability. Generation input includes the topic title, up to 400 characters of description, subtopics and task type; style/mix/tips add some profile influence. There is no explicit academic level, exam board, desired challenge or accumulated performance-history field in the slot input. Those facts can reach the generator only incidentally if preserved in topic prose or material.

- `src/lib/practice/topic-difficulty.ts:1–6`, `:31–36`.
- `src/components/baseline-session.tsx:127–141`: topic and modifiers assembled.
- `src/lib/session-shapes/slots-schema.ts:29–53`: topic/modifier contract.
- `src/lib/openai/shape-slot-generator.ts:263`, `:340`: model input.

The actual session objective is displayed in the sidebar but is not the model's topic description when a knowledge-map topic exists (`baseline-session.tsx:130`, `:554`). A better generated plan helps only if the relevant challenge and scope information is carried through this interface.

Recommendation: distinguish preference personalization from demonstrated-ability adaptation in the report. Add an explicit scoped learning target and challenge context before claiming the latter.

### S12 — Practice Problems asks for a comparable problem without supplying one

**Evidence:** static fact. **Classification:** exposed-path usability defect; full worked-example route is explicitly deferred and should not be judged as shipped.

The Produce screen says to work a comparable problem and shows a blank textarea. The learn-block schema contains a fully worked example but no fresh unsolved problem. The user is expected to produce a solution without being given the concrete question to solve.

- `src/components/baseline-session.tsx:680–695`.
- `src/lib/session-shapes/slots-schema.ts:166–176`.
- `src/lib/openai/shape-slot-generator.ts:238–255`.

Recommendation: supply the specific unsolved task whenever the existing Practice Problems option is exposed, or disable that option until there is a usable minimal implementation. Do not conflate this with demanding the complete deferred route.

### S13 — Try-first preference is explicitly disabled for recall, but its claim survives

**Priority:** P2. **Evidence:** static fact; root live confirmed in journey B. **Classification:** current-session personalization and receipt defect, independent of Brief 2.

Root tested a learner choosing `try_then_feedback`, proof by answering questions, 45–60 minute sessions, rare focus loss and no support needs. For the A-level biology topic “Diffusion, osmosis and active transport,” the pre-session card claimed, “Because you said trying first helps most, you produced before studying and then compared.” The actual runner opened **READ THE EXPLANATION**, with **SHAPE A · STUDY → CLOSED-BOOK QUESTIONS** and a 55-minute timer. Its rail allocated 20 minutes to reading, 25 to questions and 10 to review. The preference did not produce the claimed experience.

The exact merged routing path explains both the behavior and the false claim:

1. `src/lib/routing/session-route.ts:214–216` sets `produceBeforeStudy = true` and appends `L3.q5.try_then_feedback` to the decisions when the try-first answer applies.
2. `src/lib/routing/session-route.ts:237–239` then sets `produceStep = "retrieval_questions"` for answering-questions preference.
3. `src/lib/routing/session-route.ts:403` explicitly returns `produceBeforeStudy: false` whenever the produce step is retrieval questions. It does not remove or supersede the earlier try-first decision; `:422–423` returns the original decisions and their rule IDs.
4. Independently, `src/lib/session-shapes/shape-a.ts:70–77` constructs the study step and immediately returns study → retrieval handoff for retrieval questions. That return occurs before the try-first branch at `:88–89`. There is no Produce → Study → Compare sequence on this route.
5. `src/lib/routing/rule-evidence.ts:31–40` ranks the try-first note above the answering-questions note. The former asserts that producing before studying and comparison occurred.
6. `src/lib/routing/rule-evidence.ts:145–151` chooses claims from the presence of a decision, not the final effective route. The only actual-experience filter there is for a missing worked example. `src/lib/routing/personalization-note.ts:20–22` takes the first resulting note.
7. `src/components/pre-session-card.tsx:54`, `:80` renders this note before the session. The same rule evidence feeds the in-session note (`src/components/baseline-session.tsx:204`, `:524`) and full end receipt (`src/lib/routing/rule-evidence.ts:175–180`). Thus the incorrect claim is not confined to a pre-session tense issue.

The study-first recall path may be an intentional method constraint. The bug is that the app still represents the overridden preference as applied. Implement a supported attempt-before-teaching recall flow if that is the intended promise; otherwise record the effective override and explain accurately that this route studies before questions. Build learner-visible personalization claims from effective behavior, not every intermediate rule that happened to fire.

Acceptance check: with this exact pair of profile answers, the displayed explanation of personalization must match the generated step sequence. Test the pre-session card, hub reasons, end note and full receipt. Also test changing to retrieval questions through the method chooser: `src/lib/routing/session-route.ts:502–515` similarly disables try-first for this override while retaining previous decisions.

### S14 — One source-backed round put every correct answer first; option ordering is model-controlled

**Priority:** P2 quality follow-up. **Evidence:** root live observed one five-question round; option-order preservation is a static fact. **Classification:** small-sample question-quality concern, not a demonstrated general answer-position bias.

In journey D, the learner studied outside YOVA using an uploaded synthetic photosynthesis source, with gist preference, a short 15-minute session and no support needs. The round contained recall, recall, application, compare/contrast and misconception questions. All five correct answers were the first option. Root reports that answer positions varied in journey B, so this observation must not be summarized as “YOVA always puts the answer first” or used to estimate a general failure rate.

The active code has no deterministic option shuffle or answer-position distribution guard:

- `src/lib/practice/compose-practice.ts:28–33`: the model supplies both the choices and correct index.
- `src/lib/practice/compose-practice.ts:82–88`: validation checks schema, planned slot identity and distinct choices, without checking position distribution.
- `src/lib/practice/compose-practice.ts:94–96`: composition preserves `written.choices` and `written.correctChoiceIndex` exactly.
- `src/lib/openai/shape-slot-generator.ts:210–212`: instructions require four distinct plausible choices but do not request answer-position balancing.
- `src/components/baseline-session.tsx:774–781`: renderer maps the preserved array directly to A/B/C/D.
- `src/lib/session-shapes/shape-c.ts:113–116`: grading compares the clicked index directly with the preserved correct index.

This leaves any model-produced position pattern visible to the learner. A long repeated position can make an already short check feel guessable, although this single round does not establish that the learner could predict answers reliably.

Recommendation: sample more rounds before claiming prevalence. Consider a stable per-question option permutation at composition time, updating the correct index alongside it and persisting that order for resume. A shuffle should not break intrinsically ordered choices or create a different pattern on rerender. Prioritize meaningful question difficulty and plausible distractors alongside option position.

Credit from the same journey: root reports that all questions aligned with the source's simple photosynthesis foundations and did not ask about document wording or structure. Do not penalize source alignment or infer source-grounding failure from the answer-position pattern.

## Completion failure observed in the live session: static trace, not a proven diagnosis

Root reported that Finish showed “YOVA could not save this session...” and console logged `YOVA session completion sync failed [client:deadline]` at **12:21:16 UTC**. Final audit update: A and D each failed initial Finish plus one retry; B failed its Finish attempt; C saved. After final reload A/B/D showed 0/1, C showed 1/1. This is live-observed failure; the underlying network, auth or database cause is not established by static review.

The merged call path is:

1. `src/components/baseline-session.tsx:395–421`: Finish calls `onComplete`; a false result presents the save failure and enables another attempt.
2. `src/components/yova-prototype.tsx:2573–2607`: baseline completion builds a fresh completion object and invokes `completeAuthenticatedPlanSession` directly.
3. `src/lib/supabase/learning-state-repository.ts:1334–1338`: the repository calls the Supabase RPC `complete_plan_session_with_route` with the completion payload.
4. `src/lib/supabase/learning-state-repository.ts:197`, `:312–338`: the client enforces a **12,000 ms** deadline and aborts a signal-aware request when it expires. The code explicitly intends also to settle when auth/session resolution never reaches the fetch layer (`:306–310`).
5. `src/lib/supabase/learning-state-repository.ts:1362–1376`: the deadline exception produces exactly the observed `[client:deadline]` console label.
6. `src/components/yova-prototype.tsx:2608–2611`: the baseline caller catches the error and returns false, keeping work on screen.

What the error establishes: the browser did not receive completion confirmation within its client deadline. It does **not** establish whether the database write was never attempted, was slow, or succeeded without a timely client response.

Two robustness concerns warrant follow-up, but are not proven causes of this observed timeout:

- Every Finish retry constructs a **new completion ID** (`yova-prototype.tsx:2578–2580`), which becomes the RPC `attemptId` (`learning-state-repository.ts:1265–1268`). For an ambiguous timeout, reconcile whether the previous attempt committed before issuing another logical completion identity.
- This baseline completion path invokes the repository directly. It does not use the durable completion-queue/outbox path visible in the older runner at `yova-prototype.tsx:2456–2509`. The baseline retains its local session checkpoint on failure, but that is not equivalent to replaying a stable queued terminal event.

Recommended investigation: correlate the exact account/session and UTC timestamp with Supabase RPC/auth/network logs; check for an existing completion receipt; test retry after an ambiguous response; and verify durable, idempotent recovery. Do not simply increase the deadline without understanding the failure.

## Working behavior worth preserving

- Question-type mix changes are implemented in code-planned slots.
- Profile choices genuinely affect method, instruction style, study-first/try-first order, example-first behavior and timer length.
- Wrong multiple-choice answers immediately reveal the correct choice and an explanation.
- Retry generation receives outstanding points and the learner's wrong choices to target repair.
- Submitted work, generated content and question progress are checkpointed for same-browser resume.
- Most completion and comparison copy avoids broad claims of mastery.
- Slot failures normally produce an honest retry/error state rather than fabricated lesson content.
- Root's live test found comparison feedback correctly identified reversed osmosis; the problem is the subsequent unchecked repair, not an assertion that all feedback is bad.

## Suggested implementation order

1. Resolve the observed Finish failure and verify stable, idempotent completion recovery.
2. Prevent draft loss and fix the inert comparison recovery action.
3. Correct per-point evidence and interleaved topic attribution.
4. Remove or implement unfulfilled personalization/escalation claims.
5. Improve the current session's learning loop: meaningful duration expectations, harder/unaided retrieval, checked repairs and usable concept mapping.
6. Carry richer target/challenge context from the future plan generator into the session generator, treating that as an explicit integration contract.
