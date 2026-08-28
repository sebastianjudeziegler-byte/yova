# YOVA guided-session quality evaluation

The plan decides what a learner should do. The guided session determines whether YOVA actually helps them learn. A valid JSON response is therefore only the first requirement.

## Current evaluation set

The source-defined session suite now contains 18 cases. It retains the original five journeys—biology teaching from notes, calculus repair, outside-YOVA history writing, scaffolded JavaScript, and practical finance—and adds short and long beginner lessons, mapped multi-target work, delayed retrieval, vocabulary, startup funding, primary-source reasoning, literature close reading, language transfer, and thin-source teaching.

[`src/evals/session-cases.ts`](../src/evals/session-cases.ts) is authoritative for the current case IDs. Historical result tables below describe the smaller suite that was actually run on the recorded date; they are not claims that every later case has received the same live run.

## What the rubric checks

- activity count fits the planned session duration;
- the learner must answer at least two questions rather than only consume content;
- questions have usable reference answers, distinct choices, and explanatory feedback;
- activity language matches conceptual, problem-solving, writing, coding, or general-learning work;
- the session moves from appropriate support into learner practice;
- uploaded material remains the factual anchor;
- known `needs_review` concepts appear in the session;
- outside-YOVA sessions provide a concrete action using the learner's external source;
- the selected method comes from the task-appropriate catalog and explains what, why, how, and completion;
- the rationale explains the sequence;
- learner-facing language avoids fixed brain types, diagnoses, and learning-style claims.

Required failures fail the case even if the total score is above 80/100.

## Running the evaluator

`pnpm test` checks the rubric against controlled local fixtures without using API credits.

`pnpm eval:sessions` generates and scores every current OpenAI session case. It consumes API credits and is never part of a normal build or deployment.

To run one case:

```bash
YOVA_SESSION_EVAL_CASE=biology_initial_teaching pnpm eval:sessions
```

Case IDs are defined in `src/evals/session-cases.ts`.

The command loads the local server-only OpenAI configuration before starting Vitest. The key is checked but never printed or exposed to browser code.

This quality gate does not prove learning outcomes. It prevents defined structural failures and creates a repeatable checkpoint for changes to the session prompt or personalization logic.

## First live suite

On August 5, 2026:

| Case | Result | What it established |
|---|---:|---|
| Biology teaching from learner notes | 100/100 | Six time-bounded activities, three learner-response steps, and explicit use of both expected source concepts |
| Calculus repair after a weak check | 100/100 after one prompt repair | Four practice activities reused the exact `Quotient rule` review label so new evidence remains connected to the stored weak concept |
| History writing outside YOVA | 100/100 | Concrete textbook-and-notes directions, thesis selection, retrieval-based outlining, and evidence-to-claim checking |
| Beginner JavaScript with fading support | 100/100 | One concise teaching step followed by five tracing, selection, explanation, and coding activities |
| General-learning personal finance | 100/100 | Practical interest and credit-utilization examples followed by retrieval and scenario decisions |

The first calculus run scored 90/100 because it did not preserve the stored concept label. The generation instruction now requires an applicable `needs_review` concept to be reused exactly in at least one question's concept field. The next live run passed. This is a product-memory repair, not cosmetic prompt tuning: consistent concept names allow YOVA to accumulate evidence across sessions.

All five cases in that original live run passed the automated rubric. Human review of factual explanations, distractor quality, tone, and real learner usefulness remains necessary. Future tester failures should become new evaluation cases instead of being treated as isolated anecdotes.

## Learning-science engine rerun

After the formal method catalog and structured method briefing were added on August 5, the full live plan suite still passed five of five cases at 100/100. The live guided-session suite selected the intended catalog methods across the cases:

- biology: self-explanation;
- calculus: worked example fading;
- history writing: retrieval-based outlining;
- JavaScript: scaffolded coding with fading;
- finance: retrieval practice.

The first JavaScript rerun scored 85/100 because one question returned feedback that was structurally valid but too thin to be educationally useful. YOVA now requires at least a full explanatory sentence in every question's feedback contract. The targeted JavaScript rerun passed 100/100. This shows the evaluator is checking teaching quality boundaries, not only whether OpenAI returned valid JSON.
