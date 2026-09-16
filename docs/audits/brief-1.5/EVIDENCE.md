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

## Item 3 — Practice labels

### What changed

- **Routing** records which round a Shape C block opens with
  (`route.firstPracticeRound`), and names the method after it:
  - `L4.practice.practice_test.deadline_within_3_days`: a practice block whose
    plan deadline is 0–3 days away opens with a **Practice Test**;
  - `L4.practice.interleaved_review.related_topics_passed`: otherwise, if two
    or more prerequisite-linked topics have each passed once, an
    **Interleaved Review**;
  - `L4.practice.active_recall.default`: otherwise **Active Recall**;
  - `C7.practice_test_over_interleaved`: recorded when both could fire;
  - `L4.practice.error_repair.after_missed_round`: always recorded for Shape C.
    Any round after a miss is **Error Repair**.
- **Each label is a different round, not a relabel.** The practice request
  carries `roundKind`, and the model gets different framing:
  - **Practice Test:** exam-style, and eight questions regardless of the
    profile's usual cap.
  - **Interleaved Review:** the key points of the passed related topics, mixed,
    with questions that force deciding which idea applies.
  - **Error Repair:** built only from missed points. `repairTargets` carries each
    missed question, the answer chosen and the correct answer, and the model
    targets the same reasoning error in a new question.
- **Routing input:** `routingInputForSession` adds `daysToDeadline` and
  `passedRelatedTopicIds` from the plan and the learner's completion records.
- **Learner-visible:** the question card reads "Error Repair round. Recall
  question. No source shown." and carries `data-practice-round`. The method line
  names the opening round ("Method: Practice Test").

### Decisions taken

| Question | Decision |
|---|---|
| Practice Test vs Interleaved when both fire | Practice Test (founder-approved): the exam comes first. Recorded as `C7.practice_test_over_interleaved`. |
| Learn blocks | A learn block's first round uses the questions generated with its explanation and stays Active Recall. Practice Test and Interleaved Review fire on practice blocks only. |
| Past deadline | No Practice Test once the deadline has passed. |
| "Passed once" | A completion in which every checked key point for that topic was secure. |
| "Related" | The session's topic plus topics linked to it by a prerequisite in either direction (Brief 2's topic relationships will replace this, per the brief). |
| What an Interleaved Review sweeps | The key point texts from those clean completions, ids `t{topic}k{n}`, deduplicated, at most eight. |
| Error Repair on a two-point question | One repair target per missed question, keyed to its first key point; both points are still outstanding. |
| Known limitation | An Interleaved Review's outcomes are recorded against the session's topic, because completion evidence is per session topic. Noted for Brief 2. |

### Red — before

`practice-rounds.test.ts` failed to import (module missing). **11 failed** in
routing, route-for-session and the slot generator: no practice round kinds,
no deadline or passed-topic input, and no per-kind framing, counts or repair
targets.

### Green — after

- Full unit suite: **4229 passed**, 93 skipped. `tsc` and `lint` clean.
- Focused local browser case (mocked Shape C session): **1 passed**, now
  asserting "Active Recall round." on round one, and `error_repair` plus
  "Error Repair round." on round two.

### Live samples (gate: every label firing, with its rule ID)

`e2e/baseline-practice-retry.live.spec.ts` now runs 8 live cases on desktop and
mobile against the real model, each asserting the round kind on screen, the
rule ID on the session, and the round kind the server received, with a
screenshot per label:

- **Active Recall → Error Repair:** the one- and two-point retries. Error Repair
  carries its repair targets.
- **Practice Test:** a practice block due in two days. Eight questions,
  "Method: Practice Test".
- **Interleaved Review:** a practice block whose topic and its prerequisite
  each passed once. The request sweeps key points from both topics.

**Not yet run.** CI runs them on this push.

## Item 4 — Topic difficulty

### What changed

- `topic-difficulty.ts`: **prerequisite depth** is the number of distinct
  topics that must precede this one, transitively, ignoring removed topics and
  surviving a cycle. **Score** is subtopic count plus prerequisite depth.
  **Bands:** low ≤ 2, medium 3–5, high ≥ 6. It is never a model rating and never
  description length.
