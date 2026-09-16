# Handoff: In-session hub (option 3a)

## Overview
A redesign of YOVA's in-session screen (`src/components/baseline-session.tsx`). Today the session runner is a single 760px centered column: a top bar, a row of step chips, and one card per step. The learner cannot see why this method was chosen, what the method actually asks them to do, how long the session is shaped to run, or which source they are meant to open. All of that lives in other screens or nowhere.

Option 3a adds a persistent hub around the step card:

- a briefing strip across the top, carrying the method, what it is, its four instructions, and the reasons it was chosen;
- a right rail, carrying a personalized YOVA tip for the current step, the timer with pacing controls, the session shape with per-step timings, today's target, and the source;
- the existing step card, which stays the primary surface in the centre-left.

It covers both coded session shapes (Shape A: study, produce, compare, repair, end; Shape C: brief study, questions, round review, end) and keeps the shipped rule that the method can only be changed before the first step.

## About the design files
The file in this bundle is a design reference created in HTML. It shows intended look and behaviour, not production code to copy. The task is to recreate it inside the YOVA Next.js app using its existing patterns: CSS Modules per component (`*.module.css`), the design tokens already declared in `src/app/globals.css` and `src/app/polish.css`, `lucide-react` icons, and the existing session state machines in `src/lib/session-shapes/`. Do not port the inline styles.

The prototype renders several options side by side on one canvas. Only the frame badged `3A` is in scope. The others (1a, 1b, 2a, 2b, 2c, 3b, 3c) are earlier explorations kept for reference.

## Fidelity
High fidelity. Colors, typography, spacing, radii and copy are final and taken from the shipped token set and the landing page's visual language. Recreate closely, using the codebase's tokens rather than the literal hex values wherever a token exists (mapping table below).

---

## Screens and views

### 1. Session hub, Shape A (learn block)

**Purpose:** the learner works one step of a session while the hub answers, without navigation: what am I meant to do, why this way, how long, from which material.

**Layout**

```
┌─ header ──────────────────────────────────────────────────────────┐
│ eyebrow / topic / method line              [shape toggles] [Exit] │
├───────────────────────────────────────────────────────────────────┤
│  briefing strip (full width)                                      │
│  ┌ 300px ─────────┬ 1fr ────────────────────────────────────────┐ │
│  │ method name    │ 4 instruction cards (repeat(4, 1fr))        │ │
│  │ + what + CTA   │ "Chosen because" pills                      │ │
│  └────────────────┴─────────────────────────────────────────────┘ │
│  ┌ 1fr ─────────────────────────────┬ 320px ─────────────────────┐ │
│  │ step card (the work)             │ rail:                      │ │
│  │                                  │  YOVA tip                  │ │
│  │                                  │  timer + controls          │ │
│  │                                  │  session shape steps       │ │
│  │                                  │  today's target            │ │
│  │                                  │  your source               │ │
│  └──────────────────────────────────┴────────────────────────────┘ │
└───────────────────────────────────────────────────────────────────┘
```

