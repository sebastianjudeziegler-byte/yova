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

### Still open for item 1

- **Live, unmocked verification** (one-point and two-point retries to
  completion, desktop and mobile): not yet run. Nothing live exercises the
  baseline practice path today — the live gate's browser half runs only
  `e2e/plan-launch-live.spec.ts` against a flag-off server.