- **Routing** records `L4.difficulty.<band>` for every session. The high band
  sets `questionTarget` and `questionCap` to 8
  (`L4.difficulty.high.more_questions`). When that raises a session-length or
  shorter-sections clamp, it records `C8.difficulty_over_question_clamp`.
- **Round size:** the first round's question count and derived key points come
  from `questionTarget`. A Practice Test still asks eight.
- **Routing input:** `routingInputForSession` passes the topic's subtopic count
  and its prerequisite depth from the knowledge map.
- **Not shown to the learner** (founder decision). The band appears only as the
  number of questions.

### Decisions taken

| Question | Decision |
|---|---|
| The function | `subtopicCount + prerequisiteDepth`, bands at 3 and 6. In the fixture plan's ten-topic chain, depth alone makes the seventh topic onward high. |
| High band vs a shorter-sections clamp | The brief says "cap raised from clamp to 8", so the high band wins, and the conflict is recorded (`C8`). |
| Item 7 tension | Item 7 says every fired rule is visible somewhere; item 4 says difficulty is not shown. The visible effect is the longer round. The band and its rule stay hidden, per the founder decision. Raised for the founder. |

### Red — before

`topic-difficulty.test.ts` failed to import. **5 failed** in routing,
route-for-session and the generator: no band, no difficulty input, no
eight-question round.

### Green — after

- Full unit suite: **4246 passed**, 93 skipped. `tsc` and `lint` clean.

## Item 5 — Examples-first honesty

### Before

Q5 `concrete_example` / Q10 `examples_before_ready` add a step before the
learner produces:

- **With the learner's material:** the step had no learn block, so it listed the
  two direction sentences.
- **Without material:** it listed the explanation's outline.

Neither is an example. The end note then said YOVA had shown one.

### Decision: render a real example, or claim none

- **No material:** the learn-block call (Slot 2) returns `example`, the
  explanation's own concrete example restated as a title and steps, in the same
  call. The step shows it, labelled "From the explanation."
- **With material:** the direction call (Slot 1) is sent the learner's excerpts
  and returns `example` taken only from them, or null. The step shows it,
  labelled "From your material."
- **No example:** when the direction template stands in, the material has no
  readable text, or the model finds no example, the step says "No worked
  example to show for this material." and the note falls back to the next rule.
  Nothing claims an example.
- **Note wording:** "…YOVA showed a worked example before asking you to
  produce."

### Standing rule added

`06-STANDING-RULES.md`: never claim a personalization that did not happen.

### Red — before

**5 failed:** the note always claimed the example; learn blocks and directions
had no example field; the template could not say "none".

### Green — after

- Full unit suite: **4250 passed**, 93 skipped. `tsc` and `lint` clean.
- Focused local browser case (mocked Shape A examples-first session): **1
  passed**. The worked example is visible with "From the explanation.", and
  the end note claims the example.

### Not covered in the browser

The "no example" screen, for a source with no worked example, is covered by
unit tests of the note and slots, not by a browser case.

## CI run 35110929012 (5ea9d9a: items 2–3)

- **Green steps:** unit, migrated database tests, migrated route test,
  TypeScript, build, core learner journey, baseline session journey, public
  authentication, Study Profile comparison.
- **Live question-type mix (item 2, new):** both conceptual cases **PASS**
  against the real model (learn block, and practice from a study-guide
  excerpt): non-recall questions present, two-point types spanning two key
  points, no question restating a key point.
- **Live baseline practice (items 1 and 3):** the step passed (1m 41s). The
  per-case count could not be read from the job log viewer, so the workflow
  now writes "N passed, N skipped" to the run summary and fails on any skipped
  live case. The next run confirms all eight cases individually.
- **Regression gate: BLOCKED on one case.** The live "streamed World War I
  session skeleton" test passed on retained main and failed once here. Its
  import graph (88 modules) reaches none of the files this branch changed, so
  it is FLAKY under the standing rules, not a regression. Backlogged.

## CI run 35118646914 (542d3af: items 4–5 and the live-count guard)

