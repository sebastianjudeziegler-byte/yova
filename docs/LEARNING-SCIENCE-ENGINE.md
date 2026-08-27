# YOVA Learning Science Engine

Updated: August 7, 2026

> **Implementation snapshot:** This document describes the learning-science engine currently in the product. For the canonical next-architecture contract—including deterministic route ownership, profile-aware method selection, duration routing, learner agency, and the staged migration plan—see [`docs/PERSONALIZATION-SYSTEM-SPEC.md`](./PERSONALIZATION-SYSTEM-SPEC.md). Where the two describe different future behavior, the personalization system specification takes precedence; this document remains authoritative for existing behavior until each migration milestone ships.

## Product thesis

YOVA should not merely ask a language model to “make a personalized study plan.” The product needs its own scientific structure:

```text
Learning task + current knowledge + prior performance + learner context
                              ↓
                 bounded method candidates
                              ↓
           OpenAI chooses and composes the session
                              ↓
       YOVA explains the method and records the result
                              ↓
              the next recommendation changes
```

OpenAI is the reasoner and content generator. YOVA owns the method catalog, allowed evidence, memory, quality gates, and feedback loop.

## What is treated as the durable core

These rules have a meaningful research base and are appropriate as YOVA's default scientific guardrails:

- Retrieval practice and practice testing for durable recall.
- Distributed or spaced practice instead of one massed exposure.
- Worked examples with fading for novices doing complex problem solving.
- Reduced guidance and more generation or variability as knowledge grows.
- Interleaving after a foundation exists, especially when learners must discriminate between related problem types.
- Self-explanation and concrete-to-abstract explanation for conceptual understanding.
- Question-led reading followed by closed-source recall instead of highlighting alone.
- Prediction-versus-outcome comparisons to improve metacognitive calibration.
- Targeted error classification and repair after practice.

The first formal catalog contains nine methods:

1. Retrieval practice
2. Spaced retrieval
3. Self-explanation
4. Worked example fading
5. Interleaved practice
6. Read-recall-review
7. Retrieval-based outlining
8. Scaffolded coding with fading
9. Practice test and error repair

Every method must define four learner-facing elements:

1. What the learner is doing
2. Why the method fits
3. How to perform it
4. What completion means

## What remains an adaptive delivery layer

Learner tendencies can change delivery without overruling the task-appropriate learning method. Examples:

- A difficult starting pattern can produce a smaller first action.
- A high need for structure can reveal one step at a time.
- Repeated early exits can reduce switching and activity count.
- A preference for examples can move one concrete example earlier when the method allows it.
- Repeated strong performance can fade guidance and increase independent application.

These are not fixed brain types. They are cautious product decisions based on declared preferences and observed behavior.

## What is still a product hypothesis

The wider tendency playbook is inspiration, not settled truth. YOVA should test rather than claim:

- that a specific delivery modifier improves completion for a particular tendency;
- that one representation consistently improves a person's learning;
- that one session duration is globally optimal for a person;
- that a method works better for an individual after only one exposure;
- that behavior inside YOVA reveals a diagnosis, intelligence level, or fixed learning style.

These ideas may become useful when repeated comparable data supports them. Until then, YOVA uses cautious language such as “this helped in recent sessions,” not “your brain learns best this way.”

## The first implementation

The current engine:

