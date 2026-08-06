# YOVA guided-session quality evaluation

The plan decides what a learner should do. The guided session determines whether YOVA actually helps them learn. A valid JSON response is therefore only the first requirement.

## Current evaluation set

The first session suite covers:

1. initial biology teaching grounded in learner-supplied notes;
2. targeted calculus repair after a weak knowledge check;
3. history writing completed from a textbook and notes outside YOVA;
4. beginner JavaScript practice with support that fades;
5. practical general-learning personal finance.

## What the rubric checks

- activity count fits the planned session duration;
- the learner must answer at least two questions rather than only consume content;
- questions have usable reference answers, distinct choices, and explanatory feedback;
- activity language matches conceptual, problem-solving, writing, coding, or general-learning work;
- the session moves from appropriate support into learner practice;
- uploaded material remains the factual anchor;
- known `needs_review` concepts appear in the session;
- outside-YOVA sessions provide a concrete action using the learner's external source;
- the rationale explains the sequence;
- learner-facing language avoids fixed brain types, diagnoses, and learning-style claims.

Required failures fail the case even if the total score is above 80/100.

## Running the evaluator

`pnpm test` checks the rubric against controlled local fixtures without using API credits.

`pnpm eval:sessions` generates and scores all five real OpenAI sessions. It consumes API credits and is never part of a normal build or deployment.

To run one case:

```bash
YOVA_SESSION_EVAL_CASE=biology_initial_teaching pnpm eval:sessions
```

Case IDs are defined in `src/evals/session-cases.ts`.

The command loads the local server-only OpenAI configuration before starting Vitest. The key is checked but never printed or exposed to browser code.

This quality gate does not prove learning outcomes. It prevents defined structural failures and creates a repeatable checkpoint for changes to the session prompt or personalization logic.

## First live checkpoints

On August 5, 2026:

| Case | Result | What it established |
|---|---:|---|
| Biology teaching from learner notes | 100/100 | Six time-bounded activities, three learner-response steps, and explicit use of both expected source concepts |
| Calculus repair after a weak check | 100/100 after one prompt repair | Four practice activities reused the exact `Quotient rule` review label so new evidence remains connected to the stored weak concept |

The first calculus run scored 90/100 because it did not preserve the stored concept label. The generation instruction now requires an applicable `needs_review` concept to be reused exactly in at least one question's concept field. The next live run passed. This is a product-memory repair, not cosmetic prompt tuning: consistent concept names allow YOVA to accumulate evidence across sessions.

The remaining writing, coding, and general-learning session cases still need live execution and human review.