- **Live baseline practice:** all eight cases passed, with none skipped. The workflow now reports the count on the run page: "Live baseline practice: 8 passed, 0 failed, 0 flaky, 0 skipped".
  - This confirms each case individually for items 1 and 3: the 1-point and 2-point retries on desktop and mobile, Practice Test, and Interleaved Review.
- **Regression gate against retained main (00995f1):** "No regression versus main", so the gate is PASSED.
- **Full live gate step:** the raw step went red on intermittent live cases. None is a regression versus main, and the standing rules block only on a regression.
- **Every other step:** green.

## Item 6: the session hub (frame 3A)

### What changed

- **Layout:** `src/components/baseline-session.tsx` now renders the handoff's hub:
  - header;
  - briefing strip (method, what it is, the four instructions, "chosen because" pills);
  - the step card;
  - a sticky right rail with the YOVA tip, the timer, the session shape, today's target and your source.

  The components live in `src/components/session-hub.tsx`, styled in its CSS module with the codebase's tokens. The state machines and slot requests are unchanged.
- **Rail rows and timer:** derived in `src/lib/session-shapes/session-hub.ts`; there is no new progression state.
- **Reasons:** pills, tip reasons and the end note all read from `src/lib/routing/rule-evidence.ts`. Every entry is a template on a rule in `route.ruleIds`.
- **Tips:** `src/lib/session-shapes/session-tips.ts`.
  - Each slot call carries `tips`: the steps it writes for, plus that step's fired-rule reasons.
  - The model writes an instruction plus one sentence of reason and names the `ruleId`.
  - The server keeps a tip only for a requested step, on an offered reason. Otherwise it uses a template tip, whose body is the evidence sentence itself.
  - The screen shows a tip only if its rule is in `route.ruleIds`.
  - The handoff table goes into the prompt as style exemplars.
  - Tips never get a call of their own:

    | Call | Tips it writes |
    |---|---|
    | study (Shape A) | study, produce |
    | study with questions (Shape C, Active Recall hand-off) | brief/study, questions, round, end |
    | compare | compare, repair, end |
    | practice | questions, round, end |
- **Explanation on reveal:** for `simpler_repeated_instructions` (instruction style `plain_restated`), question explanations are asked for in at most 20 plain words. Over 25 words is refused and retried.

### Red, then green

| Test | Red (before implementation) | Green |
|---|---|---|
| `src/lib/routing/rule-evidence.test.ts` (5) | module missing, file fails | 5 pass |
| `src/lib/session-shapes/session-tips.test.ts` (7) | module missing, file fails | 7 pass |
| `src/lib/session-shapes/session-hub.test.ts` (7) | module missing, file fails | 7 pass |
| `src/lib/openai/shape-slot-generator.test.ts`: tips in the same slot call (5), plain explanations (1) | 6 failed | 36 pass |
| `src/lib/routing/personalization-delta.test.ts`: different tips, on rule IDs | imports the new tips module (red on 542d3af) | 7 pass |
| `e2e/baseline-session.spec.ts`: hub assertions in Shape A and Shape C; phone fallback case | no hub on 542d3af | Shape A case passed locally, desktop and mobile; full journey runs in CI |

Personalization delta gate: profile 1's tips sit on rules `L3.q5.concrete_example`, `L3.q6.map_it`, `L3.q6.map_it`, `L4.q9.simpler_repeated_instructions` and `L4.q10.forget_during_tests`. Profile 2's sit on `L3.q5.try_then_feedback`, `L3.q6.explain_back`, `L3.q5.try_then_feedback`, `L3.q6.explain_back` and `L4.q2.minutes_45_60`. The tip text differs on every step.

**Live, side by side:** `e2e/baseline-hub-profiles.live.spec.ts` runs both delta profiles through the same Study Now topic against the real model. It screenshots every step with the hub and fails if a tip's rule did not fire. Results are recorded below once CI has run.

### Decisions taken

