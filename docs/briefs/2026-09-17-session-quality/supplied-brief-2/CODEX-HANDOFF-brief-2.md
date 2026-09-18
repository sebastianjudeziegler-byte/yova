# Handoff to Codex - Brief 2

Paste this as the first message. The two attached files replace the versions
in docs/redesign/.

---

You are taking over Brief 2 from Claude Code. Nothing of Brief 2 has been
built. Read this whole message before acting.

## Files first

Two files are in Downloads: `05-PLAN-MODEL.md` and `BRIEF-2-plan-model.md`.
Both replace the versions in `docs/redesign/` wholesale - do not merge them
with what is there. Commit and push to main.

Then read, in this order: `docs/redesign/00-SCOPE.md`,
`06-STANDING-RULES.md`, `05-PLAN-MODEL.md` in full, `BRIEF-2-plan-model.md`.
Then read `docs/audits/brief-1.5/EVIDENCE.md` and `docs/audits/brief-2/
EVIDENCE.md` - the first tells you what the session layer you are feeding
looks like; the second holds the diagnosis of every revision bug found so
far.

## What is live on main

Brief 1 (session shapes, routing, ID-keyed onboarding) - merged 11 Sept.
Brief 1.5 (practice fix, question-type mix, four practice labels, difficulty,
examples-first honesty, the session hub, visible reasons, the pre-session
card, outside-YOVA, Study Now rebuilt) - merged 17 Sept.
Three revision fixes: the missing migration, editedFields blank-vs-null,
Undo timestamp comparison (#94, live at eeb1ff9).

The old session runtime code still exists but is unreachable; the old Start
path and its screens are deleted. The old time-first plan composer is still
live - that is what Brief 2 replaces.

## The precondition is open - do it first

Undo still fails on production. Second cause, found 17 Sept: the change
builder omits `editedFields` when empty (`build-plan-revision.ts:204`); the
database stores an empty list; Undo compares stored copy against database,
sees omitted vs empty-list, refuses.

Fix exactly as #94 was fixed: own branch, a test against a real database
that reproduces it (make sure the fixture's changed session actually
carries the empty list - the last CI test missed it because it didn't), a
narrow fix treating omitted and empty-list as equal for this field, full CI,
PR, founder merges. Then redo the production check: change, confirm,
receipt, Undo, reload. Use a fresh topic - "Water Cycle Quiz Foundations" has
three topics stuck from failed undos.

Only when Undo holds on production do you start item 1.

## Two things the spec changed since the brief was first written

1. **Block length - section 1.** Blocks are estimated from content, capped by
   profile, AND filled to capacity. The founder had a 40-minute Active Recall
   session with fifteen easy questions that took five minutes. That must not
   happen: if a block's estimate is well under the learner's capacity, add the
   produce step, raise question count and transfer ratio, sweep in the next
   ready topic. Read the section; it is explicit.

2. **Every profile question routes to a plan-level effect - section 2.** Ten
   rows. Each needs a test that fires its rule and asserts the rule ID. That is
   a gate.

## Two things to investigate in item 1, from the same session

- "3 rounds of 5" on one topic. If round one passed clean, the topic should
  be done. If it missed points, round two should be Error Repair with only
  the missed points. Three full rounds suggests regeneration instead of
  narrowing. Find out which; if it is a bug, fix it in its own commit.
- "Really easy" questions on an Active Recall block. If the topic was
  memorization, the mix is mostly recall by design. If conceptual, the
  application/compare-contrast items should have appeared. Check the topic
  type and the mix that fired; report.

## Standing rules that have mattered most on this codebase

- Fixtures mock transport, not the shape of the model's answer. A test that
  hand-supplies what the prompt should have generated is not a test.
- Verification in CI, not on the founder's machine.
- Live gate blocks only on regression versus main. The raw live-gate step is
  red on main for known cases; the deciding step is "Gate on regressions
  versus retained main". Quarantine flakes with their history; never chase
  3/3 on unscoped cases.
- Never claim a personalization that did not happen. Every rule that fires is
  visible somewhere.
- Stop and ask at a boundary. Do not expand scope silently.
- One branch, one PR, do not merge, do not deploy, do not touch production
  settings.

## Report format

What changed, red/green evidence, what is open, what you deliberately did
not do. The founder is non-technical: plain English, no "fixed" without a
failing-then-passing test.
