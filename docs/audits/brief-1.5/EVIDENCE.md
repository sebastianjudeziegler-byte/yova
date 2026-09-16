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