- **Open question, timer hidden scope:** session-scoped, as the brief decided. Hide, +5 and pause live only in the session screen's state.
- **Newsreader in the app surface:** approved by the brief; used as specified.
- **Shape toggle:** not shipped. The shape comes from `route.shape`.
- **Step rows:** display-only (hover tint only).
- **Change-method control:** shown enabled only before the first step is done and before anything is produced; afterwards it shows locked with the explanatory line.
  - It is not shown at all when the learner asked to be told exactly what to do (silent visibility): offering a choice would contradict that answer.
  - It is also hidden when there is no other method to switch to (for example, Shape C practice): a locked button there would claim a choice existed.
- **Briefing strip:** a new component, not a restyle of `study-method-briefing.tsx`. That component renders the legacy `SessionMethodBriefing` record, which baseline routes do not have.
- **Per-step minutes:** the handoff's proportions (Shape A 10/8/3/4, Shape C 4/12/5) scaled to the route's timer so the rows add up to it. This is pacing guidance, not tracked time.
- **Active Recall hand-off (Shape A study, then questions):** the rail reads "Shape A · Study → closed-book questions", with rows Study, Closed-book round N, Round review, Session complete.
- **No tip before any slot call has run:** for example, the first produce step of a try-then-feedback learner. No tip is invented.
- **"Chosen because" pills:** the profile, practice-round and question-mix reasons that fired. Topic difficulty is never a pill (founder decision on item 7; see below).
- **Timer status pill:** RUNNING / PAUSED / OVER. The handoff names only the OVER state.
- **Global `showTimer: false` setting:** none exists in the codebase, so none was added.
- **Source card actions:** the handoff says the no-material version drops them; the codebase has none for either case, so none are shipped.
- **Today's target:** `session.objective`. For baseline sessions this is also the coverage focus, and `BaselineSession` receives no coverage record.
- **Exit button:** reads "Exit session", per the handoff.

### Mobile fallback: UNDESIGNED

Below 1100px the rail drops under the step card in a single column, and the four instruction cards become two (one below 640px). The layout is functional, not designed, and needs a proper design pass.

`e2e/baseline-session.spec.ts` checks at 390px that:
- the page has no horizontal overflow;
- the rail sits below the card.

Its screenshot is `hub-mobile-fallback-undesigned.png`.

### Found in passing, then fixed at the founder's request

**The bug:** try-then-feedback learners stalled at Compare. They produce before studying, and the comparison was only requested when produce led straight into Compare. Nothing requested it when they arrived from the study step.

**The fix:** `entersCompare(previous, next)` in `src/lib/session-shapes/shape-a.ts` names the one moment to request the comparison. Both submit-produce and continue use it.

| Test | Red | Green |
|---|---|---|
| `src/lib/session-shapes/shape-a.test.ts`, "when to request the comparison" (3) | 3 failed (no trigger existed) | 15 pass |
| `e2e/baseline-session.spec.ts`, "a try-it-first learner produces before studying and still gets the comparison" | Failed locally at the comparison: `expect(locator).toContainText("you didn't mention the proton gradient")`, element not found | Passed locally, desktop and mobile |

The live two-profile hub run now takes profile 2 through the full session as well.

## Item 7: reasoning visible everywhere it was decided

### Founder decision (16 Sept 2026)

The topic difficulty band stays hidden, and its effect (the question count) is visible. The brief's item 7 is amended to say so.

### What changed

- **One source for every reason:** `src/lib/routing/rule-evidence.ts`, feeding three places:
  - the hub's "chosen because" pills;
  - the reason half of each tip;
  - a new end receipt, "Why this session ran this way" (a collapsible list on the Session complete card).
- **Receipt coverage:** it names every rule in `route.ruleIds`, one sentence each, except `L4.difficulty.low|medium|high`.
  - For a high-difficulty topic it says "Practice on this topic asks eight questions per round." That is the effect, without the band.
  - The question card's "QUESTION 1 OF 8" shows the same effect during the session.
- **Sentences added for every rule that previously had none:**
  - task-type shapes (Layer 1);
  - placement entry (Layer 2);
  - default and conflict rules (C1, C3, C4, C5, C6, C8);
  - session-length and focus bands;
  - energy window;
  - long-plan shutdown;
  - the resolved timer;
  - guidance defaults;
  - a learner's own method change.

  These appear on the receipt only, so the hub strip stays readable.
