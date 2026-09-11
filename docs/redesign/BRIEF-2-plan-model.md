# BRIEF 2 - Plan model

Branch: `codex/baseline-plan-model`
Base: current `main`, after PR #88 (Brief 1) has merged. Do not start before.

Read `docs/redesign/00-SCOPE.md` and `06-STANDING-RULES.md` first - both govern
this brief. Then `05-PLAN-MODEL.md`, which is the specification. `01`-`04`
describe the session layer this plan feeds.

## Why

Brief 1 fixed what happens inside a session. The plan that decides which
sessions exist is still the old time-first composer: it takes free time, cuts
it into slots, and fits content into boxes. That is the source of stacked
micro-sessions, duration-follows-slot-size, and the capacity errors. It also
means the learner's profile changes nothing about the plan's shape.

## PRECONDITION - do this first and report before building

**Diagnose plan revision.** The founder reports that revising a plan "just
doesn't work at all, even though it says it does", in the deployed app. Brief B
shipped Tuesday with a passing browser journey for exactly that (mark covered,
attach source, confirm, undo) plus a byte-identical unchanged-sessions test.

Reproduce it as a learner on production. Either the tests pass on a path users
do not take, or it regressed after merge. **Report what you find before writing
any Brief 2 code.** Section 8 of the spec (falling behind) depends on revision
working, so this is a precondition, not a side quest.

## Scope

### 1. Block sizing (Option C) - spec section 1
`blocksForTopic = clamp(ceil(topicWeight / learnerCapacity), 1, 3)`.
Topic weight from subtopic count, intrinsic load, prior knowledge. Capacity
from Q2/Q3/Q9/Q10. Splits on subtopic boundaries only; topics without
subtopics are never split. Practice blocks are never split. When a topic would
need more than 3 blocks, record that the map mis-sized it.

### 2. Replace the time-first composer - spec sections 4, 7, 8
Blocks are topic-sized. The timer is a profile nudge, not a boundary. Dates are
suggestions that can slip. The deadline is guidance and **must never throw** -
reuse the Sept 7 degrade ladder and the deferral notices that already exist.

**Delete the time-slicing composer as part of this brief**, not later. Nothing
is deleted until its replacement passes the same tests the old one did. List
every module removed and what replaced it.

### 3. Level 2 personalization - spec section 2
Block count and practice rounds vary by profile. Ordering is prerequisites
first, then material order, nothing else. Do not implement Level 3 or 4.

### 4. Visible personalization - spec section 3
Plan header and topic headers state what the profile changed, built from rule
IDs, never hand-written prose. Rule: if a routing rule fired, the learner can
see it somewhere.

### 5. Placement opt-in and the topic ticker - spec section 6
Placement never opens automatically. Offered before generation with an obvious
skip, and skippable per question. The topic ticker lives in plan editing and
sets `mark_covered` (learner report, never demonstrated evidence). Default with
neither: every topic teaching-first.

### 6. Materials: the two hard rules - spec section 9
**This is the bug that burned the founder. Treat it as the brief's headline.**
A `scope_outline` chunk contributes topic titles and nothing else, and never
reaches a generation call as content. A topic sourced only from scope-outline
takes the no-source path. Reject document-referential questions. Add the
permanent live test: upload a study guide, generate a session, assert no
question references the unit, the guide, or its goals.

### 7. "What YOVA understood" screen - spec section 10
After upload, before generation. Three states: saved / read / usable. The data
exists already; it has never been shown.

### 8. Plan screen grouped by topic - spec section 12
Topic headers with blocks nested, checkmark per topic, collapsed variant for
`long_plan_shutdown`.

### 9. Materials per plan or per topic - spec section 5
The learner chooses at upload.

### 10. Falling behind - spec section 8
Say something, offer a concrete restructure as an editable preview. Depends on
the precondition.

### 11. Archive on completion - spec section 13

## Out of scope

Shape B, ingestion formats beyond what exists, syllabus import,
natural-language anything, cross-plan memory, Level 3/4 personalization,
adaptive routing, the paywall. If a change wants to alter Brief B's revision
pipeline beyond fixing the precondition, stop and ask.

## Gates

- Personalization delta test extended to plans: two contrasting profiles, same
  unit, same materials - assert **different block counts** and different
  practice rounds, on rule IDs.
- Study-guide test from item 6, permanent, in the live gate.
- Existing create -> activate -> open session -> complete passes unchanged.
- Brief B byte-identical unchanged-sessions test still passes.
- Full gate in CI. The regression comparator now runs on every branch and has
  three outcomes; **inconclusive blocks the merge too** - re-run, do not
  interpret.

## Deliver

PR with `EVIDENCE.md`: the precondition finding first, then red/green per item,
two contrasting profiles' full plans side by side, the study-guide test output,
and the list of deleted modules with what replaced each.
