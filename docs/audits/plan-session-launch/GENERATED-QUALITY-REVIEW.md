# Review of real generated work

Reviewed CI #410, head `8fc64ce065f74767db8fa8a7b2654326efe36e21`, using real model calls through the development-preview endpoint. These are synthetic journeys, not production account data or measurements of student learning. Samples are preserved under [samples](samples/).

## Introductory factual practice

The six-question plant-cell set is appropriate for its introductory factual goal: learners identify structures and functions. Similar organelles make plausible distractors. Passing this set does not establish demanding application quality.

## Long A-level application block: fails content review

The 24-question osmosis set passed the old structural assertions but is not acceptable:

- Question s12 has **no fully correct option**. Its marked answer says water moves B → A because A is more dilute. Its explanation correctly says A → B. The other A → B option gives the false reason that dilute solutions have lower water potential. Shuffling cannot repair this: it preserves the chosen answer, and none of the four options is fully correct.
- Many nominal application/comparison questions repeat the same gradient-direction or turgor inference with renamed settings. Distinct prompt strings and type labels did not establish meaningful variety.
- Some scenarios omit qualifications needed to infer the outcome. Concentrations of different solutes do not by themselves establish comparable water potentials; a changed external solution must be compared with the cell, not merely the previous solution.
- The five key points are too superficial for the stated A-level application goal. The explanation needs necessary conditions and boundaries to support richer questions.

The generation boundary now requests richer goal-appropriate teaching context, independently checks answer options/conditions/explanation/type/distractors/repetition, and permits one bounded repair phase with a recheck. Review omits the proposed answer index, but includes the explanation to check it; this is a model check with possible anchoring, not a proof of correctness. It shares the existing 50-second provider budget and can fail honestly. Its added latency and actual success rate require live CI evidence.

The deterministic slot planner also had a variety defect: ten two-point slots over five ideas recycled only five of ten available pairs. A failing regression now verifies all ten pairs appear before reuse while retaining the requested type mix and balanced coverage.

Red/green unit evidence establishes rejection/repair control flow against the actual failed question, exact review coverage, no unchecked fallback, and a finite repair ceiling. A dedicated **live** CI regression must identify the retained bad question and accept an explicit-condition replacement. New 6-, 24- and 32-question endpoint samples retain elapsed milliseconds and full generated output for another content review. No claim of failure-free generation is made.

## Revised-answer feedback

In the retained osmosis recheck sample, a revision that still reversed water movement remained flagged. The corrected revision received no remaining incorrect claims. This supports the specific tested distinction, not a general accuracy guarantee.

## Recording observations

All 11 videos in the CI #410 live-session artifact decoded successfully with FFmpeg. The P1 study screen and mobile missed-point screen were visually inspected. P1 stopped on an ambiguous test selector, so this run does not establish the contrasting-profile delta; the second profile did not execute.

The mobile method briefing and reason chips consume a long scroll before the active task. This is a usability concern beyond the correctness checks, retained for the founder's review. The preview short-profile screen also showed 22 minutes while claiming short sessions; the preview profile-transport defect has a separate red/green fix and still needs a fresh browser replay.

Recordings reduce the cost of reviewing flows. They do not show whether a learner finds a session useful, how long it takes a person, or whether the learning lasts.