- **Examples-first learner shown no example:** the receipt keeps the rule visible with an honest sentence ("YOVA looked for a worked example, but there was none to show this time"). The end note and tips still never claim an example (item 5).

### Red, then green

| Test | Red (before implementation) | Green |
|---|---|---|
| `src/lib/routing/rule-visibility.test.ts` (5) | 4 failed (no receipt, no hidden-rule list) | 5 pass |
| `e2e/baseline-session.spec.ts` Shape A and Shape C: the receipt names every fired rule except the hidden band, and never says "difficult" | no receipt on 83d0411 | runs in CI |

The route sample in `rule-visibility.test.ts` covers:
- every single onboarding answer, three stacked profiles and the empty profile;
- every task type, both block kinds, all four placement states, with and without a source;
- deadline, interleaving and difficulty contexts;
- every learner method change.

That is more than 20,000 routes, each checked with an example shown, not shown and not yet known. No fired rule is left unnamed.

### Decision taken

- **Receipt starts collapsed:** it can hold fifteen or more sentences, and the end card's job is the note and what's next. The personalization note stays open above it.

## Item 8: the pre-session screen

### What changed

- **Start** on a plan block opens one card, then the hub:
  - topic, block type and time;
  - method with one line of why and a Change link;
  - source ("Review …", or "YOVA will teach this") with Add material;
  - "I've already covered this";
  - Study inside / outside YOVA;
  - Start.

  The early-start dialog ("Start now, keep dates") still comes first when a block is ahead of schedule, as before.
- **Add material** and **I've already covered this** open the same plan revision the plan screen uses (`LivingPlanRevision`: preview, Confirm changes, receipt, Undo).
  - A covered report is recorded as learner report, not evidence, and routing makes the block practice.
  - A file attached to the topic now supplies the source description and excerpts: `baselineSourceForTopic` previously ignored attached files, so an attached file could never flip a block to the source path.
