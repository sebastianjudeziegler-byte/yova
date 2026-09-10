# Onboarding

Ten questions, reordered easy → hard. Two rewritten (old Q1 and Q8). Eight of
ten route to something real; one is honest future signal.

**Storage change, non-negotiable:** answers are currently stored as an array
indexed by position (`onboardingAnswers: string[]`, and `profile-summary.ts`
reads `onboardingQuestions[8]` by index). Reordering breaks every saved
profile. Answers must be **keyed by a stable question ID**, with a one-time
migration for existing profiles. The `LEGACY_ONBOARDING_LABEL_IDS` pattern in
`src/lib/sample-data.ts` already exists for exactly this.

**Routing reads option IDs, never labels.** Already stated in a code comment;
the routing table is the biggest consumer.

---

| # | Question | Routes to | Paper |
|---|---|---|---|
| 1 | When do you usually have the most usable energy? | Suggested dates: learn blocks in peak window, practice off-peak | §3 traits 8, 11; Cepeda et al. 2006 |
| 2 | What study-session length usually feels realistic? | Base timer; targets per block; pace estimate vs deadline | §3 trait 13; Wendsche & Lohmann 2019 |
| 3 | How often do you lose focus while studying? | Modifies timer down; adds stopping points | §3 traits 7, 10, 12 |
| 4 | How much guidance do you want from YOVA? | Layer 5 — whether the method choice is silent, visible, or offered | §3 trait 18; Kirschner et al. 2006 |
| 5 | When a topic is difficult, what usually helps most? | Layer 3 — scaffolding entry point | §3 traits 1, 16; Atkinson et al. 2000; Kalyuga 2007 |
| 6 | When you want to prove to yourself that you actually know something, what works best? **(rewritten)** | Layer 3 — Shape A produce-step | §3 trait 17; Dunlosky et al. 2013 "when not to use" |
| 7 | When you're studying, which is more likely? **(rewritten — gist vs detail)** | Layer 4 — practice question weighting | §3 trait 19; Brainerd & Reyna 2002 |
| 8 | Which starting pattern sounds most like you? | **Nothing in v1.** Retained as signal for stage-aware behaviour in v2 | §2 TTM — out of scope |
| 9 | Would any of these make YOVA easier for you to use? *(optional, multi)* | Layer 4 — delivery modifiers | §3 traits 5, 9, 15; Mayer 2009 |
| 10 | Is there anything else YOVA should know? *(optional)* | Layer 4 — practice rounds, queue visibility, example-first | §3 traits 4, 6; Roediger & Karpicke 2006 |

---

## New wording for the two rewritten questions

### Q6 — "When you want to prove to yourself that you actually know something, what works best?"
- `explain_back` — Explaining it out loud or in writing
- `map_it` — Mapping out how the pieces connect
- `answer_questions` — Answering questions on it
- `solve_it` — Working through a problem

### Q7 — "When you're studying, which is more likely?"
- `gist_leaning` — I get the big picture but miss specifics
- `detail_leaning` — I know the details but lose how they fit together
- `balanced` — Depends on the subject

---

## Changing answers later

A learner who answered wrongly edits their answer in the learner profile.
No re-onboarding. No adaptive detection in v1.
