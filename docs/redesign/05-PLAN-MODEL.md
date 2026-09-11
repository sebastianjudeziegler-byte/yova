# Plan Model

**A plan is an ordered queue of blocks, grouped by topic.** Not a schedule.

The time-first composer is replaced. This deletes: capacity math, splitting by
slot, "doesn't fit before the deadline" errors, duration-follows-slot-size, and
most of the scheduling suite.

---

## 1. Topics, blocks, and sizing (Option C)

**A topic is the unit of knowledge. A block is how much of it you consume in
one sitting. The learner's profile decides the ratio.**

    blocksForTopic = clamp(ceil(topicWeight / learnerCapacity), 1, 3)

### Topic weight
From data the knowledge map already produces:
- subtopic count (0-12)
- intrinsic load: abstract, symbol-dense, many interacting parts
  *(paper section 3 trait 14; Mayer 2009 - reduce element interactivity first)*
- prior knowledge: a demonstrated topic weighs less than an unknown one
  *(trait 16; Kalyuga 2007 - expertise reversal)*

### Learner capacity
- **Q2 session length** sets the base
- **Q3 focus loss** (often / very often) reduces one band *(traits 7, 10, 12)*
- **Q9 shorter_sections** reduces further *(traits 5, 15 - executive load,
  working memory)*
- **Q10 long_plan_shutdown** caps blocks per topic at 2

### Guardrails
- **Max 3 blocks per topic.** More than that means the map mis-sized the topic:
  record it, never silently produce 5 blocks.
- **Splits land on subtopic boundaries.** Never cut an idea in half. A topic
  with no subtopics is never split.
- **Practice blocks are never split.** Question count already clamps 3-8.

### Why this matters
This is the only place the profile changes the **shape of the plan** rather
than the contents of a session. A 20-minute learner and an hour learner get
visibly different plans from the same unit. That is the promise: *answer
questions about yourself, get a personalized study plan.*

---

## 2. Personalization level: LEVEL 2 (locked for launch)

Level 3 (spacing tightness) follows. Level 4 (ordering) deferred - ordering
interacts with prerequisites and is where the bugs live.

| Varies by profile | Source | Status |
|---|---|---|
| Block count per topic | Q2, Q3, Q9, Q10 | **IN** |
| Practice rounds per topic | Q10 forget_during_tests -> +1 round | **IN** |
| Practice question weighting | Q7 gist/detail | **IN** (Brief 1) |
| Spacing tightness | Q3, Q9 | Level 3 - deferred |
| Topic ordering | stuck topic, energy window | Level 4 - deferred |

### Ordering rule (deliberately simple, for reliability)
1. Prerequisites first, always.
2. Among ready topics: **material order**. Nothing else.

A stuck topic does **not** jump the queue; the learner can reorder manually in
plan editing. Chosen for least bug surface, per founder decision.

---

## 3. Visible personalization

On the plan screen, before any session is opened. Built from the rule IDs that
fired, never hand-written prose.

> **12 blocks over 9 days.** Shorter blocks than usual because you focus best
> in about 20 minutes. Extra practice on every topic since you mentioned
> forgetting things during tests.

Per topic header:
> *Split into 2 blocks - this one has 5 subtopics.*

**Rule: if a routing rule fired, the learner can see it somewhere.**

---

## 4. What is generated at creation

Every topic gets its learn blocks (1-3) and one practice block. Extra practice
rounds are added only when practice goes badly, capped at 3 then escalate.

The plan looks honest on day one and grows only when results say it should.

---

## 5. Creation flow

1. **Add** (universal button)
2. **Route:** test / class unit / learn something new / other
   - reuses existing `studyMode` and `materialMode` switches, not new code
3. **Materials** - per plan or per topic, learner chooses
4. **Availability** - days per week and how long; learner may pick specific
   periods; YOVA proposes slots from the loose answer
5. **Placement check - opt-in, never automatic.** See section 6.
6. **Topics + plan generated together**; learner reviews and edits

---

## 6. Placement check

**Never opens automatically.** An offered option before generation, with an
obvious skip. Two ways to tell YOVA what you already know:

**Before generation - the placement check (optional).** A *sample* of
questions, not one per topic. Server-scored (Sept 7 rework). Skippable before
it starts and per question ("I haven't learned this yet").