- classifies each session into a task family;
- weighs action signals from the goal and current objective instead of trusting the first matching keyword, so phrases such as “protein function,” “genetic code,” or “an article about photosynthesis” do not accidentally become programming or reading drills;
- gives the current session objective more influence than a broad goal title, source label, or stale AI method name;
- estimates a coarse knowledge stage from the plan and repeated performance;
- creates a bounded list of approved methods;
- gives OpenAI the catalog, evidence basis, delivery modifiers, and guardrails;
- requires the generated session to return a structured method briefing;
- validates that the chosen method is allowed for that task;
- shows the learner what, why, how, and done at the beginning of the session;
- renders the session's real method phases as a visible roadmap rather than leaving the sequence hidden in AI metadata;
- labels each activity with its learner action and current support state, such as “See a complete model — Full support” or “Perform independently — Support hidden”;
- records the phase attached to every completed knowledge check, so a guided success is no longer treated as equivalent to an unsupported success;
- builds a concept-level support trajectory from completed evidence: restore support after a gap, fade it after an initial secure check, and require changed-context transfer after repeated independent success;
- validates that the generated activity sequence actually performs that support decision, rather than trusting personalized wording;
- shows the resulting Support Progression and its evidence basis at the start of the learner's session;
- preserves the same phase structure in built-in fallback sessions when generation is unavailable;
- captures confidence before knowledge checks and compares it with the result;
- distinguishes possible misconceptions from correct-but-uncertain knowledge when adapting the next session;
- requires an immediate explain-back when a knowledge check is missed, while preserving the original miss as evidence;
- excludes that immediate repair from mastery scoring because seeing the correction and repeating it is not durable recall;
- schedules a delayed verification session when the final session in a goal exposes a gap, so a one-session goal cannot be marked complete prematurely;
- gives every observed concept a transparent return policy based on its latest completed evidence;
- schedules a quick retrieval-and-repair return after a miss, verification after an early success, and a lighter transfer check after repeated secure evidence;
- feeds due concept reviews into generated sessions and rejects a session that skips the highest-priority due concept;
- turns completed concept evidence into an actionable Agenda retrieval queue;
- routes a due concept into the next active session or atomically reopens a completed goal with one bounded verification session, preserving its original history;
- describes the intervals as product heuristics rather than a perfect memory or mastery prediction;
- keeps in-session tutoring anchored to the exact current activity and support phase, so a hint preserves the learner's attempt and a repair explanation addresses the observed gap rather than replacing the session with generic chat;
- gives the tutor answer state but never the learner's typed free response, separating useful coaching context from unnecessary storage or transmission;
- renders technical notation consistently across the lesson, worked model, questions, feedback, and saved resources, so the learning sequence is not undermined by raw model formatting;
- requires mathematical models to separate the setup, transformations, and final result instead of compressing a procedure into one opaque paragraph;
- keeps method choice separate from productivity adjustments.

This is a hybrid system. Deterministic TypeScript protects the scientific boundaries. OpenAI handles nuance, subject-specific teaching, wording, examples, and activity composition.

## Teaching-first versus practice-first

YOVA separates two jobs that ordinary study generators often blend together:

- **Teaching first:** build an accurate idea or procedure, guide one attempt, fade the help, then check independent performance.
- **Practice first:** start with retrieval or application before showing the answer, identify the gap, review only that gap, then retry.

The learner is not asked to understand “learning mode” or “study mode.” YOVA asks what the learner can currently do: whether the material is new, unclear, understood but unpracticed, or ready for a recall test. That concrete answer becomes an internal learning approach.

Every generated plan session carries its own approach. A larger plan can begin with teaching-first sessions and later transition into practice-first sessions. A review plan begins practice-first, but a weak result can convert the next session into teaching-first repair.

The OpenAI session generator is bounded by a different activity-order contract for each approach:

1. Teaching-first sessions must begin with an explanation, model, or complete example.
2. Practice-first sessions must begin with an unsupported question or application attempt.
3. Both approaches must eventually require independent work and produce evidence for the next session.

This distinction is visible on Home, the plan timeline, the generated-plan result, and the method briefing. The learner can understand what YOVA is trying to accomplish without choosing educational terminology.

## What makes the long-term product interesting

The defensible direction is not “we use retrieval practice.” Any study product can add flashcards. The stronger system is:

1. YOVA identifies the kind of learning job.
2. It estimates what support is currently appropriate.
3. It selects a method with an inspectable reason.
4. It teaches the user how to execute that method.
5. It captures concept-level results and confidence.
6. It repairs an exposed misunderstanding before the learner leaves, without pretending that repair proves mastery.
7. It schedules a new attempt after a delay based on what happened.
8. It compares methods only after repeated, comparable evidence.

That closed loop can eventually become a meaningful learning decision system rather than a static resource generator.

## Next scientific product layers

1. Expand specialized learner-input mechanics beyond the new quantitative workpad. The first version captures numbered mathematical reasoning and a final answer; future versions can attach feedback to each exact line, execute code, and evaluate learner-built diagrams.
2. Build controlled method comparisons within comparable task-and-stage groups once real usage provides enough repeated data. YOVA now prevents unrelated tasks and knowledge stages from being pooled together.
3. Review outputs with learning-science and subject-matter experts before broad claims.

## Evidence anchors

- Dunlosky et al. (2013), *Improving Students' Learning With Effective Learning Techniques*, DOI `10.1177/1529100612453266`.
- Roediger and Karpicke (2006), *Test-Enhanced Learning*, DOI `10.1111/j.1467-9280.2006.01693.x`.
- Cepeda et al. (2006), *Distributed Practice in Verbal Recall Tasks*, DOI `10.1037/0033-2909.132.3.354`.
- Kalyuga et al. (2003), *The Expertise Reversal Effect*, DOI `10.1207/S15326985EP3801_4`.

The founder paper remains the product synthesis. The catalog above deliberately excludes its TTM layer and treats broad trait-to-method mappings as hypotheses unless stronger evidence and product data justify them.
