# YOVA plan-quality evaluation

A plan can satisfy the JSON schema and still be generic, badly sequenced, or mismatched to the learner's task. YOVA therefore treats **technical validity** and **educational quality** as separate checks.

## Current evaluation set

The first plan suite covers five deliberately different journeys:

1. biology test preparation using learner-supplied notes;
2. calculus problem solving;
3. history essay work completed outside YOVA;
4. beginner JavaScript practice;
5. general-learning personal finance.

Each case includes a goal, starting evidence, availability, source choice, execution mode, and bounded learner-profile summary.

## What the rubric checks

- a useful number of sessions;
- every session fits a supplied time window;
- nothing is scheduled after a real deadline;
- methods match conceptual, problem-solving, writing, coding, or general-learning work;
- the sequence progresses toward retrieval, application, assessment, or independent work;
- method choices have learner-facing reasons;
- sessions do not repeat the same objective;
- the plan avoids fixed “brain type” and learning-style claims;
- uploaded source content is not used to invent personal learner traits.

Required failures fail the case even when the numerical score is high. The overall passing threshold is 80/100.

## Two kinds of evaluation

`pnpm test` runs the rubric against controlled local fixtures. It is free, fast, and confirms that the scoring rules behave as intended.

`pnpm eval:plans` sends all five cases to the configured OpenAI model and scores the real generated plans. This command consumes API credits and is intentionally never part of an ordinary build, deployment, or test run.

To evaluate one case while tuning a prompt:

```bash
YOVA_EVAL_CASE=calculus_problem_solving pnpm eval:plans
```

Available case IDs are defined in `src/evals/plan-cases.ts`.

## How to use results

1. Run one case while changing a prompt or routing rule.
2. Inspect the failed rubric lines, not merely the total score.
3. Improve the underlying instruction or deterministic rule.
4. Run the full five-case suite before deploying a meaningful generation change.
5. Add a new case whenever a real tester exposes a new failure pattern.

This is not proof that YOVA improves grades. It is a repeatable product-quality gate that prevents obvious regressions and turns subjective prompt review into a more disciplined engineering process.
