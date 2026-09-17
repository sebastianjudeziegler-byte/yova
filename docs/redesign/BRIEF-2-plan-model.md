# BRIEF 2 - Plan model

Branch: `baseline-plan-model`
Base: current `main`, after Brief 1.5 has fully merged. Do not start before.

Read `docs/redesign/00-SCOPE.md` and `06-STANDING-RULES.md` first. Then
`05-PLAN-MODEL.md` - it is the specification and it has been rewritten; read
it in full, not from memory of the earlier version.

## Why

Brief 1 fixed what happens inside a session. Brief 1.5 fills the session
screen. The plan that decides which sessions exist is still the old
time-first composer, and the learner's profile changes nothing about the
plan's shape. This brief makes the plan personal and makes it honest about
what it read.

## Precondition (already satisfied - do not redo)

The plan-revision migration is applied and the editedFields bug is fixed
(#89, #90). Verify with one revision on production before building; if it
fails, stop and report.

## Scope

### 1. Block sizing - spec section 1
Option C. Deterministic topic weight, profile-driven capacity, clamp 1-3,
subtopic-boundary splits. Practice blocks are placeholders.

### 2. The full profile -> plan routing map - spec section 2
**All ten questions route to a plan-level effect.** Implement every row,
including the three new ones (Q4 guidance levels, Q5 one-learn-block-per-day
and worked-examples-first, Q8 front-loading). Every decision returns a rule
ID. The plan header sentence is generated from fired rule IDs only.

### 3. Replace the time-first composer - spec section 4
Topic-sized blocks. Suggested dates. Nearest available day forward. Many
blocks per day allowed with the Q3 exception. Deadline is guidance. **Delete
the time-slicing composer in this brief** - nothing removed until its
replacement passes the same tests. List every module removed and what
replaced it.

### 4. Setup flow - spec section 3
Add-on-Home opens the plan flow with the two links. Goal screen: date-purpose
pills, starting-context note moved here, vague-goal nudge. Materials screen:
visible file states, retry, read-reliability requirements. **The "What YOVA
understood" screen** - new, per spec, all corrections applied on Continue.
Placement never auto-opens. Build functional; no design exists yet - mark as
undesigned in EVIDENCE.md.

### 5. Editing - spec section 5
Inline actions apply immediately with receipt + Undo (until next change).
Structural actions go through Brief B's preview. Remove-topic allowed with
completed blocks. Deadline change re-spaces remaining practice only. Add
material is its own button with the topic dropdown. Falling-behind banner
with one fix.

### 6. Plan screen - spec section 6
Grouped by topic, blocks collapsed, count includes practice, personalization
sentence, topic notes, collapsed variant for Q10.

### 7. Home ordering - spec section 7

### 8. Materials rules - spec section 8
**The bug that burned the founder.** Scope-outline chunks contribute titles
only. Document-referential questions rejected. Permanent live study-guide
test.

### 9. Old plans - spec section 9
App refuses to open a pre-Brief-2 plan. Founder deletes the data.

## Out of scope

Shape B, ingestion formats beyond PDF/PPTX/DOCX/text, syllabus import,
natural-language anything, cross-plan memory, adaptive routing, the paywall,
any visual design work. If a change wants to alter Brief B's revision pipeline
beyond routing inline actions around it, stop and ask.

## Gates

- Personalization delta test for plans: two contrasting profiles, same unit,
  same materials - assert different block counts, different first-block
  timing (Q8), different date placement (Q1), on rule IDs.
- Every one of the ten routing rows has at least one test that fires it and
  asserts the rule ID.
- Study-guide live test.
- Brief B byte-identical unchanged-sessions test still passes.
- Existing create -> activate -> open -> complete passes unchanged.
- Full gate in CI; comparator passed/blocked/inconclusive; inconclusive
  blocks. Refresh the saved main baseline before opening the PR if it is more
  than a week old.

## Deliver

PR with EVIDENCE.md: precondition check, red/green per item, two profiles'
full plans side by side with their header sentences, the study-guide test
output, the routing-row coverage table, the list of deleted modules with
replacements, and the undesigned screens flagged.
