# BRIEF 2.5 - Plan model repair

Branch: `plan-model-repair`
Base: current main (843f7ee, #97 merged)

Read `docs/redesign/00-SCOPE.md`, `06-STANDING-RULES.md`, `05-PLAN-MODEL.md`,
and the production audit that triggered this brief:
`docs/audits/2026-09-18-brief-2-production-audit.md`. That audit is the
acceptance test. Its 114 findings are six root causes. Fix them in this order,
because each one changes what the next looks like.

**Acceptance is not CI.** Acceptance is the audit re-run on production by a
different tool than the one that fixed it, and the verdict paragraph flipping.
CI green is necessary, not sufficient - CI was green when every plan had zero
learn blocks.

---

## Root cause 1 - The word "test" deletes teaching (findings 1-7, 19, 21, 35, 37)

`src/lib/learning/learning-intent.ts` `recommendLearningIntent`: a goal
containing test/exam/quiz/review/prepare/study sets `intent: "study"`. In
`initial-session-mode.ts` `firstTargetDecision`, a topic with no placement
evidence, no learner-report tick, and status `not_started` falls through to
`learningMode: intent`. So every test-prep plan, for every learner, routes
every topic to practice. `learnBlockCount` becomes 0. "Teaching skipped."

**Rule:** a topic starts as `learn` unless there is evidence about *the
learner* that it should not: a placement `demonstrated`, a learner-report tick,
a recorded encounter, or the learner explicitly saying they have already
covered it in the starting-context note. **The goal sentence is never
evidence about the learner.** Delete the goal-text study signal from the
fallback. Keep the explicit-phrase paths ("already learned", "need practice",
"mostly reviewing") - those are the learner talking.

Red first: "biology test next Friday", no placement, no ticks -> every topic
gets a learn block. Then verify the source path actually fires: a topic with
attached notes -> its learn block says "Review <file>..." and never generates
an AI explanation (finding 3).

This is the same bug Codex reported fixed on 7 Sept. It was fixed in the old
composer and inherited by the new one. Add a permanent live test so it cannot
come back a third time.

## Root cause 2 - The scheduler places blocks after the deadline (8-13, 32, 36, 62, 72)

Two visible causes:
- "Most days" is hardcoded to Fri/Sat/Sun/Tue/Wed (12). It must be every day
  except any the learner excludes.
- Nothing enforces "no block after the deadline" (8, 9). Spec section 7: a
  practice block never lands after the deadline; deadline close + topics
  unlearned -> first passes outrank returns. Both are absent.

**Rule:** no block is ever suggested after the deadline. If the remaining
work does not fit: compress spacing first, then defer lowest-priority practice
with the reason shown, then defer topics with the reason shown. Never a queue
of ten blocks after the test. With <10 minutes left, the priority card (10) -
it passed five browser tests and did not appear in production; find out why
the tests pass on a path production does not take.

Also: Q8 "starts late" -> first block within 24h (11). The banner "next
available window is more than 24 hours away" fired with Sat/Sun/Mon evenings
available - that is cause 2's hardcoded days again.

Red first for each: the 9-minute deadline, the 3-day deadline, the 8-day
deadline. Assert zero blocks after the deadline in all three.

## Root cause 3 - Editing disagrees with itself (16, 17, 18, 64)

Undo hung >60s then did not survive reload. A date-move undo restored the
previous *method* change. Receipts say "everything else unchanged" while
renaming, re-methoding and re-dating the block. A deadline change rewrote
every block to Concept Mapping.

**Rule:** one revision = one delta, applied once, receipt generated from the
delta not hand-written. Undo restores exactly that delta. Deadline change
re-spaces remaining practice dates and touches nothing else (spec section 5).
The byte-identical unchanged-sessions test must cover *every* inline action.

Red first: mark covered -> undo -> reload -> restored. Move date -> undo ->
reload -> restored, method untouched. Change deadline -> only dates changed.

## Root cause 4 - Personalization text is canned (20, 21, 72, 75, 78, 106, 107, 109)

Nine stitched sentences, including "dense topics stop at three learning
blocks" on a plan with zero learning blocks, and "a 11-minute". Home reads a
legacy 11-question questionnaire. The profile page shows two questionnaires
and developer notes ("Layer 4: timer one band down...").

**Rule:** the sentence is generated from rule IDs that fired, in "because you
said X, YOVA did Y" form, and nothing else. One questionnaire. No developer
notes in learner-facing copy. Q6 and Q7 must be captured at onboarding (109:
they were "not answered" on the founder's own account).

## Root cause 5 - Source assignment defaults wrong (14, 22, 23)

With a study guide and a PDF uploaded, every topic pre-selected the study
guide. That sends every topic down the scope-outline path. And document-
referential questions ("from the notes", "fits the notes") still appear.

**Rule:** pre-selection prefers `content_source` over `scope_outline` when
both exist. Rule 2 from spec section 8 is not enforced; enforce it. The
existing "Unit 6 test scope / Unit 6 concept explanations" plan (22) is the
Sept 7 bug live in production - it must not be reproducible.

## Root cause 6 - Infrastructure (24, 25, 26, 113)

Placement "unavailable", Study Now 503, `/api/errors` 503, planning
allowance exhausted at 5 plans with the wrong step named. Find whether these
are one provider/outage cause or four. `/api/errors` returning 503 means
client errors are not being recorded - fix that first, it is how you would
have seen the rest.

---

## Explicitly NOT in this brief

The UI findings (sections 4, 5, 6 UI items - native selects, raw ISO
timestamps, glued labels, receipts above the header, desktop cards on mobile).
That is a design pass, separate, against the screens once they work.

Legacy plans (86, 92, 100, 101): founder deletes them in Supabase.

## Gates

- Every root cause: red-first test that reproduces the audit finding.
- Full CI, regression comparator, live gate.
- **Then the audit re-run**, on production after deploy, by Codex, same three
  profiles, same materials. Section 1 verdict must read: learn blocks exist,
  profile changes shape, nothing after the deadline, undo holds.

## Deliver

PR with EVIDENCE.md mapping every audit finding number to: fixed (with test),
design pass (deferred), or founder action. No finding unaccounted for.
