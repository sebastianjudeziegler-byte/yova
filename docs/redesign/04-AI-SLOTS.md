# AI Generation Contract

The AI's job is small, bounded, and checkable. It never authors a session and
never decides structure.

## Principle

Where teaching and assessment must agree, they are generated **in one call from
one shared context**. Two independent generations that have to agree is the
pattern behind the untaught-NADH bug and the glycolysis false-rejection bug.

---

## Slot 1 — Learn-block instructions (source path)

**Input:** topic, what is known about the material, profile modifiers.
**Output:** two sentences. What to look at, how to approach it.
**Cannot be wrong in a damaging way** — it points at material YOVA does not
render or reason about.

---

## Slot 2 — AI explanation (no-source path)

One call produces, together:

1. **The explanation.** One topic, bounded length, plain prose. Core idea,
   mechanism, one concrete example. Nothing else.
2. **Key points.** 3–5 facts, structured list, derived from the explanation.
3. **Practice questions.** MCQs generated from the key points in the same call.

Because 2 and 3 derive from 1 in one context, **practice cannot test something
the explanation did not cover.**

Quality bar: as good as a strong ChatGPT answer on the topic. Not perfect.

**Failure handling:** retry once. Then an honest error — *"YOVA couldn't build
this. Try again, or add material for this topic."* Never fabricated content,
never a degraded lesson.

---

## Slot 3 — Produce-step comparison (Shape A step 5)

**Input:** learner's typed explanation (or concept links) + the source or the
key points.
**Output:** what is missing or wrong. Prose feedback.
**Never a verdict.** No pass/fail. Never sets topic status. A comparison that
says "you didn't mention NADH" cannot be wrong in a way that blocks the learner
or corrupts their record.

---

## Slot 4 — Practice questions (Shape C)

Fresh per attempt. From the learner's source when there is one, from the topic
otherwise. Generated in the same call as any explanation they accompany.

**Checked in code, not by a model.** MCQ only in the baseline.

---

# Practice Composition

## How many

One question per key point, clamped **3–8**.

Clamps: Q9 `shorter_sections` → max 5. Q2 timer band 10–15 min → max 5.

## Weighting

| Q7 answer | Weighting |
|---|---|
| `gist_leaning` | Definitions and term-level items first, then relationships |
| `detail_leaning` | Compare-contrast and "how does X relate to Y" first, then terms |
| `balanced` | Task-type default: memorization → terms; conceptual → relationships |

## Rounds

- Round 1 covers all key points.
- Round 2+ includes only what was missed.
- A topic is **done** when a full round passes clean.
- **Ceiling: 3 rounds.** After that, escalate — *"This one isn't sticking —
  want to re-learn it a different way?"* linking to a learn block with a
  different produce-step.

The ceiling is required. Without it a struggling learner loops forever.

`Q10 forget_during_tests` → +1 round per topic, tighter spacing.