- Page background `--off-white` (#f6f7fb). Outer content padding `22px 24px 28px`, vertical gap `18px`.
- Body grid: `grid-template-columns: minmax(0,1fr) 320px; gap: 20px; align-items: start`.
- Rail is `position: sticky; top: 22px; max-height: 720px; overflow: auto; padding-right: 6px; display: grid; gap: 12px; align-content: start`. Keep the height cap. Without it the rail outgrows the work card and the page ends in dead space.
- Desktop only. No mobile layout is specified. Below roughly 1100px the intended fallback is rail-under-card in a single column, which is not designed here.

---

#### Header
- `display:flex; align-items:center; justify-content:space-between; gap:16px; padding:16px 24px`, background `#fff`, bottom border `1px solid #e7eaf0`.
- Left, a 3-row stack, `gap:2px`:
  1. eyebrow: `LEARN BLOCK · AP BIOLOGY / UNIT 3 EXAM`, JetBrains Mono 700 10px/1.3, letter-spacing `.09em`, uppercase, color `--blue` #2450c7. Reads `PRACTICE BLOCK` for Shape C.
  2. topic: Newsreader 500 21px, letter-spacing `-.01em`, color `--ink` #0b1020.
  3. method line: Inter 400 12px, `--muted` #667085, reading `Method: {methodName} · chosen from your profile`. Omit the suffix when `route.visibility === "silent"`, which matches the shipped component.
- Right: the Shape A / Shape C toggle (a prototype-only affordance, do not ship it, since the real shape comes from `route.shape`), a 1px by 24px `#e7eaf0` divider, and a ghost `Exit session` button (`min-height:40px; padding:0 14px; border-radius:999px`, transparent, `#344054`; hover `background: rgba(36,80,199,.08)`, color `#0b1020`).

#### Briefing strip
- `padding:24px; border:1px solid rgba(36,80,199,.16); border-radius:20px; background: linear-gradient(180deg, rgba(36,80,199,.1), rgba(36,80,199,.04))`.
- `display:grid; grid-template-columns:300px minmax(0,1fr); gap:28px; align-items:start`.
- Left column:
  - kicker `HOW TO STUDY THIS`, mono 700 10px, `.09em`, uppercase, `#2450c7`.
  - method name, Newsreader 500 30px/1.08, `-.016em`.
  - `method.what`, Inter 13px/1.6, `#344054`.
  - change-method button, full width, `min-height:42px; border-radius:999px`:
    - enabled (step index 0 only): `1px solid rgba(36,80,199,.3)`, white background, `#2450c7`, label `Change method before you start`.
    - locked (any later step): `1px dashed #cbd2e0`, transparent, `#8a93a5`, `cursor:not-allowed`, label `Method locked for this session`.
- Right column, `display:grid; gap:16px`:
  - instruction cards: `grid-template-columns: repeat(4, minmax(0,1fr)); gap:14px`. Each card is `padding:16px; border:1px solid rgba(255,255,255,.9); border-radius:14px; background: rgba(255,255,255,.7)`, containing a 24px round index chip (`1px solid rgba(36,80,199,.18)`, white, `#2450c7`, mono 700 10px) and the instruction in Inter 12.5px/1.5, `#344054`. Content is `CORE_METHOD_CATALOG[methodId].how`, which always holds exactly 4 entries.
  - "chosen because" row: mono uppercase label `CHOSEN BECAUSE` (`#667085`) followed by one pill per routing reason, each `padding:6px 11px; border:1px solid rgba(36,80,199,.16); border-radius:999px; background:#fff; color:#344054; font-size:12px`. Pill text is the reason's short head only. The full sentence is not shown in 3a.

#### Step card (work surface)
- `padding:34px; border:1px solid #e7eaf0; border-radius:22px; background:#fff; box-shadow:0 18px 44px rgba(24,36,70,.06); display:grid; gap:18px`.
- Row 1: step kicker (mono 700 10px `.09em` uppercase `#2450c7`, for example `PRODUCE · SOURCE HIDDEN`) and, right-aligned, `STEP 2 OF 5` in mono 500 10px `#667085`.
- Title: Newsreader 500 36px/1.08, `-.016em`.
- Lead paragraph: Inter 15.5px/1.7, `#344054`.
- Optional blocks, in this order, rendered only when the step has them:
  - restated task: `padding:10px 0 10px 14px; border-left:3px solid --lavender (#b7a8ff)`, 13.5px/1.55, `#667085`. Only when `route.instructionStyle === "plain_restated"`.
  - bullet list: custom bullets, a 6px `#2450c7` dot in an 18px column, text 14px/1.55 `#344054`, `gap:9px`.
  - MCQ choices (Shape C): one button per choice, `display:grid; grid-template-columns:26px minmax(0,1fr); gap:12px; padding:14px 16px; border-radius:14px; border:1px solid #e7eaf0; background:#fff; text-align:left; font-size:14px`. The 26px key chip is a circle with the letter in mono 700 10px. After answering, the correct choice takes `border:1px solid #2f9e6a; background:#eaf7f0` with a `#2f9e6a` filled chip, the chosen-wrong choice takes `border:1px solid #d9534f; background:#fdeeee` with a `#d9534f` chip, and all buttons disable.
  - comparison feedback: `padding:18px; border:1px solid rgba(36,80,199,.16); border-radius:14px; background:#f2f5ff; display:grid; gap:12px`. Prose paragraph, then a `MISSING` group and a `TO CORRECT` group (mono 700 10px `.08em` `#2450c7` label plus a `ul` at 13.5px/1.5), then `Feedback, not a verdict.` in 12px `#667085`.
  - textarea: `min-height:210px; padding:18px; border:1px solid #e7eaf0; border-radius:14px; line-height:1.7; resize:vertical`; focus `outline:3px solid rgba(36,80,199,.16); border-color:#2450c7`.
- Action row: primary button, optional secondary, then a footnote in 12.5px `#667085`.
  - primary: `min-height:46px; padding:0 22px; border-radius:999px; background: var(--grad-primary) (linear-gradient(180deg,#2f5fe0,#182446)); color:#fff; font:700 14px; box-shadow: inset 0 1px 0 rgba(255,255,255,.25), 0 8px 20px rgba(36,80,199,.28)`.
  - secondary or ghost: `min-height:38px; padding:0 14px; border:1px solid #e7eaf0; border-radius:999px; background:#fff; color:#344054; font:600 12.5px`.

#### Rail card 1: YOVA tip
- `padding:18px; border:1px solid rgba(122,92,255,.28); border-radius:18px; background: linear-gradient(180deg, rgba(122,92,255,.1), rgba(122,92,255,.03))`.
- kicker `YOVA TIP · STEP {n}`, mono 700 10px `.09em` uppercase, `#5c49bd`.
- title: Newsreader 500 20px/1.22, `-.01em`, `#0b1020`.
- body: Inter 13px/1.6, `#433693`.
- action: full-width `Ask YOVA to expand`, `min-height:40px; border:1px solid rgba(122,92,255,.35); border-radius:999px; background:#fff; color:#5c49bd; font:700 12.5px`; hover `background:#f4f2ff`. It opens the same ephemeral tutor call the shipped `AskYovaInline` uses (`POST /api/tutor`, `persistenceMode: "ephemeral"`), seeded with the tip text plus the current topic.
- Exactly one tip is visible at a time, and it is rewritten per step. Tone is coach-like and direct: an instruction, then one sentence of reason. No evidence line, no rule id, no dismiss control.
- Tip copy used in the prototype (ship these as the initial content set; keys are shape plus step):

  **Shape A**
  | Step | Title | Body |
  |---|---|---|
  | study | Follow one glucose end to end. | You come back with the right terms in the wrong order. Track a single molecule through the ten steps before you look at anything else on the page. |
  | produce | Write "because" after every step. | Feynman asks for causes because a step list can be recited without understanding. If a sentence has no because, it is not finished yet. |
  | compare | Attempt the repair before you reread. | Naming a gap is not closing it. Try the fix from memory first. Rereading now will feel like learning and will not stick. |
  | repair | Fix only the two named lines. | Rewriting the whole explanation feels productive and teaches you least. The named gaps are the only part that is still open. |
  | end | Say it out loud once tonight. | One spoken retelling before you sleep is the cheapest spacing you have, and it catches the parts you skipped in writing. |

  **Shape C**
  | Step | Title | Body |
  |---|---|---|
  | brief | Read it once. Do not reread. | This block exists to give you a model, not to be memorised. The questions were written from it, so a second pass buys you nothing. |
  | questions | Commit to an answer before you look. | Active Recall only pays off if you produce the answer first. Say it, then read the options, not the other way round. |
  | round | A second round is the method working. | Round 2 covers only what you missed. That is the design, not a penalty. The misses are what still needs the retrieval. |
  | end | Let the spacing do the rest. | Retrieval you never return to fades. Your next round is already placed four days out. Do not pull it forward tonight. |

  The first clause of each tip is generic to the method plus step. The personalized half (for example "You come back with the right terms in the wrong order") should come from the same routing evidence that produces `personalizationNote(route)`. See State management.

#### Rail card 2: timer
- `padding:16px; border:1px solid #e7eaf0; border-radius:16px; background:#fff`.
- Clock: Newsreader 500 32px/1, `font-variant-numeric: tabular-nums`, next to `/ 25:00` in mono 500 11px `#667085`.
- Progress bar: 5px tall, `background:#eef0f5`, radius 999px; fill `linear-gradient(90deg,#2f5fe0,#7a5cff)`, width equal to elapsed over total, clamped to 100%. Over time, the fill switches to solid `#f0c96a`.
- Controls, as pill ghost buttons: `Pause` and `Resume`, `+5` (adds 5 minutes to the nudge and clears the over-time acknowledgement), and `Hide`.
- `Hide` removes the whole card and replaces it with a single dashed pill, `min-height:36px; border:1px dashed #d9dee8; color:#8a93a5; font:600 12px`, label `Timer hidden, show it`. A global `showTimer: false` setting removes both, leaving no timer UI at all.
- Over-time banner, shown above the work card rather than in the rail: `padding:13px 16px; border:1px solid #f0c96a; border-radius:14px; background:#fff8e8`, text `#7a5218`, reading "Your 25-minute timer is up. Stop at a natural break, or keep going." with a `Keep going` ghost button that dismisses it. Same semantics as the shipped nudge: the timer never blocks.

#### Rail card 3: session shape
- `padding:16px; border:1px solid #e7eaf0; border-radius:16px; background:#fff`. The kicker is the shape line in mono uppercase `#2450c7`: `SHAPE A · STUDY → PRODUCE → COMPARE → REPAIR` or `SHAPE C · CLOSED-BOOK PRACTICE`.
- One row per step: `display:grid; grid-template-columns:24px minmax(0,1fr) auto; gap:10px; align-items:center; padding:9px 0 9px 9px; border-bottom:1px solid #eef0f5; border-left:3px solid transparent`.
  - current step: `border-left-color:#2450c7; background: linear-gradient(90deg, rgba(36,80,199,.07), transparent)`, the same active-step treatment as the landing page's session preview.
  - index chip: done is `#0b1020` filled with white text; current is white with `1px solid rgba(36,80,199,.3)` and `#2450c7` text; future is `1px solid #e0e4ec` with `#8a93a5`.
  - label 13px 600 `#0b1020`; minutes right-aligned, mono 500 10px `#667085`.
- Step data (label, blurb, minutes):
  - Shape A: Study your material, "YOVA names what to look at and how.", 10 MIN / Produce, "Source hidden. Explain it back.", 8 MIN / Compare, "What is missing or wrong.", 3 MIN / Repair, "Optional. Close the named gaps.", 4 MIN / Session complete, "What's next, and what changed.", no minutes.
  - Shape C: Brief study, 4 MIN / Closed-book round 1, 12 MIN / Round review, 5 MIN / Session complete, no minutes.
- Rows are clickable in the prototype for demo purposes. In production they are display-only, since the state machines own progression.

#### Rail card 4: today's target
- Same card shell. Kicker `TODAY'S TARGET`, then the target sentence in Newsreader 500 16px/1.35. Source is `coverage.focus`, falling back to `session.objective`.

#### Rail card 5: your source
- Same card shell. Kicker `YOUR SOURCE`, then the material line in 13px 600 `#0b1020` (`Unit 3 lecture slides · pages 4 to 9`). When there is no material (`sourceMode` without a source), replace it with the AI-explanation path's equivalent line and drop the card's actions.

---

## Interactions and behavior
- **Step progression:** the primary button advances the underlying reducer (`shapeAReducer` or `shapeCReducer`); the rail, briefing strip and tip all re-derive from the current step. No page transition, no animation beyond the browser default.
- **Method change:** available only while `aState.index === 0 && !aState.produce`, which is the shipped `canChangeMethod` condition minus the alternatives check. After that the control renders in its locked state with the explanatory line "Locked once you start producing. Switching now would throw away the work this session is measuring." Do not hide the control; the locked state is the message.
- **Timer:** ticks once per second from mount; `Pause` freezes it; `+5` extends the nudge; `Hide` collapses it to the dashed pill. Crossing the limit flips the pill to `OVER`, the bar to amber, and raises the banner once, dismissed by `Keep going` and re-raised after `+5` is consumed.
- **Ask YOVA to expand:** an inline ephemeral tutor answer, rendered where the shipped `AskYovaInline` renders its reply (a `#f3f5ff` feedback block). Loading state is a spinner plus "Asking YOVA...". Error state uses the honest error copy already in the codebase.
- **MCQ:** clicking a choice reveals correctness immediately, buttons disable, and the explanation and next-question action appear. No forced repeat.
- **Hover states:** ghost buttons take `border-color:#2450c7; color:#2450c7`; the tip's expand button takes `background:#f4f2ff`; exit takes `background: rgba(36,80,199,.08)`. Step rows take `background:#fafbfe` on hover in production, which the prototype does not show.
- **Responsive:** desktop only, as specified above.

## State management
New UI state, on top of what `BaselineSession` already holds:
- `timerHidden: boolean`, rail-local. Open question for the team: session-scoped, topic-scoped, or a profile setting. The prototype treats it as session-scoped.
- `timerExtraMinutes: number`, the accumulated `+5`s, added to `route.timerMinutes`.
- `timerPaused: boolean`, which pauses the elapsed counter only and does not pause anything server-side.
- `tipExpanded` plus the tutor request state for the Ask YOVA call, mirroring `AskYovaInline`.

Derived, with no new state:
- current tip is `f(route.shape, currentStepKey, routing evidence)`. Generate it in the same slot call that already produces the step's content where possible. Never make a separate model call per step.
- briefing content is `CORE_METHOD_CATALOG[route.methodId]` (`name`, `what`, `how`, `completion`), already imported by `study-method-briefing.tsx`.
- "chosen because" pills are the same rule evidence behind `personalizationNote(route)` and `route.ruleIds`.

Data the hub needs that the current component already receives: `plan`, `session`, `topic`, `route`, `nextSession`. The source line needs `baselineSourceForTopic(...)`, which `BaselineSession` already computes.

## Design tokens

| Prototype value | Codebase token | Notes |
|---|---|---|
| `#0b1020` | `--ink` / `--navy` | headings, primary text |
| `#344054` | `--secondary` | body copy |
| `#667085` | `--muted` | meta, labels |
| `#2450c7` | `--blue` | kickers, active step, links |
| `#7a5cff` / `#5c49bd` | `--violet` | tip card accents |
| `#b7a8ff` | `--lavender` | restated-task rule |
| `#f6f7fb` | `--off-white` | page background |
| `#ffffff` | `--surface-raised` | cards |
| `#f2f5ff` | `--surface-blue` | reason and feedback blocks |
| `#e7eaf0` | `--line-subtle` | card borders, dividers |
| `linear-gradient(180deg,#2f5fe0,#182446)` | `--grad-primary` | primary buttons |
| `linear-gradient(180deg,rgba(36,80,199,.1),rgba(36,80,199,.04))` | `--tint-bg` | briefing strip |
| `999px` | `--radius-round` | all pills and buttons |
| `#2f9e6a` / `#eaf7f0` | none | correct answer |
| `#d9534f` / `#fdeeee` | none | wrong answer |
| `#f0c96a` / `#fff8e8` / `#7a5218` | none | over-time state |

**Radii:** 10px for small chips and rows, 12 to 14px for inputs and inner blocks, 16 to 18px for rail cards, 20 to 22px for the briefing strip and work card, 999px for pills.

**Spacing:** 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 28, 34.

**Shadows:** cards `0 18px 44px rgba(24,36,70,.06)`; primary button `inset 0 1px 0 rgba(255,255,255,.25), 0 8px 20px rgba(36,80,199,.28)`.

**Typography**
| Role | Font | Size and weight |
|---|---|---|
| Work card title | Newsreader | 500 36px/1.08, `-.016em` |
| Briefing method name | Newsreader | 500 30px/1.08, `-.016em` |
| Topic (header) | Newsreader | 500 21px, `-.01em` |
| Tip title, target | Newsreader | 500 20px and 16px |
| Clock | Newsreader | 500 32px, tabular-nums |
| Kickers and labels | JetBrains Mono | 700 10px, `.09em`, uppercase |
| Minutes, step counter | JetBrains Mono | 500 10px |
| Body | Inter | 400 13 to 15.5px, line-height 1.5 to 1.7 |
| Buttons, step labels | Inter | 600 to 700 12.5 to 14px |

All four families are already loaded in `src/app/layout.tsx` via `@fontsource`. Newsreader is currently used on the landing page only; this design brings it into the app surface deliberately, so confirm that is wanted before shipping.

## Assets
None. No images, no new icons. Icons in the shipped component (`lucide-react`: `Clock3`, `ArrowRight`, `Check`, `X`, `AlertCircle`, `Sparkles`, `HelpCircle`, `RotateCcw`) can be reused as they are. The prototype omits them and uses a text arrow on the primary button; prefer the existing `<ArrowRight size={16} />`.

## Files
- `Session Hub.dc.html`, the prototype. Open it in a browser; the frame badged **3A** is the design in scope. Interactions are live, covering step navigation, shape toggle, timer, MCQ reveal, and hide or show timer.

### Repository files this touches
- `src/components/baseline-session.tsx`, the screen being redesigned. Its state machines, slot requests and step card content stay.
- `src/components/baseline-session.module.css`, replaced or extended by the hub styles.
- `src/components/study-method-briefing.tsx` and its `.module.css`, the closest existing component to the briefing strip. The strip can be a restyled variant of it rather than a new component.
- `src/lib/learning/method-catalog.ts`, the `what`, `why`, `how` and `completion` copy for the strip.
- `src/lib/routing/personalization-note.ts` and `src/lib/routing/session-route.ts`, for reasons, rule ids, timer minutes, and the produce step.
- `src/lib/session-shapes/shape-a.ts` and `shape-c.ts`, the step sequences and labels behind the rail's step list.
- `docs/redesign/01-SESSION-SHAPES.md`, the authoritative description of both shapes.
