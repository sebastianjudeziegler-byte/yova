# Companion brief — dependable, worthwhile sessions

Date: 17 September 2026. Status: **approved for implementation; implementation in progress**.

This brief accompanies the three supplied [Brief 2 files](../briefs/2026-09-17-session-quality/supplied-brief-2/). It does not replace their plan model. Read [OWNERSHIP-AND-EXECUTION.md](OWNERSHIP-AND-EXECUTION.md) before implementation.

## Outcome

A learner gets a concrete task worth doing, can leave without losing their work, receives feedback on the answer they actually submitted, and can finish with a reliable saved result. The interface accurately describes what happened. Concept Mapping should help someone think about relationships, rather than make them maintain a form.

The central complaint about a long session containing a handful of easy questions is **shared with, and primarily owned by, the supplied Brief 2**. Its new fill-to-capacity requirement must be implemented once. This companion owns session defects and explicitly selected product improvements that remain after the plan work.

## Evidence and limits

Source: the [deployed-session audit](../audits/2026-09-17-deployed-sessions/CLAUDE-HANDOFF.md), with [journey notes](../audits/2026-09-17-deployed-sessions/journey-notes.md) and [pinned source review](../audits/2026-09-17-deployed-sessions/static-review.md).

Four production Study Now journeys were tested on the same test account with contrasting profiles, against release `b75ec8d`. Three sessions encountered completion-save failures; one saved successfully. One map draft lost six field values on exit/resume. Wrong and correct repairs both advanced without rechecking. False personalization claims were observed. One five-question round put every correct answer first.

These are observations, not population failure rates. Automated elapsed time is not student completion time. The audit did not reproduce three mandatory full practice rounds: a clean round ended, and one miss generated a one-question retry. The founder's repeated-round report remains an investigation in Brief 2. Topic selection and the value of a complete multi-session plan must be reassessed after Brief 2.

## Product decisions — confirmed by the founder

| Decision | Confirmed behavior |
|---|---|
| Map interaction | A small, reliable guided visual map with deterministic layout and accessible controls. Launch reliability takes priority over editor sophistication. |
| Answer format | Keep practice MCQs. Improve challenge and distractors. Existing explanation/map production and repair remain; no new written-answer practice engine. |
| Early accurate finish | Offer worthwhile harder or next-ready work, with a finish option, through Brief 2's queue/workload contract. |
| Undo defect | Explicitly deferred by the founder. It is not a prerequisite to starting this work. Do not silently mark it fixed. |
| Product priorities | 1. Paid-launch reliability and generation recovery. 2. Actual usefulness/usability. 3. Essential research-based personalization through the learning profile and its effective routing. |

The founder authorized implementation and declined further refinement questions. These decisions supersede conflicting instructions in the supplied handoff. Preserve visible, tested personalization; reliability must not be achieved by stripping YOVA down to generic sessions.

## S1. Completion is durable and recoverable

Investigate the actual completion RPC deadline. Do not assume a database, authentication, or server-capacity cause from the browser message alone.

- A logical completion retains one identity across clicks, retries and reloads. Persist the pending result before sending it. Scope it to the signed-in account and plan/session.
- Distinguish a confirmed rejection from a timeout with an unknown server outcome. Reconcile late success before issuing a logically new completion.
- A retry or reload cannot double-credit learning or leave a confirmed completion permanently displayed as unfinished.
- Preserve work when saving fails. Clearly distinguish pending save from saved completion; provide retry and recovery without making the learner repeat the exercise.
- Record enough bounded diagnostics to trace an attempt through the client and server without logging learner answer text unnecessarily.

Acceptance: real database-backed success, delayed success past the client deadline, confirmed failure, double click, retry, reload while pending, and recovery after reconnect. Verify the saved record and visible plan count. Account switching must not replay another learner's pending work. Merely lengthening the timeout is insufficient evidence of a fix.

## S2. Leaving a session does not erase work

Checkpoint unsubmitted explanations, map concepts and links, and repair drafts. Preserve generated content, submitted answers, feedback, current step and timer state as well. Saving must cover immediate exit after typing, not depend on waiting for a periodic timer tick.

Acceptance: enter distinctive values, exit and resume, then repeat with reload at every input step; verify exact values and the same generated task. Test the final keystroke before exit. Remove or retire a checkpoint only after completion has been durably confirmed. Keep account/session boundaries explicit.

## S3. Session claims are true

Pre-session copy describes the effective route that will run. In-session tips describe available actions. Receipts describe actions that actually occurred. An earlier rule firing is not sufficient when a later rule overrides it.

Cover retrieval overriding try-first, a skipped or absent example, Shape A with no practice round, method changes, unused stopping/pace flags, and unsupported diagnoses of a learner's mistake. Generated wording receives only applicable evidence. If a claimed adaptation was not implemented, omit the claim rather than invent a behavioral explanation.

Acceptance: compare each visible claim with actual screens/actions under contrasting profiles on the same topic and source. Preserve a valid reason and visible effect for implemented personalization; do not solve dishonesty by removing all meaningful explanations.

## S4. Submitted repairs receive a bounded recheck

Repair remains optional. Choosing to submit a correction checks that correction against the relevant gaps once, with the task/source context retained. Keep the original answer and feedback separately from the revised answer and its feedback.