**After generation - the topic ticker (in plan editing).** The topic list with
a tick per topic: *"I've already covered this in class."* Ticking sets
mark_covered - skip the learn block, go to practice - per the Sept 8 decision.
This is a learner report, never demonstrated evidence:
`initialEvidence = { source: "learner_report", outcome: "covered_elsewhere",
checked: false }`.

**Default if neither is used:** every topic starts teaching-first.

---

## 7. Spacing

| Time until deadline | First practice gap | Later rounds |
|---|---|---|
| 3 days or less | Same day or next | +1 day |
| 4-9 days | 2 days | +3 days |
| 10-21 days | 3 days | +5 days |
| None / ongoing | 3 days | +7 days |

- A practice block never lands after the deadline; it moves earlier.
- **Deadline close + topics unlearned -> first passes outrank returns**, reason
  shown: *"Prioritising new topics - your test is in 2 days."*

*Paper: Cepeda et al. 2006. Compression under deadline is a practical
concession, not a research claim.*

---

## 8. Dates, deadlines, falling behind

- **Suggested dates that can slip.** No "you're behind" errors.
- **Deadline is guidance, never a scheduler.** Guidance cannot throw.
- **Falling behind:** YOVA says something and offers a concrete restructure -
  *"You're 3 blocks behind with 4 days left. Drop the second practice round on
  the three topics you've already passed?"* - as an editable preview the
  learner confirms. **Depends on revision actually working.**

---

## 9. Materials to topics: two hard rules

The bug: a study guide listing "Unit 6 goals" produced the question *"What are
the main goals of Unit 6?"* instead of teaching osmosis. The document became
the subject.

**Rule 1.** A chunk classified `scope_outline` may contribute **topic titles
and nothing else**. Its text is never passed as content to any generation call.
A topic whose only source is scope-outline takes the **no-source path**: YOVA
writes the explanation, questions come from that explanation's key points.

**Rule 2.** Reject **document-referential questions** - any question testing
the document rather than the subject: "goals of unit 6", "what does the
syllabus list", "according to the study guide", "which topics does the exam
cover".

**Permanent live test:** upload a study guide, generate a session, assert no
question references the unit, the guide, or its goals.

---

## 10. "What YOVA understood" screen

After upload, before plan generation. The data already exists and has never
been shown.

> **Unit 6 Study Guide.pdf** - read, 12 pages
> Classified as a **study guide**: it names what to learn but doesn't teach it.
> YOVA will teach these topics itself.
> **6 topics found:** osmosis, diffusion, active transport, ...
> *Add your lecture slides and YOVA will teach from those instead.*

Three states per material: **saved -> read -> usable for practice.** Never
claim practice comes from a source whose content was not read.

---

## 11. Editing

Preview + receipt + Undo - Brief B's pipeline. **Reuse, do not rebuild.**

| Change | Touches |
|---|---|
| Topic (mark covered, attach source, reorder, change method) | That topic's blocks only |
| Availability or deadline | Dates only, never content |
| Add or remove a topic | Queue order only |
| Anything | **Never** completed or in-progress work |

Byte-identical unchanged-sessions test must keep passing.
**All editing is dropdowns and buttons. No free-text parsing.**

---

## 12. The plan screen - grouped by topic

    AP Bio Unit 3 - test Friday 19 Sep
    12 blocks over 9 days - 2 of 12 done
    Shorter blocks than usual because you focus best in about 20 minutes.

    [done] Glycolysis
       [x] Learn - 20 min      [x] Practice - 5 questions

    [partial] Pyruvate oxidation & Krebs   split into 2 blocks - 5 subtopics
       [x] Learn (1 of 2) - 20 min
       [ ] Learn (2 of 2) - 20 min                        Wed
       [ ] Practice - 6 questions                         Fri

    [ ] Electron transport chain           you said you're stuck here
       [ ] Learn - 20 min                                 Thu
       [ ] Practice - 6 questions                         Sat

- **Grouped by topic.** Topic = unit of knowledge; blocks nested beneath.
- **Checkmark per topic** = real progress. Done/not-done only.
- **Q10 long_plan_shutdown** -> collapsed: next block prominent, rest behind
  "12 more".
- Morning of the test: which topics have checkmarks, which don't.

---

## 13. Multiple plans, completion

- One plan per test or unit; learner effectively chooses.
- Multiple active plans fine. Home picks next across all - **unchanged**.
- Plan complete -> **archived**, not deleted. Topics remain viewable.
- No cross-plan memory in v1. (First thing to add in v2.)
