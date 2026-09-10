# BRIEF 1 — Session shapes and routing

Branch: `codex/baseline-sessions-routing`
Base: current `main`

Read `docs/redesign/00-SCOPE.md` first, then `06-STANDING-RULES.md`. Both
govern this brief. Then `01-SESSION-SHAPES.md`, `02-ROUTING.md`,
`03-ONBOARDING.md`, `04-AI-SLOTS.md`.

## Why

Today every session runs the same shape with a different method label on top.
The learner's profile changes almost nothing they can see, and the session
content is authored by the model in one open-ended generation, which is the
source of most live failures. This brief makes the method name mean something,
makes the profile drive real routing, and shrinks the AI's job to bounded slots.

## Before you start

1. Tag current `main` as `vision-freeze-2026-09-10` and push the tag. The full
   build must be preserved before anything is narrowed.
2. Read `src/lib/learning/method-catalog.ts`. The twelve methods already carry
   `how` steps and a `completion` rule. Nothing in the code reads them — that is
   the problem this brief fixes. Do not invent new methods.

## Scope

### 1. Shape A and Shape C as coded flows
Implement per `01-SESSION-SHAPES.md`. State machines, not generated structure.
Shape B is **out of scope** — route procedural task types to Shape A with a
worked example as the source, and note it as a temporary route in code.

### 2. The routing function
Implement the five layers and all six conflict rules from `02-ROUTING.md` as a
pure function. **Every decision must return the rule ID that fired.** Unit-test
the input space exhaustively — it is finite.

### 3. Onboarding reorder + stable IDs
Reorder per `03-ONBOARDING.md`, rewrite Q6 and Q7 with the given wording, and
**migrate `onboardingAnswers` from position-indexed to question-ID-keyed**, with
a one-time migration for existing saved profiles. Follow the
`LEGACY_ONBOARDING_LABEL_IDS` pattern. Routing reads option IDs, never labels.

### 4. AI slots
Implement slots 1–4 per `04-AI-SLOTS.md`. The critical constraint: the
explanation, key points, and questions for a no-source learn block are produced
**in one call from one shared context**. Retry once on failure, then an honest
error. Never fabricated content.

### 5. Practice composition
Per `04-AI-SLOTS.md`: 3–8 questions from key points, profile weighting, rounds
with a hard ceiling of 3 then escalation. MCQ only.

### 6. Dropdowns replace free text
Anywhere a learner changes something about a session or method, it is a
dropdown or button. No free-text parsing anywhere in this path.

### 7. Session end screen
What's next, plus a one-sentence personalization note built from the rule ID.

### 8. Retire what this replaces
The prose validators that inspect generated content to guess whether it taught
the right thing are superseded by structure. Remove them from the live path
where a coded shape now guarantees the property. **List every one you retire and
what now guarantees it.** Keep the negative tests from Brief 0.5 green —
off-topic, deferred-topic, and genuine-duplicate rejection must still hold.

## Out of scope

Plan model (Brief 2), Shape B, ingestion, syllabus, natural-language anything,
calendar. If a change wants to touch the Brief B revision pipeline, stop and ask.

## Gates

- Personalization delta test per `02-ROUTING.md`, asserting on rule IDs.
  Permanent, and it gates this PR.
- Existing create → activate → open session → complete passes unchanged.
- Full gate in CI. Live gate blocks only on regression versus main.
- Migration test: existing saved profiles survive the ID change intact.

## Deliver

PR with `EVIDENCE.md` containing: red/green per item, two contrasting profiles'
sessions side by side for the same topic, the list of retired validators with
what replaced each, and the routing function's test coverage of the input space.