- An incorrect revision remains visibly unresolved. A correct revision gets updated, specific feedback.
- Blank text, copied feedback, or the act of typing is not evidence that a gap was repaired.
- A recheck timeout preserves the correction and offers retry or continuation clearly marked as unchecked.
- No endless compulsory correction loop. After the bounded check, the learner may finish with remaining gaps explicitly recorded.
- Any learning evidence comes from the server assessment under the existing evidence rules, not a client-declared success.

Acceptance: replay the audit's wrong osmosis correction and correct product-rule correction. The results must differ appropriately, survive reload, and retain original-versus-revised provenance. “5 missing · 2 to correct” cannot silently masquerade as feedback on a newly corrected answer.

## S5. Concept Mapping becomes a usable activity

Build a compact guided visual map using deterministic layout and existing typed concept/link data. Avoid external graph-generation services and a general-purpose whiteboard dependency.

- Concepts have stable identities. A link selects existing concepts as endpoints and has an editable relationship label; learners need not retype concept names.
- The visible map updates as concepts/links change. Renaming a concept preserves its links. Deletion has consistent, visible consequences for connected links.
- Feedback identifies the relevant concept or relationship in both the map and an accessible text view. The original and revised maps remain distinguishable.
- Provide a usable keyboard and phone path without requiring precise dragging. Preserve drafts through S2.
- Keep worked examples and specific comparison feedback that already help. Do not turn visual support into a reading-heavy form.

Acceptance: create, connect, rename, edit and remove concepts/links; correct a misconception on the affected relationship; resume the exact map after exit/reload. Check desktop and narrow touch layout.

## S6. Challenge is tied to the learning target

Brief 2 owns the amount of work and planned recall/application weighting. This section owns the quality and answer interaction within that work.

- Carry the academic level, overall learning objective, selected topic/subtopics and relevant source context into session task generation. A topic title alone must not erase “A-level application practice.”
- Application/compare questions must require the named reasoning. Distractors should represent plausible misconceptions; obvious nonsense is not a substitute for intellectual demand.
- Practice remains multiple choice, graded deterministically in code. Improve question substance without adding a new written-answer grading system.
- Existing exposed Practice Problems must contain a specific solvable unsolved prompt. This is a narrow task repair, not implementation of the deferred full Shape B sequence.
- Offer any selected early-finish continuation through Brief 2's existing queue/workload contract. Preserve already-earned outcomes, respect prerequisites and the learner's stop choice. Do not create a second planner or infer enduring ability solely from fast answers.

Acceptance: review actual generated tasks for introductory factual learning and demanding conceptual/application practice. Include a fresh scenario requiring transfer, with a meaningful explanation of why an answer is right or wrong. Structural type labels alone do not pass this gate.

## S7. Option order does not reveal the answer

Apply a code-owned permutation to eligible MCQ options and remap the correct index. Persist the resulting order for that question instance across rerenders and resume. Do not randomly shuffle options with inherent numeric/chronological order or text referring to option positions; require a compatible option schema or preserve a meaningful ordering explicitly.

Acceptance: grading is invariant under permitted permutations; revealed feedback matches the displayed choice; answer order stays stable on reload. Exercise an input set whose correct answers are all initially first. Do not claim randomization guarantees perfectly balanced positions in every small round.

## S8. Recoveries and outcomes remain accurate

These additional source findings require failing reproduction before they are reported as fixed:

- Comparison transport error: “Move on without feedback” advances, preserves work and records that feedback was unavailable.
- Retry ceiling: previously passed points retain their result; only unresolved points become `needs_review`.
- Mixed-topic practice: each key point/result retains its originating topic through completion and plan updates.
- Escalation copy promises a different next activity only if that activity exists and is actually queued by Brief 2. Otherwise state the remaining gap and the next action honestly.

Do not expand this into adaptive cross-plan routing or silently alter Brief B's revision pipeline.

## Verification and reviewable recordings

Each behavioral fix needs a failing-then-passing test of the relevant path. Use a real database for persistence/reconciliation seams. Deterministic transport-failure fixtures are appropriate for recovery; fabricated model answers cannot establish generation quality.

Retain existing create → activate → open → complete and unchanged-session revision guarantees. Run the required full gates in CI, with the stated comparison against current main. Keep local verification scoped per the standing rules.

Record named browser journeys, retaining successful videos as well as failures. Provide an index with scenario/profile, exact environment and commit, mocked versus live dependencies, timestamps and outcome. Verify recordings actually exist and play before promising them. A local preview recording is not a production test. Retain traces privately/local where needed; follow the existing artifact-sanitization policy.

Release evidence must include: same-topic/source contrasting profiles; a substantial long application block; short factual practice; wrong and correct revised answers; one missed-point retry; completion retry/reload; and a full planned multi-topic journey alongside Study Now. Include visual-map repair and resume. Keep generated content available for quality review. Automated elapsed time does not prove learner pacing or retention.

## Explicit exclusions

No duplicate plan composer, cross-plan memory, full adaptive learner model, full Shape B, general diagram editor, ingestion expansion beyond the supplied Brief 2, paywall or unrelated visual redesign. No forced waiting, arbitrary repetitive rounds, or inflated time estimates to make a session appear substantial. Actual merge/deployment and any founder-owned deletion of old plans remain separate release actions.

## Deliverable

One companion implementation PR following the agreed Brief 2 dependency sequence, with an evidence ledger tying every requirement to before/after behavior, actual tests, generated-output samples and named video artifacts. Report what remains unresolved without equating passing code checks with established learning efficacy.
