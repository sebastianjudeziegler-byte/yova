# Plan Model

**A plan is an ordered queue of blocks, grouped by topic.** Not a schedule.
One kind of plan - a unit, a subject, a test - distinguished only by whether
it has a date.

The time-first composer is replaced. This deletes: capacity math, splitting
by slot, "doesn't fit before the deadline" refusals, duration-follows-slot-
size, and most of the scheduling suite.

**Every learning-profile answer routes to a plan-level decision.** Section 2
is the map. If a rule fired, the learner can see it.

---

## 1. Topics, blocks, sizing (Option C)

A topic is the unit of knowledge. A block is how much of it you consume in
one sitting. The profile decides the ratio.

    blocksForTopic = clamp(ceil(topicWeight / learnerCapacity), 1, 3)

**Topic weight** - deterministic, from the map: subtopic count, prerequisite
depth (how many topics must precede this one), prior knowledge (demonstrated
or covered topics weigh less). No model rating, no description length.
*(Paper section 3 traits 14, 16; Mayer 2009; Kalyuga 2007.)*

**Learner capacity** - Q2 sets base; Q3 often/very-often reduces one band;
Q9 shorter_sections reduces further; Q10 long_plan_shutdown caps at 2.

**Guardrails:** max 3 blocks per topic (more = map mis-sized it; record, never
produce 5). Splits on subtopic boundaries only; no subtopics = no split.
Practice blocks never split.

**Practice blocks are placeholders.** Content generated when opened, fresh
each time. The plan shows "Practice - ~5 questions" as an estimate.

**Block length is computed, not fixed.** A block is a chunk of work with an
estimated time. The profile session-length answer is a *ceiling*, not the
value.

- Base from content: learn-with-source = read estimate (from material
  length) + produce cost (per produce-step) + compare; learn-no-source =
  explanation + produce + compare; practice = question count x per-type cost
  (recall ~45s, application/compare ~90s) + reveals.
- Topic adjusts: dense topics (high weight band) get shorter blocks, more of
  them *(trait 14, Mayer)*; demonstrated/covered topics get shorter blocks
  (brief review, not full read).
- Profile and moment cap: Q2 sets the ceiling; Q3 often/very-often and Q9
  shorter_sections lower it; a block in the learner's off-peak window (Q1)
  gets a lower ceiling than one in their peak *(traits 8, 11, 13)*.
- Floor 8 minutes; ceiling the upper edge of the Q2 band.
- **Fill to capacity.** After estimating, if the block is well under the
  learner's capacity, fill it rather than shipping a short block: add the
  produce step if it was skipped, raise the question count and the transfer
  ratio, and sweep in the next ready topic if there is one. The profile
  decides the block size; the content is made to fit it. A 40-minute learner
  must never get five easy questions and a 40-minute timer.
- **Delivery in parts.** A block's practice is delivered in parts of at most
  eight questions, easiest first (recall, then application and comparison).
  Each part is generated and independently reviewed on its own; the next part
  is prepared while the learner answers the current one. The block's size and
  timer are unchanged — the profile still decides how much practice a block
  holds; parts only decide how it arrives. Missed-point repair follows the
  whole block.
- The timer shown on a block is that block's estimate. Brief 1.5's hub reads
  `block.estimatedMinutes`, which Brief 2 makes real.

---

## 2. Profile -> plan routing (the whole map)

| Q | Plan-level effect | Status |
|---|---|---|
| Q1 energy | Learn blocks proposed in peak window; practice off-peak. Two plans on one day: learn block gets the peak slot | **IN** |
| Q2 length | Learner capacity base -> block count | **IN** |
| Q3 focus | Capacity down one band; often/very-often -> never two blocks back-to-back same day | **IN** |
| Q4 guidance | exact -> plan schedules everything, no choices; flexibility -> schedule shown with "move" per block; learner_choice -> queue in order, dates left for learner to place | **IN** |
| Q5 difficulty | step_by_step -> max one learn block per day; concrete_example -> topics with worked examples in material scheduled first; others session-level only | **IN** |
| Q6 prove | Session-level (produce step). Visible on plan via method label per block | via label |
| Q7 gist/detail | Practice question weighting | **IN** |
| Q8 starting | starts_late / needs_push -> first block within 24h, shortest in the plan, front-loaded schedule; on_time -> even spread | **IN** (new) |
| Q9 support | shorter_sections -> capacity; long_plan_shutdown -> collapsed queue; frequent_check_ins -> practice one day sooner | **IN** |
| Q10 extra | forget_during_tests -> +1 practice round, tighter spacing; long_plan_shutdown -> collapsed | **IN** |

Every rule records its ID. The plan header sentence is built only from rules
that fired.

**Ordering:** prerequisites first, then material order (map order when no
material). Q5 and Q8 adjust *dates*, not order. Deliberately simple.

---

## 3. Setup flow - six screens, all after the first skippable

**Add on Home** opens the plan flow directly. Two small links: "Add an event
instead" and "Just study something now" (existing Study Now). Add on Calendar
opens the event form with "Start a learning plan instead".

