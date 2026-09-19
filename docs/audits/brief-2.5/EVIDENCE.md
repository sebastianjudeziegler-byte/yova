# Brief 2.5 - Plan model repair: evidence

Branch `plan-model-repair`, base main 843f7ee.

> **Blocker on the finding map.** The acceptance audit
> `docs/audits/2026-09-18-brief-2-production-audit.md` is not in the repository,
> on main, or in Downloads. The per-finding table (all 114, each fixed / design
> pass / founder action) is written against it once the founder supplies the
> file. The finding numbers below come from the brief.

## Root cause 1 - The word "test" deletes teaching (findings 1-7, 19, 21, 35, 37; 3)

**Cause.** `recommendLearningIntent` read test/exam/quiz/review/prepare/study
in the goal sentence as `intent: "study"`. `firstTargetDecision` gives a topic
with no placement evidence, no learner-report tick and status `not_started` the
plan intent, so every topic in every test-prep plan opened in practice
("Teaching skipped", zero learn blocks).

**Fix.** `src/lib/learning/learning-intent.ts`: the goal-word study signal is
deleted. Only the learner's own words can start a plan in practice: "already
learned/know/covered/studied", "need (more) practice", "test my recall",
"mostly reviewing", "skip the basics", "don't/do not/no need to teach|explain".
Everything else starts at `learn`. Placement `demonstrated`, learner-report
ticks and recorded encounters still set `study` per topic in
`firstTargetDecision` (unchanged).

| Test | Red before fix | Green after |
|---|---|---|
| `learning-intent.test.ts` "teaches first when only the goal mentions a test or review" (6 goals) | `expected 'study' to be 'learn'` | 39/39 |
| `plans/generate/route.test.ts` "gives every untouched topic a learn block for a test-prep goal" ("I have a biology test next Friday", "Prepare for my AP Biology Unit 6 test") | `expected 'study' to be 'learn'` | 63/63 |
| `plan-generation/test-goal-teaches-first.test.ts` - goal -> intent -> composer -> router; notes-backed topic routes `learnPath: "source"`, direction reads `Review Chapter 12 notes.pdf...`; the topic without notes routes `ai_explanation` (finding 3) | `first block for ...01: expected 'study' to be 'learn'` | green |
| `src/evals/test-goal-teaches-first.live.test.ts` (permanent live test: provider map + provider fill, two test-prep goals, every scheduled topic's first block is learn) | n/a (live) | runs in CI's live step on every push and in the nightly live gate (auto-discovered) |

**Tests that had encoded the bug.** Seven route mechanics tests (Study Now
timing, forty-minute workload, repeated outcomes, degraded baseline, metered
mapping, method prose, fixed structure) used a fixture whose starting context
said "I need the concepts taught from the beginning" yet expected practice
blocks - practice they got only from the goal words. They now carry explicit
learner evidence ("I already learned this and need practice."); their
assertions are unchanged.

**Residual risk (founder).** A plan drafted before deploy with
`learningIntent: "study"` from goal words alone will now fail activation's
intent consistency check (`schema.ts` reuses `resolveLearningIntent`) and must
be regenerated. Legacy plans are being deleted per the brief.

Full unit suite: 508 files / 4603 tests passed. Lint and typecheck clean.

## Root cause 2 - The scheduler places blocks after the deadline (findings 8-13, 32, 36, 62, 72)

**Causes found.**
1. `topic-plan-model.ts` searched availability with the deadline removed
   (`{...request, deadline: null}`), a year ahead, and only appended "...puts
   this suggestion after the deadline" to the plan (8, 9). The plan rubric
   exempted topic plans from "no work after the deadline" if that note was
   present, and five tests asserted the note - so CI blessed the bug.
2. "Most days" enabled positions 0,1,2,4,5 of the next seven days
   (`frequencyIndexes`), so a Friday start silently dropped Monday and
   Thursday: Fri/Sat/Sun/Tue/Wed (12). The Q8 banner "next available window is
   more than 24 hours away" (11) follows from the missing days.
3. Priority card (10): `buildDeadlinePriority` returned `null` when there was
   **no** window before the deadline. The five browser cases all put a short
   window before the deadline, so they passed; a deadline minutes away with
   evening-only availability returned no card and the plan was built from
   windows after the test. This is the path production took *by inference* -
   the audit file is needed to confirm the exact inputs.

**Fix.**
- Slots are searched only up to the deadline, and the validator now fails any
  block that ends after it (`a block ends after the deadline`).
- Fitting ladder when the work does not fit: (0) normal spacing; (1) learning
  blocks not spread one per day; (2) practice returns sooner; (3) shorter
  blocks, two per window, never under 15 minutes; then extra practice rounds -
  and, with the deadline within 3 days, first practice (first passes outrank
  returns) - are left out with the reason shown; then the lowest-priority
  topics are deferred (`deadline_capacity`) with the reason shown. Each step
  records the rule that fired; rules from discarded attempts are not recorded.
- Revisions never change scope on their own: a unit that does not fit is the
  existing "does not fit before the deadline. Move a block, shorten scope or
  add time." blocker.
- A deadline under ten minutes away with no window gets the priority card for
  the time remaining, starting now. A later deadline with no window is a 422
  naming the fix ("No study window falls before the deadline...").
- "Most days" is every day; the learner removes days.
- The plan view lists deferred topics: "Saved for later - <topic>: <reason>".

| Test | Red before fix | Green after |
|---|---|---|
| `deadline-enforcement.test.ts` 3-day deadline, zero blocks after it | 9 blocks after the deadline | green |
| `deadline-enforcement.test.ts` 8-day deadline, zero blocks after it | 6 blocks after the deadline | green (all six topics taught and practised, shorter blocks) |
| `deadline-enforcement.test.ts` 9-minute deadline outside every window -> priority card; composer refuses | `expected undefined to be 'deadline_priority'` | green |
| `study-schedule.test.ts` Most days is every day | `expected [0,1,2,4,5] to deeply equal [0..6]` | green |
| `deadline-enforcement.test.ts` Q8: first block within 24h, no banner | (passes once the days are right) | green |
| e2e `a deadline nine minutes away outside every study window is a priority card` (new) | - | CI |
| e2e `a 1-/3-day deadline places nothing after it and names what is saved for later` (replaces "retains the full queue...") | - | 3-day run locally: pass; CI for both |

**Tests rewritten because they asserted the bug** (each now asserts zero
blocks after the deadline and scheduled-or-deferred-with-reason):
`plan-creation-blockers.test.ts` (5 deadline cases and the half-used window),
`a18-capacity.test.ts`, `topic-plan-model.test.ts` "keeps the full queue..."
(split into first-passes and no-window refusal), two `generate/route.test.ts`
cases (now 422 `schedule_capacity`, no provider call), `revision-integrity`
(title and the after-deadline assertion). Three fixtures whose subject is not
the deadline got a longer deadline: provider fill beyond 24 envelopes,
session-cap topics, and the 28-block living-plan proposal. `plan-rubric.ts`
no longer exempts topic plans. `retired-cases.json` renames point at the new
e2e titles.

**Carried to later root causes.**
- RC6 (finding 113): the composer catch *consumes* the plan allowance on a
  capacity refusal (`consumeFailedPlanClaim`). More deadlines are now refused
  instead of producing a useless queue, so this matters more.
- RC3: `refreshTopicPlanMetadata` rebuilds constraints after an edit and drops
  the composer's "practice left out" notes.
- RC4: the personalization sentence can read "Blocks are spread across your
  available days" next to "Practice returns sooner than usual"; it is still
  stitched from every fired rule.