- **Outside YOVA** (`withStudyOutside`, rule `L5.learner_study_outside`) turns a learn block into a directions card, then "I'm back", then closed-book practice.
  - No produce step and no AI explanation run.
  - The directions card shows the method (named, what it is, why it fits: the fired-rule note), what to study (Slot 1: specific when located, honest when not, the learner's own textbook or notes when there is no material), how to approach it, and suggested time.
  - Decisions that only the inside path carries out (produce step, worked example first, produce before study, the Week 2 worked-example source) are dropped from the route, so no tip, note or receipt claims them.
  - Practice blocks and blocks already skipping to practice have no outside choice.
- **Loading:** the hub renders at once, and the step card says "Writing your explanation…", "Writing your directions…" or "Writing your questions…" until the slot returns. There is no loading screen. A failure shows the honest error with Try again on the step card.
- **Study Now** is one screen: what to study, optional material, inside or outside. Continue builds the one-session plan on that screen, then the same card, then the hub. That is two screens for Study Now and one for a plan block.
- **Returning mid-session:** the session saves where the learner is as they go (per account, in this browser; `baseline-checkpoint.ts`). Start on that block reopens the same step with no card and no repeated generation. Finish clears it.

### Deleted

- **Components:**
  - `SessionSetup`, the three setup screens: session direction, "Has anything changed?", "Set the pace for today".
  - `SessionLoading`.
  - The Study Now review and loading steps.
- **Stages:** `session-setup` and `session-loading`.
- **Start path:** the generated-runtime start path in `startSession`, about 650 lines.
- **Recovery:** the setup-review recovery action.
- **Setup-only modules and their tests:**
  - `src/lib/session-setup/objective-copy.ts`
  - `src/lib/personalization/session-support.ts`
  - `src/lib/personalization/session-decision.ts`
  - `formatSessionPreparationTopic`
- **Check before deleting — nothing on them routes to anything the shapes use.** A read-only search found no import from `src/lib/session-shapes`, `src/lib/routing` or `baseline-session.tsx` into the setup screens, the loading screen, the adjustment helpers or `SessionAdjustment`.
  - What those screens set (familiarity, known targets, support level, available minutes, a note, a committed-method change) fed only the generated runtime's `/api/sessions/generate` request.
  - Their nearest baseline equivalents are the plan (mark covered, attach material), the hub timer (+5, Hide) and the card's Change.

### Tests retired with the runtime they drove

Every Start now opens the card and a baseline session, so these cases could not run as written. Each walked the setup screens, the loading screen or generated lessons.

They are named in `scripts/live-gate/retired-cases.json`. The regression gate excuses only their absence: a retired case that still runs and fails is judged like any other.

- **`e2e/core-learning-loop.spec.ts`** (34 cases):
  - Study Now lets the learner review and safely choose an eligible method before activation
  - Study Now discloses omitted scope before starting and lets the learner change time
  - durable allowance exhaustion loads the committed method workpad and names the reset
  - durable allowance exhaustion without a safe fallback has its own non-retryable state
  - streamed lesson quota uses its built-in explanation and surfaces the reset
  - a confident misconception is repaired now without a duplicate follow-up
  - Practice Problems starts with an unsupported written attempt, repairs a miss, then changes context
  - a support request keeps the committed practice recipe when fallback generation fails
  - an inactive-plan generation response cannot open a stale built-in lesson
  - a visibly shortened inside recipe keeps its method in the fallback workpad
  - a built-in fallback never ignores a learner's custom session requirement
  - a new topic is taught before YOVA asks for independent performance
  - a World War I beginner receives real teaching and a direct model answer
  - an opaque class label is stopped until the learner names the actual calculus concept
  - a teaching-first inside outage does not start with unsupported recall
  - a temporary AI failure loads a subject-specific startup funding lesson
  - outside study gives a concrete source-based session instead of pretending YOVA owns the content
  - an arbitrary outside method workpad completes as practice without changing topic evidence
  - a fallback method workpad resumes its timer and checked targets after reload
  - a 10-minute outside teaching-first session loads its built-in method lesson
  - an overdue outside teaching-first session splits into runnable 10-minute parts
  - an overdue arbitrary inside session splits and loads a route-faithful 10-minute workpad
  - a learner can stop twice without losing progress or earlier evidence
  - a lesson and its reopened model teach every fact required by the glycolysis recall check
  - a resumed streamed question can reopen its prior lesson by persisted activity index
  - a refresh recovers semantic progress without saving draft answers or inventing an interruption
  - a saved first-step recall round resumes at the next prompt without persisting draft text
  - learner text fields keep long pastes visible and block submission until trimmed
  - spent guided-session allowance is visible before Home or Calendar opens setup
  - spent allowance still permits a saved session to continue
  - the session tutor stays anchored to the exact learning activity
  - finishing a shortened guided lesson keeps every deferred target as exact next work
  - scheduled-review setup stays fixed and opens the exact active or Study Now goal
  - session setup changes one committed method and generates from its exact successor route
- **`e2e/plan-launch-live.spec.ts`:** "a live-generated deadline lesson streams, finishes unrated and preserves completion on reload" (desktop and mobile).
  - The live gate runner no longer runs a browser journey.
  - The pinned required-case count moves from 75 to 73, and `cli.test.mjs` now requires the retirement to be named.
  - The live browser journeys for the baseline path run in their own CI step (practice retries, the two-profile hub, outside YOVA).
- **Removed source-text contract assertions** about the retired start code, in `yova-prototype-ui-contract.test.ts`:
  - session setup labels;
  - scheduled-review setup;
  - committed-route setup controls;
  - ready-session method control;
  - pre-start recipe;
  - generation fallback classification;
  - generation operation id reuse;
  - the old start-path lines in two other checks.

  Also: the setup-review action expectation in `yova-prototype.session-error.test.ts` (now asserted absent), and the Study Now duration picker in `typography-contract.test.ts`.

### Adapted, not retired

- Home recommendations and Add to YOVA's one-off session: create through the new Study Now, then leave the card.
- Material upload UI: the dropzone is on Study Now's first screen.
- Add to YOVA's outside assignment: it preselects Outside YOVA.
- The founder revision journey: completes its first session as a baseline session with mocked slots.

### Red, then green

| Test | Red | Green |
|---|---|---|
| `session-route.test.ts` outside YOVA (4), `shape-a.test.ts` (1), `session-hub.test.ts` (1), `shape-slot-generator.test.ts` outside directions (3) | 9 failed | pass |
| `baseline-checkpoint.test.ts` (3) | module missing | pass |
| `source-context.test.ts` attached files (2) | 2 failed | pass |
| `scripts/live-gate/regression.test.mjs` retired cases (1) | failed (absence blocked) | 25 pass |
| `scripts/live-gate/cli.test.mjs` canary pin | failed on the deleted spec | pass, pin updated with the named retirement |
| `e2e/baseline-pre-session.spec.ts` (7) | the card did not exist | unsourced case passed locally; all run in CI, desktop and mobile |
| `e2e/baseline-outside.live.spec.ts` (live, both viewports) | new | runs in CI |

### Gates

Recorded after CI:
- Start, then the card, then the hub, desktop and mobile, for sourced, unsourced and covered blocks.
- The outside path, live, both viewports, with no produce step or explanation.
- Study Now in two screens.
- Resume on the same step.

### Decisions taken

- **Covered switch:** turning it on opens the plan's revision preview. The receipt's Undo turns it off. A topic already marked covered on the plan shows the switch on and locked there, since its undo lives on the plan.
- **Outside method:** Active Recall, because outside practice is closed-book questions. Change is hidden outside YOVA.
- **Suggested time:** the route's timer.
- **The hub's in-session method chooser:** no longer opens before the work, because the card already offered the choice. The hub's Change control stays for the first step.

## CI run 35141671600 (711435d: item 7)

- **Baseline session journey:** 8 passed and 2 failed, the same case on both viewports: "a memorization learn block runs Shape C closed-book…".
  - Cause: strict mode violation on `getByText("No source shown.")`. The hub rail's Closed-book round blurb repeated the question card's "No source shown.", so the text appeared twice.
  - A real item 6 defect. Fixed: the rail now reads "Closed-book: answer from memory."
- **Live baseline practice:** all 8 retry and label cases passed.
  - The live two-profile hub run failed for P1: no session appeared within 120 seconds through the old Study Now flow, so P2 and the comparison did not run.
  - Item 8 replaces that Study Now flow; the run repeats on the item 8 commit.

## Item 8 follow-up: allowance and scheduled reviews (founder decisions, 16 Sept)

### Allowance: enforced on the pre-session card

- **At the limit:** the card shows the limit message instead of Start.
  - Exhausted: "You have used today's guided sessions", with the server's reset time.
  - Paused: "Too many sessions started in a short time".
- **Otherwise:** nothing about the allowance is shown anywhere, and never a count. Start is held (disabled, no message) only during the first server check.
- **Home and Calendar** no longer disable Start, relabel it, or show the allowance notice.
- **Study Now** is no longer disabled; its card enforces the limit.
- **Saved sessions:** a session saved mid-way reopens on its step without the card, so it can always continue, as before.
- **The server** still refuses AI slot calls past the limit, as before.

Tests:

| Test | Red | Green |
|---|---|---|
| `guided-session-allowance-notice.test.ts` (4), `pre-session-card.test.ts` (3) | no card enforcement, no limit message | 7 pass |
| `e2e/baseline-pre-session.spec.ts`, "at the allowance limit the card shows the limit instead of Start, and a saved session still resumes" | new | passed locally (desktop); CI both viewports |

### Scheduled reviews: left functional

- A scheduled review (`learningMode: "study"`, `reviewType`) routes as a practice block and runs closed-book practice through the card.
- **Fixed:** activating a review from the agenda started "the next ready session" rather than the review itself. It now starts the review session by id.
- **Test:** `e2e/baseline-pre-session.spec.ts`, "a scheduled review opens the card as a practice block and runs closed-book practice". It runs in CI.
- **Not kept:** the retired setup screen's fixed three-question contract. Reviews become Brief 2's practice blocks (backlog).