**1 Goal** (exists). One textarea, example placeholder. Date parsed from the
sentence - no picker. When a date is detected: "This is for: a test / an
assignment / my own goal" pills, default test. The existing starting-context
note ("anything YOVA should account for?") moves here from the placement
screen; it already routes (names a topic -> pulled forward). Vague goals get
one nudge: "Can you narrow that - a unit, a chapter, a test?"

**2 Materials** (exists). Drop zone: PDF, PPTX, DOCX, pasted text. One line
above: "Slides, notes, a study guide, or the syllabus." Each file a chip with
visible state: uploading -> read -> ready, or "Couldn't read this file" +
Retry. Read chip shows a summary ("32 slides"). Below: "Nothing to upload?
Skip - YOVA will build this from what it knows."

Read reliability: server-side extraction with a fallback parser when the
first returns nothing; scanned-image PDFs rejected up front with a clear
message; size cap with a message, never a timeout. **A file either reads or
says why it didn't.**

**3 What YOVA understood** (NEW). Applies all corrections at once on Continue.
- *Your materials* (hidden if none): per file - name, state, summary,
  classification with one-tap toggle: **Study guide** ("names what to learn,
  doesn't teach it - YOVA will teach these") / **Notes or slides** ("teaches
  the content - YOVA will point you here"). Flipping changes the path of that
  file's topics.
- *Topics YOVA found*: per topic - title (not editable; wrong title = remove),
  subtopics beneath, **source dropdown** pre-filled with YOVA's match or "YOVA
  will teach this" (this is per-topic material assignment), **already-covered
  checkbox** (= skip teaching, go to practice; not a knowledge claim), X to
  remove (vanishes). Drag to reorder.
- *Add a topic* - one field.
- *Roughly N-M blocks* - live range, learn + practice, default availability
  until screen 4.
- No start-over. Corrections cover it.

**4 Availability** (exists). Days per week, session length pre-filled from
onboarding, optional specific times (respected strictly).

**5 Placement offer** (changed). **Never auto-opens.** One card, Start / Skip.
Only when the goal has a date. Abandoned = answered questions count.

**6 Plan** - section 6.

No design exists for these yet. Build functional, mark undesigned.

---

## 4. Generation

Per topic: learn blocks (1-3) + one practice placeholder. Extra rounds only
when practice goes badly, cap 3 then escalate.

**Spacing** (first practice gap / later rounds): <=3 days: same or next day /
+1; 4-9: 2d / +3; 10-21: 3d / +5; none: 3d / +7. Never after the deadline.
Q9 frequent_check_ins: one day sooner. Q10 forget_during_tests: +1 round,
tighter.

**Dates:** suggestions, always. Placed on available days per Q1/Q5/Q8. A
placed day with no availability -> nearest available day *forward*. Many
blocks on one day is allowed (Q3 often/very-often: not back-to-back).
Learner-dragged dates are still suggestions - a rebalance may move them.

**Deadline close + topics unlearned -> first passes outrank returns**, reason
shown. **Never a refusal.** Only if the deadline has literally passed does
the plan say so instead of building.

---

## 5. Editing

Preview + receipt + Undo is Brief B's pipeline. **Reuse.** The optimization
is *which changes go through preview*.

**Inline, immediate, receipt + Undo (until the next change):**
- topic dropdown: Mark covered / Change method / Attach material
- drag a block to another day
- Add material (own button, always visible): file -> "which topic?" dropdown
  pre-filled, "whole plan" first -> only attached topics re-evaluate

**Edit mode, preview -> confirm:**
- reorder topics (drag)
- add topic -> end of queue, draggable
- remove topic - allowed even with completed blocks; completed work goes
  with it
- change deadline -> re-space remaining practice blocks only
- change availability -> dates only

**Falling behind:** a banner, not a mode. "3 blocks behind. Rebalance?" with
one proposed fix in the text ("drop the second practice round on your two
strongest topics"). Yes / Not now.

No free text anywhere. Byte-identical unchanged-sessions test stays green.

---

## 6. The plan screen

- Header: title; deadline line ("Test in 9 days - Fri 19 Sep"); count
  including practice ("14 blocks - 2 done"); **personalization sentence from
  fired rules only**.
- All topics listed, blocks collapsed inside each. Checkmark per topic.
  Topic note when a rule changed it ("split into 2 blocks - 5 subtopics").
- Q10 long_plan_shutdown: next block prominent, rest behind "N more".
- "Start next block" primary. "Add material". "Edit plan".

---

## 7. Home

Next block across all plans: overdue practice first, then nearest deadline,
then energy window picks among today's. Otherwise unchanged.

---

## 8. Materials -> topics: two hard rules

**Rule 1.** A `scope_outline` chunk contributes topic titles and nothing else.
Its text never reaches a generation call. Scope-outline-only topics take the
no-source path.

**Rule 2.** Reject document-referential questions ("goals of unit 6", "what
does the study guide list").

**Permanent live test:** upload a study guide, generate, assert no question
references the unit, the guide, or its goals.

---

## 9. Existing data

Pre-Brief-2 plans are deleted before launch (founder). The app refuses to
open one rather than attempting to display it.

Plan complete -> archived. No cross-plan memory in v1.
