# YOVA Baseline — Scope

**Read this before any other document in this folder.**

## The constraint

We are building a **smaller YOVA** that can be launched publicly and charged for.
Not a refinement of the current app — a deliberate shrink to a baseline that is
reliable, usable, and still carries the differentiation.

Two tests every change must pass:

1. **Is it reliable?** Would a stranger paying money hit a bug or a dead end?
2. **Does it carry the differentiation?** Does the learner's profile and
   demonstrated knowledge visibly change what they get?

If a change fails either test, it does not go in the baseline.

## The differentiation, in one line

> YOVA finds out what you know and how you learn, and the plan and the practice
> change because of it.

## The shape of the work

This is mostly **deletion and simplification**, not new construction:

- the time-first plan composer is replaced by a much smaller topic-based one
- free-text change parsing is removed entirely
- prose validators are replaced by structure that cannot drift
- two coded session shapes replace one infinitely variable generated session

The only genuinely new code is the routing table (a pure function) and the two
session shape flows (state machines). Both are the most testable kind of code
there is.

## Out of scope for the baseline

Flag off, do not delete. Tag `main` as `vision-freeze-2026-09-10` first so the
full build is preserved.

- Syllabus import
- Natural-language "Add to YOVA" / calendar parsing
- YouTube, audio and video file ingestion (a pasted URL may still be a source
  to watch; no practice is generated from it)
- Study Profile growth funnel and waitlist gating
- TTM stage logic
- Cross-plan knowledge memory (first thing to add back in v2)
- Adaptive routing that learns from outcomes
- Calendar extras: recurring events, multi-view, Canvas/Google sync
- Shape B (worked example → faded → independent) — **Week 2**, not launch.
  Until then procedural topics route to Shape A with a worked example as the
  source.

## Anything not in these documents does not go in the codebase

It goes in the vision prototype. This rule exists because the scope has grown
back before, one "but this makes it feel like YOVA" at a time.

## Launch sequence

1. Baseline feature-complete
2. 5–10 free testers for two weeks
3. Fix what they hit
4. Paid launch

No paid launch before real humans have used it.
