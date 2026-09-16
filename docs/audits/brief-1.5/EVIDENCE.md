# Brief 1.5 — Evidence

## Item 1 — Round-two generation (launch blocker)

### Root cause

A retry round asks the model for "one question per key point" over only the
missed points, so a one- or two-point retry correctly returns one or two
questions. `bindQuestionsToKeyPoints` then composed the round with a hard-coded
`questionMinimum: 3`, and `practiceQuestionCount` clamped every round to at
least three. The composer rejected the valid answer, `withOneRetry` asked
again, was rejected again, and the route returned
`ShapeSlotGenerationError` → 502 twice: the audit's exact symptom.

The unit suite encoded the bug as intended behaviour
(`compose-practice.test.ts`: a one-point retry with one question was expected
to be refused; three questions on the same point were "enough"). The browser
fixture `e2e/baseline-session.spec.ts` replaced the slot route's response and
hand-supplied three round-two questions, so the composer never ran.

### Decision: lower the retry minimum to one question per missed point

The brief allowed either dropping the minimum or asking for enough questions.
Chose the first, because:

- **Same evidence standard as round 1.** Round 1 checks each key point with one
  question; a retry checks each missed point the same way.
- **Three questions on one fact are not repair.** They are near-duplicates of
  the question the learner just missed, and they conflict with "do not repeat
  questions from earlier attempts".
- **The count is code, not a request the model can miss.** Demanding a number
  the prompt does not naturally produce is how this broke.

Round 1 is unchanged (one per key point, clamped 3–8, then the route cap).
A retry still fails if any missed point goes unchecked: a second question on
one point can no longer stand in for a skipped point. The retry prompt now
states the exact count.

### Red — before the fix

`pnpm exec vitest run src/lib/practice/compose-practice.test.ts src/lib/openai/shape-slot-generator.test.ts`

```
× round 2 accepts one question when one key point is outstanding
× round 2 accepts two questions when two key points are outstanding
× a 'one-point' retry succeeds on the first call with one question per missed point
× a 'two-point' retry succeeds on the first call with one question per missed point
ShapeSlotGenerationError: YOVA couldn't build this. Try again, or add material for this topic.
Tests  4 failed | 25 passed (29)
```

The generator failures raise the same learner-visible error the audit saw.

### Green — after the fix

- Same two files: **29 passed (29)**.
- Practice, session-shape, slot-generator, routing, session-route and component
  suites: **375 passed (375)**.
- `tsc --noEmit` and `pnpm lint` clean.

While going green, the new "leaves a missed point unchecked" case caught a gap
in the first version of the fix (two questions on one missed point satisfied a
two-point retry). Retry rounds now select exactly one question per missed point.

### Browser fixture

`e2e/baseline-session.spec.ts` round two now returns one question for the one
missed point, the shape the server actually returns, and its header states
that the slot mocks are not coverage of generation or composition. The
recorded attempt totals changed from 5/6 to 3/4 accordingly.

Focused local run (the one browser case the standing rules allow):
`[baseline-chromium] a memorization learn block runs Shape C … finishes clean on round two` — **1 passed**.

### Standing rule added

`06-STANDING-RULES.md`: a browser fixture that hand-supplies what the prompt
should have generated is not a test of that path; fixtures mock transport, not
the shape of the model's answer.

### Live, unmocked verification

Nothing live exercised the baseline practice path before this brief: the live
gate's browser half runs only `e2e/plan-launch-live.spec.ts` against a flag-off
server. `e2e/baseline-practice-retry.live.spec.ts` now runs in CI ("Run live
baseline practice retries") on the flag-on server with the real model key.
Every learn-block and practice call reaches the real slot route and composer;
responses are only observed, to know which choice is correct so round one can
miss exactly one or two key points. The saved plan is the no-model fallback
plan whose first session routes to Shape C.

CI run 35076002955 (commit 0781076):

```
✓ [baseline-chromium]        a 1-point retry generates live and completes (16.5s)
✓ [baseline-chromium]        a 2-point retry generates live and completes (12.4s)
✓ [baseline-mobile-chromium] a 1-point retry generates live and completes (13.1s)
✓ [baseline-mobile-chromium] a 2-point retry generates live and completes (22.6s)
4 passed
```

Each case asserts the live round-two practice call returned 200, that
round two shows exactly one question per missed point and covers exactly the
missed key points, and that the round finishes with "A full round passed
clean." Screenshots of round-one end, the round-two question and the passed
round are retained in the run's quality evidence artifact.

### Full gate on run 35076002955

The regression comparator reports **BLOCKED** on three cases. None is a
regression from item 1:

| Case | Evidence | Disposition |
|---|---|---|
| `calendar-tab.spec.ts` quick-add deadline, desktop | Fails 0/3 on **today's main** too (run 35074864685, 6ed9aa3), which the same comparator also reports as a new failure versus the older retained main sample. Weekday-relative input. | Pre-existing on current main; backlogged |
| `calendar-tab.spec.ts` quick-add deadline, mobile | Same as desktop | Pre-existing on current main; backlogged |
| live plan-to-session "History essay using outside sources" | Passed on today's main, failed once here; single live sample on a path item 1 does not touch | FLAKY; backlogged |

Today's main fails the same three steps (core learner journey, full live gate,
regression gate). The gate will keep blocking every branch until the calendar
case is fixed on main or the retained main sample is refreshed.

