# Routing

A pure function. Finite input space. No model in the loop. Every combination is
unit-testable, and **every decision records the rule ID that fired** — that is
what "Change method" and the personalization notice display, and what the
personalization delta test asserts on.

Layers resolve **in order**. A later layer can only modify what an earlier layer
left open.

---

## Layer 1 — Task type decides the shape

Task type comes from the topic, not the learner. **No profile answer overrides
this layer.**

| Task type | Learn block | Practice block |
|---|---|---|
| `problem_solving` | Shape B *(Week 2)* → Shape A w/ worked example for now | Shape C |
| `programming` | Shape B, Trace–Code–Test *(Week 2)* → Shape A for now | Shape C |
| `memorization` | Shape C with a brief study step first | Shape C |
| `conceptual_learning` | Shape A | Shape C |
| `reading_to_quiz` | Shape A, SQ3R variant | Shape C |
| `writing_argumentation` | Shape A, outline-from-memory variant | Shape C |
| `mixed_assessment` | Shape A (Shape B if the topic has problems) | Shape C |

*Paper: §3 "Task Type to Core Techniques" matrix.*

---

## Layer 2 — Placement evidence decides the scaffolding level

| Evidence on this topic | Shape A entry | Shape B entry (Week 2) |
|---|---|---|
| Gap, or not assessed | Study source in full, then produce | Full worked example → faded → independent |
| Demonstrated (placement passed) | Brief review, then produce | Skip example → independent |
| Learner-reported covered | Skip the learn block → Shape C | Skip to independent |

*Paper: §3 trait 16; Kalyuga 2007 — guidance that helps novices hinders experts.*

---

## Layer 3 — Produce-step and entry point

### Q5 "When a topic is difficult, what usually helps most?"
Moves the entry point **one step, never two, never past independent.**

| Answer | Effect |
|---|---|
| `concrete_example` | Shape B starts at full worked example even if evidence says skip. Shape A shows a worked structure before producing. |
| `simple_explanation` | Shape A default. No change to B. |
| `step_by_step` | Instructions as numbered steps; scaffolding held one level higher. |
| `try_then_feedback` | Shape B starts one level lower. Shape A: produce *before* studying, then compare. |
| `mixed` | No modifier. |

### Q6 "When you want to prove to yourself you actually know something?"
Decides the Shape A produce-step.

| Answer | Produce step | Method name shown |
|---|---|---|
| `explain_back` | Type an explanation, source hidden | Feynman Technique |
| `map_it` | Build concepts + labelled links | Concept Mapping |
| `answer_questions` | Skip produce → retrieval questions | Active Recall |
| `solve_it` | Bias to Shape B where task type allows | Practice Problems |

---

## Layer 4 — Modifiers

Never change the shape. Change delivery, size, timing, visibility.

| Source | Answer | Modifier |
|---|---|---|
| Q7 gist/detail | `gist_leaning` | Practice weights definition/term items first |
| | `detail_leaning` | Practice weights compare-contrast and structure items |
| Q9 support | `shorter_sections` | Fewer targets per block; timer −25%; questions clamped to 5 |
| | `reduced_text_visual_structure` | Produce-step becomes concept map (**overrides Q6**) |
| | `extra_reading_time` | Timer +25%; no pace prompts |
| | `simpler_repeated_instructions` | Plain language; task restated at each step |
| | `frequent_check_ins` | Explicit stopping point after each step |
| Q2 length | any | Sets base timer |
| Q3 focus loss | `often` / `very_often` | Timer −1 band; more stopping points |
| Q1 energy | any | Learn blocks proposed in peak window; practice off-peak |
| Q10 extra | `forget_during_tests` | +1 practice round per topic; tighter spacing |
| | `long_plan_shutdown` | Home shows next block only; queue collapsed |
| | `examples_before_ready` | Same as Q5 `concrete_example` |

---

## Layer 5 — What the learner sees

Q4 "How much guidance do you want from YOVA?"

| Answer | Behaviour |
|---|---|
| `exact_guidance` | Method applied silently; detailed step instructions; no chooser |
| `structured_flexibility` | Method applied; "Change method" link visible with the reason |
| `learner_choice` | Method chooser at session start, YOVA's pick pre-selected with reason |

---

## Conflict rules — code these explicitly

1. **Layer 1 always wins.** No profile answer produces Feynman on a calculus
   procedure.
2. **Q9 `reduced_text_visual_structure` overrides Q6's produce-step.** It is an
   accessibility need, not a preference.
3. **Q5 moves the scaffolding entry point by one level only**, never past
   independent.
4. **Timer modifiers stack but clamp** to 10–60 minutes.
5. **Q5 `mixed` or Q6 unanswered** → fall back to the Layer 1 default for that
   task type.
6. **Every decision records its rule ID.** Non-negotiable: it powers "Change
   method", the personalization notice, and the delta test.

---

## Personalization delta test (permanent, gates every change)

Two contrasting saved profiles, same topic, same material. The resulting blocks
must differ on **at least three** of: shape entry point, produce-step, timer,
question count/weighting, instruction style. Assert on **rule IDs**, not text.
