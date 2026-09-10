# Plan Model

**A plan is an ordered queue of blocks, not a schedule.**

The time-first composer is replaced. Sessions are topic-sized; the timer comes
from the profile. Nothing is chopped to fit a slot.

This deletes: capacity math, session splitting, "doesn't fit before the
deadline" errors, duration-follows-slot-size, and most of the scheduling suite.

---

## What is generated at creation

For every topic:
- **one learn block**, and
- **one practice block**, spaced per the table below.

Extra practice rounds are added only when practice goes badly (max 3, then
escalate — see 04-AI-SLOTS).

The plan therefore looks honest on day one and grows only when results say it
should.

---

## Creation flow

1. **Add** (universal button — home, calendar, elsewhere)
2. **Choose a route:** test / class unit / learn something new / other
   - route determines what is asked; *test* prompts hard for a deadline and
     materials
   - existing `studyMode: inside | outside` and `materialMode: upload | none`
     switches are reused — **not new code**
   - "YOVA generates everything" is the `materialMode: none` path, beta-labelled
3. **Materials** (before topics)
4. **Availability** — "how many days a week and how long"; the learner may also
   pick specific periods. YOVA proposes the specific slots from the loose answer.
5. **Placement check** — offered, fully skippable
6. **Topics + plan generated together**; learner reviews and edits after

---

## Spacing

Gap before a topic's first practice, set at creation from scope and deadline:

| Time until deadline | First practice gap | Later rounds |
|---|---|---|
| ≤ 3 days | Same day or next day | +1 day |
| 4–9 days | 2 days | +3 days |
| 10–21 days | 3 days | +5 days |
| None / ongoing | 3 days | +7 days |

Rules on top:
- A practice block never lands after the deadline; it moves earlier.
- **When the deadline is close and topics remain unlearned, first passes
  outrank returns**, with the reason shown: *"Prioritising new topics — your
  test is in 2 days."*

*Paper: Cepeda et al. 2006 on distributed practice. The compression under
deadline is a practical concession, not a claim the research supports.*

---

## Dates and the deadline

- **Suggested dates that can slip silently.** Missed block → the queue
  reorders. No "you're behind" errors.
- **The deadline is guidance, never a scheduler.** *"Eight topics, nine days —
  that's tight. Here's the priority order."* Guidance cannot throw.
- Home screen ordering is **unchanged from current behaviour**.

---

## Plan container and multiples

- One plan per test or per unit; the learner effectively chooses.
- Multiple active plans are fine. Home picks what's next across all of them.
- A plan has no hard end: learn → practice → spaced returns. The learner can
  add more later.

---

## Editing

Preview + receipt + Undo (Brief B pipeline, already merged — **reuse, do not
rebuild**).

| Change | Touches |
|---|---|
| A topic (mark covered, attach source, change method) | That topic's blocks only |
| Availability or deadline | Dates only, never content |
| Add or remove a topic | Queue order only |
| Anything | **Never** completed or in-progress work |

The byte-identical unchanged-sessions test from Brief B must keep passing.

**All changes are dropdowns and buttons. No free-text parsing.** That feature
was removed from the live path on 2026-09-07 for corrupting topic bindings and
does not come back.

Deleting a plan deletes everything from it. No cross-plan memory in v1.

---

## Progress

- A topic is **done/not-done**. A checkmark. No confidence levels, no
  percentages.
- Nothing carries between plans in v1. (First thing to add in v2.)