**One failure was caused by this branch and is fixed.** "Compare the Study
Profile phone-width case on main and release" failed because `git checkout`
found an uncommitted `tsconfig.json`: the first version of the live config gave
its dev server a new build directory, and `next dev` added it to
`tsconfig.json` mid-run. The live config now reuses `.next-e2e-baseline`, which
`tsconfig.json` already lists.

### Merge plan (founder decision, 2026-09-16)

If item 1's live gate is green, #91 merges with item 1 on its own rather than
waiting on items 2–7, which will take days. Items 2–7 continue on a follow-up
branch and PR. This overrides the standing "one branch, one PR" rule for this
brief.

## Item 2 — Question-type mix

Merged separately from item 1 (founder decision). Items 2–7 continue on
`baseline-session-hub` rebuilt from main `4db4b99`.

### What changed

- **Routing** replaces `route.weighting` with `route.questionMix`: counts per
  type for a five-question round, from the brief's task-type table
  (rule `L4.mix.<taskType>`), then Q7 shifts one item
  (`L4.q7.gist_leaning.mix_recall`, `L4.q7.detail_leaning.mix_compare_contrast`).
  The old `L4.q7.gist_leaning` / `L4.q7.detail_leaning` weighting rules and
  `L4.q7.*.task_default` are gone; their personalization notes now name the
  mix change.
- **Question type is a slot.** `planQuestionSlots` assigns every question its
  type and the key points it may draw on. The model receives the slots and
  writes one question per slot id; `composePracticeRound` copies type and key
  points from the slot, never from the model, and refuses a missing, duplicate
  or unplanned slot.
- **Two-point types** (application, compare_contrast, prediction) span two key
  points; recall and misconception span one.
- **Distractors:** the prompt asks for plausible reasoning errors. No
  validator, per the brief.
- **Order:** flat generation order, types in table order. Nothing is reordered
  by profile.
- **Shape C** records every key point an answer tested. A missed two-point
  question marks both points missed (founder-confirmed).
- **Learner-visible:** the question screen said "Definitions and terms first."
  Order no longer follows the profile, so that line would claim a
  personalization that did not happen. It now names the question's real type
  ("Application question."). The onboarding summary describes the mix.

### Decisions taken

| Question | Decision |
|---|---|
| Which type gives up an item when Q7 shifts the mix? | The largest other type; ties go application, compare_contrast, prediction, recall, misconception, so misconception is kept while it can be. Memorization + gist becomes 5 recall. |
| Counts other than five | Largest-remainder scaling, ties in type order; always sums to the count. |
| Round size | A first round asks five questions within the route cap. It is no longer one question per key point: two-point questions cover more ground. Learn blocks and derived practice ask the model for exactly 3–5 key points (fewer for a smaller cap) so slots can reference `k1…kN` before the model writes them. |
| Retry (item 1 contract) | Still one question per missed point. Slots cover every missed point. A one-point retry turns two-point types into recall; a two-point retry pairs only the missed points. |
| Two-point question in a retry with one missed point | Not possible, so recall (founder-confirmed). |
| Superseded spec text | `04-AI-SLOTS.md` "one question per key point" and the `02-ROUTING.md` Q7 weighting rows now point to this brief. |

### Red — before

Routing (`session-route.test.ts`, `personalization-delta.test.ts`):
**5 failed** — routes had no question mix and no mix rule IDs:

```
× asserts on the rule IDs that fired for each profile
× two contrasting profiles get different question-type mixes, decided by rule
× Q7 gist_leaning shifts the conceptual question mix (L4.q7.gist_leaning.mix_recall)
× Q7 detail_leaning shifts the conceptual question mix (L4.q7.detail_leaning.mix_compare_contrast)
× Q7 balanced or unanswered keeps the task type's mix
```

Pipeline (composer, slot generator, Shape C, slot handler): **33 failed**
against the old one-question-per-key-point contract. `question-mix.test.ts`
failed to import before the module existed.

### Green — after

- Item 2 suites (practice, generator, session shapes, handler, routing):
  **160 passed**.
- Full unit suite: **4214 passed**, 91 skipped. `tsc` and `lint` clean.
- Focused local browser case (mocked Shape C session to completion):
  **1 passed**, now asserting "Recall question. No source shown."

### Personalization delta (gate)

Same topic, contrasting profiles: P1 (gist) gets
`2 recall, 1 application, 1 compare_contrast, 1 misconception` with
`L4.q7.gist_leaning.mix_recall`; P2 (detail) gets
`1 recall, 1 application, 2 compare_contrast, 1 misconception` with
`L4.q7.detail_leaning.mix_compare_contrast`. Asserted on rule IDs. Tip text for
the delta arrives with items 6–7.

### Live check (new)

`src/evals/practice-question-mix.live.test.ts` is **new**. The brief asked to
extend a study-guide live test that had never been written (founder-confirmed).
Two conceptual rounds from the real model, a learn block and a practice round
from a study-guide excerpt, each assert at least one non-recall question,
two-point types spanning two key points, and no question prompt containing a
key point's text. The live gate discovers it automatically; its questions are
written to `test-results/live-gate/question-mix.json`. **Not yet run.**

### Still open for item 2

- The live check and the live retry spec on the new question shape run in
  CI on this push.

