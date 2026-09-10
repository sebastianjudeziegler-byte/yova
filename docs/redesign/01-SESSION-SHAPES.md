# Session Shapes

A session is **one topic**, with a timer from the learner's profile. The timer
is a nudge, not a boundary: at the buzzer the learner may stop at a natural
break or keep going. Sessions are never sized by fitting content into a time
slot.

Each shape is a **coded step sequence** — a state machine. The AI fills small,
bounded slots inside it. The AI never authors a session.

---

## Shape A — Study → produce → compare → repair

For conceptual learning, reading-to-quiz, memorization (with a brief study
step), writing/argumentation. Also the temporary home for procedural topics
until Shape B ships in Week 2.

### A1 — with a source (learner has material)

1. **Direct.** YOVA names what to look at and how to approach it.
   e.g. *"Review your Unit 3 slides on glycolysis — read for the mechanism,
   not the terms. You'll explain it back."*
   - Specificity depends on what is known about the material:
     - topic-specific slides/notes → *"Review your Unit 3 slides on X"*
     - large PDF where the section can be located → *"Read pages 4–9"*
     - learner-pasted link → *"Watch the video you added"*
   - The "how to approach it" line is shaped by the profile (see 02-ROUTING).
2. **Learner leaves the app** and studies the material.
3. **Continue.** A single button. No tracking, no timer on the away step.
4. **Produce.** Source hidden. The produce-step depends on the profile:
   - *Feynman* — type an explanation in your own words
   - *Concept mapping* — build the concepts and their labelled links
   - *Active recall* — skip producing; go straight to retrieval questions
5. **Compare.** YOVA compares what was produced against the source and names
   what is missing or wrong. **Feedback, not a verdict.** No pass/fail. This
   never sets topic status.
6. **Repair.** The learner addresses the named gaps. Optional; they may move on.

### A2 — without a source (AI writes the explanation)

Identical to A1 except step 1–2 are replaced by an AI-generated explanation
rendered in the app. See 04-AI-SLOTS for the generation contract.

---

## Shape C — Closed-book practice

The return visit. Also the entry point for topics the learner marked as already
covered.

1. **No source shown.** Straight into questions.
2. **Fresh multiple-choice questions**, generated per attempt (not a fixed
   bank). Count and weighting per 03-PRACTICE.
3. **Answer.** Checked in code, not by a model.
4. **Wrong answer → show the correct answer and move on.** "Ask YOVA" is
   available to explain it. **No forced repeat, no repair loop.**
5. **End.** What's next, plus a personalization note.

---

## Shape B — Worked example → faded → independent (WEEK 2, NOT LAUNCH)

For problem solving and programming. Three scaffolding levels; entry point set
by placement evidence and profile. Not built for the baseline. Until it ships,
procedural topics use Shape A with a worked example as the source.

---

## What a shape is NOT

- Not sized to a time slot
- Not assembled by the model
- Not variable between runs

## The twelve catalog methods map onto shapes

No method name is deleted. Each is one of:

| Method | Maps to |
|---|---|
| Feynman Technique (`self_explanation`) | Shape A produce-step: typed explanation |
| Concept Mapping (`concept_mapping`) | Shape A produce-step: concepts + links |
| SQ3R (`read_recall_review`) | Shape A variant: survey → question → read → recall |
| Outline from Memory (`retrieval_based_outlining`) | Shape A produce-step: claim + structure |
| Active Recall (`retrieval_practice`) | Shape C |
| Practice Tests (`practice_test_error_repair`) | Shape C, longer set, exam framing |
| Worked Examples (`worked_example_fading`) | Shape B, full scaffolding (Week 2) |
| Trace–Code–Test (`scaffolded_coding`) | Shape B, programming variant (Week 2) |
| Practice Problems (`practice_problems`) | Shape B at independent level (Week 2) |
| Spaced Repetition (`spaced_retrieval`) | **Not a session.** Queue rule — when Shape C returns. See 05-PLAN-MODEL |
| Interleaving (`interleaved_practice`) | **Not a session.** Block flag — a Shape C block may sweep several related topics. Only after a topic has passed once |
| Pretesting (`pretesting`) | **Cut from baseline.** Optional opening question in v2 |

## Session end screen

Every session ends with:
1. What's next
2. A personalization note — one sentence naming what changed and why, drawn
   from the rule ID that fired (see 02-ROUTING)
