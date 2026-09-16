# BRIEF 1.5 - Session hub, practice depth, and Brief 1 fixes

Branch: `baseline-session-hub`
Base: current `main` (a1eabea or later)

Read `docs/redesign/00-SCOPE.md` and `06-STANDING-RULES.md` first - both govern
this brief. Then `01-SESSION-SHAPES.md`, `02-ROUTING.md`, `04-AI-SLOTS.md`, and
the design handoff `docs/redesign/design/session-hub-3a.md` with its prototype
`Session Hub.dc.html` (frame 3A only).

Brief 2 (plan model) stays on hold until this merges.

## Why

Three findings from the 11 Sept live browser audit of Brief 1, plus the
founder's own use:

1. **Practice breaks on the ordinary case.** Miss one or two questions, round
   two returns 502 twice. The retry prompt says "one question per outstanding
   point"; the composer requires at least three. The mocked fixture hides it by
   hand-supplying three questions.
2. **Questions are correct but shallow.** 9/9 on-topic, 0/9 requiring transfer.
   Every question restates the notes.
3. **The session screen is nearly empty and claims personalization it doesn't
   show.** The examples-first screen shows no example. Routing records a reason
   for every decision; nothing displays it. Practice carries one label
   ("Active Recall") for every round.

## Item 1 - Round-two generation (LAUNCH BLOCKER, do first)

Align the retry prompt with the question-count contract. When fewer than three
points are outstanding, the composer's minimum must drop to match, or the
prompt must ask for enough questions to satisfy it - decide which and record
why. Verify live and unmocked: a one-point retry and a two-point retry, each
through completion, desktop and mobile.

**New standing rule, add to 06-STANDING-RULES.md:** a browser fixture that
hand-supplies what the prompt should have generated is not a test of that
path. Fixtures mock transport, not the shape of the model's answer.

Red/green required. This item alone justifies the PR; do not let the rest
delay it.

## Item 2 - Question-type mix

Question type becomes an explicit slot. The composer requests a mix; the
model writes to it. Five types, per founder decision:

`recall` / `application` / `compare_contrast` / `prediction` / `misconception`

Mix is decided in code, task type first then profile (02-ROUTING Layer 4):

| Task type | Default mix (5 questions) |
|---|---|
| memorization | 4 recall, 1 misconception |
| conceptual_learning | 1 recall, 2 application, 1 compare_contrast, 1 misconception |
| reading_to_quiz | 2 recall, 1 application, 1 prediction, 1 misconception |
| problem_solving / programming | 1 recall, 3 application, 1 misconception |
| writing_argumentation | 1 recall, 2 compare_contrast, 1 prediction, 1 misconception |
| mixed_assessment | 2 recall, 1 application, 1 compare_contrast, 1 misconception |

Profile adjusts within it: Q7 `gist_leaning` shifts one item toward recall;
`detail_leaning` shifts one toward compare_contrast. Scale proportionally for
counts other than 5.

**Scope constraint (founder decision on specificity):** tell the generator
which key point(s) a question may draw on. Application, compare_contrast and
prediction questions must span two key points; recall and misconception span
one. Code assigns the points; the model writes the question.

Distractors: ask for plausible reasoning errors in the prompt. No validator.

Order within a round: flat, generation order (founder decision).

Extend the study-guide live test to also assert at least one non-recall
question per conceptual round.

## Item 3 - Practice labels

Four practice methods, chosen by code:

| Label | Catalog id | Fires when |
|---|---|---|
| Active Recall | `retrieval_practice` | Default round |
| Error Repair | `practice_test_error_repair` | Any round after a missed one; built only from missed points |
| Practice Test | `practice_test_error_repair` (exam framing) | Deadline within 3 days; longer set (cap 8) |
| Interleaved Review | `interleaved_practice` | Two or more related topics have each passed once; sweeps them |

Each label is a different round, not a relabel. Each decision records a rule
ID like every other routing decision. Interleaved needs Brief 2's topic
relationships to fire fully; ship the rule with prerequisite-linked topics as
the relation for now.

## Item 4 - Topic difficulty (deterministic)

`difficulty = f(subtopicCount, prerequisiteDepth)` where prerequisite depth is
the number of topics that must precede this one. Three bands. Not a model
rating, not description length.

Effect: high band gets more questions (cap raised from clamp to 8). Nothing
else in this brief. Not shown to the learner (founder decision).

## Item 5 - Examples-first honesty

`concrete_example` currently shows a screen that repeats the directions and
then claims an example was shown. Either render a real source-grounded example
(from the material when present, from Slot 2's explanation when not) or remove
the claim. **Never claim a personalization that did not happen** - add to
standing rules.

## Item 6 - The session hub (design handoff, frame 3A)

Implement `docs/redesign/design/session-hub-3a.md` exactly. Recreate with the
codebase's CSS Modules, tokens, and existing state machines; do not port inline
styles. The handoff specifies layout, tokens, typography, every card, every
state. Where it says "open question for the team", decide, record the decision
in EVIDENCE.md, and move on.

Decisions already made:
- The shape toggle in the header is prototype-only. Do not ship it.
- Step rows in the shape card are display-only in production.
- `timerHidden` is session-scoped.
- Newsreader enters the app surface. Approved.
- Tips: the table in the handoff is the style reference, not shipped copy.
  Generate both halves per step — an instruction, then one sentence of
  reason — matching that tone. The reason half must draw from routing evidence
  and correspond to a rule that actually fired; assert the rule ID exists in
  route.ruleIds. Generated in the same slot call as the step's content. The
  examples go in the prompt as exemplars.
- Explanation length on answer reveal varies by profile:
  `simpler_repeated_instructions` gets shorter and plainer (Q9).

**Mobile.** The handoff is desktop-only and says so. Your testers use phones.
Implement the handoff's stated fallback - rail under the card, single column,
below ~1100px - as a functional layout, not a designed one. It must not break.
Record it as undesigned in EVIDENCE.md so it gets a proper pass later.

## Item 7 - Reasoning visible everywhere it was decided

The "chosen because" pills (hub), the tip's personalized half, and the end
receipt all read from `route.ruleIds` and `personalizationNote(route)`. Rule:
**if a routing rule fired, the learner can see it somewhere.** Plan-screen
display of reasoning is Brief 2.

## Out of scope

Plan model, block sizing, hints-first branching, mid-round adaptation, a third
round type beyond Error Repair, model-judged difficulty, per-topic depth
controls in plan editing (Brief 2), Shape B, the paywall.

## Gates

- Item 1: live, unmocked, one-point and two-point retries to completion, both
  viewports.
- Personalization delta test extended: two contrasting profiles, same topic -
  assert different question-type mixes and different tip text, on rule IDs.
- Study-guide live test still passes, now also asserting non-recall presence.
- Existing baseline session journey (6 cases) passes.
- Full gate in CI. Regression comparator: passed / blocked / inconclusive;
  inconclusive blocks.
- One live sample of every practice label firing, with its rule ID.

## Deliver

PR with EVIDENCE.md: item 1 red/green first; two profiles' full sessions side
by side including the hub; one screenshot per practice label; the mobile
fallback screenshot marked undesigned; every "open question" from the handoff
with the decision taken.
