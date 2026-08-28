# YOVA Personalization System Specification

Status: frozen product contract; Milestone 0 baseline complete
Updated: August 23, 2026
Scope: high-school and university students studying real course material

Implementation records: [`PERSONALIZATION-MILESTONE-0.md`](./PERSONALIZATION-MILESTONE-0.md) · [`STUDY-ROUTE-IMPACT-MAP.md`](./STUDY-ROUTE-IMPACT-MAP.md)

This is the canonical definition of YOVA's core differentiation and the implementation contract for improving the existing product. It is not a claim that every part described here is already shipped. Sections explicitly distinguish current foundations from target behavior.

## 1. Product definition

YOVA is a closed-loop study-orchestration system.

For each learning goal, YOVA builds and runs the next evidence-constrained session recipe: whether the session should teach or practice, which learning method should lead, what supporting technique is appropriate, what content should be covered, in what order, at what difficulty, with how much help, for how long, and when the learner should return.

The task and desired outcome determine what is pedagogically eligible. Topic-specific knowledge determines difficulty and scaffolding. The learner's profile, prior method history, explicit choices, available time, schedule, accessibility needs, and current context determine which eligible route is most appropriate and feasible. Completed work and later checks update future recommendations.

YOVA shows the learner the resulting recipe and a concise reason. The learner may let YOVA decide, ask for bounded choices, or customize the session. YOVA is explicit about which conclusions come from the task, what the learner reported, what YOVA observed, and what remains uncertain.

The shortest differentiation statement is:

> YOVA does not only generate study materials. It decides how the materials should be combined into the next study session, runs that session, and uses the result to improve the next decision.

The preferred positioning language is:

> Built from you. Refined by results.

Until stronger outcome evidence exists, YOVA should say that it **recommends or builds a defensible route**, not that it has proven the one best way for a student to learn.

## 2. Non-negotiable product principles

1. **Improve the current product; do not rebuild it.** Existing plans, sessions, Home, Agenda, You, method routing, support progression, review scheduling, generated-resource caching, and recovery flows are migration inputs.
2. **Personalization may change the method, not only the presentation.** Task and knowledge rules establish safe boundaries; learner profile and repeated results meaningfully rank the methods that survive.
3. **Personalize the intervention, not the learner's identity.** YOVA must not label a student as a visual learner, auditory learner, fixed personality type, diagnosis, intelligence level, or permanent brain type.
4. **Compute everything computable.** Code owns route selection, duration, phase count, phase order, identifiers, timing, scheduling, difficulty bounds, support bounds, validation, and persistence.
5. **Use generative models at the semantic edge.** A model may fill bounded subject-specific teaching, examples, questions, feedback, and prose. It does not invent the session contract it is supposed to obey.
6. **One route, everywhere.** Plan, Home, Agenda, setup, active session, and post-session evidence must refer to the same versioned route rather than independently reconstructing it.
7. **Prefer a usable degraded path to an error screen.** Preserve a valid structure and fall back to simpler source-grounded content when generation is imperfect. Do not fabricate content when grounding is unavailable.
8. **Keep the experience quiet.** Personalization should be visible but not noisy. Show the decision, not the internal machinery.
9. **Preserve student control.** Recommendations can be strong; they cannot become unexplained locks.
10. **Do not manufacture differences.** Two learners with the same relevant task, knowledge, constraints, profile signals, and evidence may correctly receive the same route.

## 3. What already exists and should be reused

YOVA currently has substantial parts of this system:

- a deterministic task-family classifier;
- a coarse knowledge-stage inference;
- Learn and Practice session behavior represented internally as teaching-first and practice-first;
- a nine-method evidence catalog;
- task- and stage-bounded method eligibility;
- learner-fit method ranking;
- method-specific phase-fidelity validation;
- delivery policies for first-action size, support, representation, activity count, and pacing;
- concept-level evidence, confidence capture, repair, scaffold fading and restoration;
- delayed verification and Agenda review scheduling;
- visible method briefings and explanations;
- session resource caching, resume, and degraded fallback behavior;
- method-outcome and personalization-evidence data structures;
- manual duration adjustment and fixed schedule recommendations.

The new architecture should wrap and evolve these components instead of replacing them wholesale.

Important current limitations to remove:

- a task-valid method already written into a plan is pinned at session routing time, so learner-fit ranking may primarily alter delivery rather than the named method;
- plan generation, runtime routing, UI method signals, and outcome signals do not yet share one canonical decision object;
- onboarding, the optional Study Profile, and the deeper learner profile overlap and can expose too many questions;
- current copy sometimes states that the task chooses the method while the learner changes only pacing or presentation, which is narrower than this contract;
- current duration recommendation is mostly derived from declared text rather than a full deterministic duration policy;
- current automated tests prove many isolated rules but not the entire same-task/different-learner route;
- the existing experiment subsystem is more complex than the agreed v1 and is not required for the new default behavior.

## 4. The learner-facing model

### 4.1 Two session types

YOVA exposes only two primary session types:

#### Learn

Use Learn when the material is new or insufficiently understood.

A Learn session normally:

1. establishes or diagnoses the initial model;
2. teaches or demonstrates the idea;
3. guides an attempt;
4. fades help;
5. ends with an independent check.

#### Practice

Use Practice when the learner has encountered the material and needs retrieval, application, discrimination, fluency, or exam preparation.

A Practice session normally:

1. begins with unsupported retrieval or application;
2. identifies the exposed gap;
3. inserts a short repair when necessary;
4. retries or transfers the idea;
5. schedules a return when appropriate.

An exam-like experience is an option inside Practice, not a third session type. Repair is an internal response, not another mode the learner must choose.

YOVA recommends Learn or Practice. The learner may change it. A small repair may happen automatically inside Practice; converting the whole session to Learn requires approval unless the learner is using YOVA Decides and the change occurs between sessions with a visible explanation.

### 4.2 One dominant method

Every normal session has:

- one primary learning method;
- at most one learner-visible supporting-technique label when it has a specific job;
- a duration and deterministic phase recipe;
- a future-review decision when the evidence calls for one.

YOVA must not create a confusing stack of several co-equal methods. Internally, a method recipe may still use multiple bounded pedagogical primitives—such as confidence prediction, corrective feedback, repair, and an independent check—when each has an explicit phase, purpose, time budget, and provenance. Those primitives are parts of the recipe, not additional learner-facing methods.

### 4.3 Cognitive mode and execution environment are separate

Learn and Practice describe the cognitive job. They do not describe where the work happens.

Every route separately preserves YOVA's existing execution environment:

- **Inside YOVA:** YOVA presents the teaching, questions, workpad, and feedback.
- **Outside YOVA:** YOVA provides the method and exact steps for work completed with another trusted source, assignment, workbook, editor, or physical workspace.

An essay draft, workbook assignment, or coding task can therefore be a Learn or Practice route executed outside YOVA. Outside work does not become mastery evidence merely because the learner marked the task complete; it needs a separate YOVA-observed verification when knowledge evidence is required.

### 4.4 No separate productivity catalog in the main experience

The central timing decision is session length, not a second catalog of productivity systems.

- An ordinary session proceeds continuously without a named "Standard" protocol.
- A longer session may offer an optional **Add a timed break** setting.
- A five-minute start is a delivery adjustment for starting friction, not a separate method.
- Flowtime is deferred from v1.
- Productivity timing never determines the learning method.
- Inserting a break is a deterministic client/application operation and does not trigger content regeneration.

## 5. Agency modes

YOVA supports three levels of control without placing all three in the learner's face on every screen.

### YOVA Decides

- YOVA selects the recommended valid route.
- Between sessions, a sufficiently supported change may apply automatically.
- The changed method, duration, or structure is clearly identified before the learner begins.
- The learner can still open **Change** and override it.

### Help Me Choose

- YOVA presents the recommendation and at most two defensible alternatives.
- Major changes require a learner confirmation.
- Alternatives are explained in terms of their tradeoff for this task.

### I'll Customize

- Eligible methods appear first.
- Questionable methods remain accessible under **Other methods** rather than being silently hidden.
- YOVA gives a concise conflict explanation and maps the request to the closest safe implementation when needed.
- The learner's selection persists for that session unless it becomes impossible or unsafe.

The normal session card should still have one obvious **Start** action and one secondary **Change** action.

## 6. The canonical StudyRoute

Every planned or active session must reference one versioned `StudyRoute`. The final TypeScript and database names may change, but the semantic contract is:

```text
StudyRoute
  identity
    routeLineageId
    routeRevisionId
    revisionNumber
    schemaVersion
    lifecycleStatus: provisional | committed | superseded
    planId
    sessionId
    createdAt
    committedAt?
    supersedesRevisionId?

  target
    taskFamily
    desiredOutcome
    targetStates[]
      targetId
      stage
      uncertainty
      evidenceRefs[]
      lastObservedAt?
      nextReview?
    sourceRequirements

  approach
    mode: learn | practice
    executionEnvironment: inside_yova | outside_yova
    primaryMethodId
    visibleMethodName
    visibleSupportingTechniqueId?
    confidenceLevel

  timing
    activeMinutes
    elapsedMinutes
    durationSource
    hardMaximumMinutes?
    optionalTimedBreak?

  execution
    orderedPhases[]
    difficultyTier
    initialSupport
    activityLimit
    completionEvidence
    deferredTargets[]

  agency
    controlMode
    selectedBy
    alternatives[]
    override?

  explanation
    shortReason
    taskRequirements[]
    learnerDeclarations[]
    observations[]
    uncertainties[]

  provenance
    routerVersion
    profileVersion
    evidenceRefs[]
    ruleTrace
```

The model receives the fixed execution skeleton and fills permitted semantic slots. The model's response cannot change route identity, method, mode, execution environment, duration, phase order, difficulty bounds, committed target identifiers, or scheduling decisions.

### 6.1 Route lifecycle

`routeLineageId` identifies the decision lineage for one planned session. `routeRevisionId` identifies one immutable revision inside that lineage.

- **Provisional:** a candidate route created before the learner confirms a plan or a proposed change.
- **Committed:** the authoritative revision consumed by Plan, Home, Agenda, setup, generation, and the active session.
- **Superseded:** an older committed revision replaced by a newer committed revision. It remains immutable for explanation, cache provenance, and outcome comparison.

A material change to the targets, mode, execution environment, primary method, duration, phase order, support bounds, or review contract creates a new revision. Code never silently mutates a committed revision. The new revision records its predecessor and the reason for change. Evidence attaches to the exact committed revision that the learner actually used.

A near-session feasibility check that finds no material change keeps the existing committed revision. If it proposes a material change, YOVA creates a provisional successor and follows the learner's agency mode before committing it.

### 6.2 Per-target state

Knowledge stage, uncertainty, evidence, and review timing belong to each target rather than to the session as a whole. Learn or Practice remains the dominant route-level mode.

If one route includes targets at different stages, its phase recipe may give them different support. If their needs are incompatible—for example, one requires first instruction while another requires an unsupported exam-like check—code splits or defers targets instead of pretending they share one knowledge state.

`targetStates` are immutable snapshots of the authoritative knowledge and review models at routing time, not a second mutable mastery store.

Every question, answer evaluation, repair, review, and evidence event that may update knowledge must carry the relevant stable target identifier. Evidence without a trustworthy target mapping may support only session-level execution analytics, not target mastery.

## 7. Inputs and authority

The router uses five evidence sources with explicit authority:

1. **Task requirements**: the learning job, intended outcome, source material, assessment form, and content constraints.
2. **Knowledge evidence**: what the learner has encountered, demonstrated, missed, transferred, or retained for the current knowledge targets.
3. **Learner declarations**: goals, sustainable session length, prior method experience, explanation and support preferences, accessibility needs, and preferred working periods.
4. **Current constraints**: available minutes, deadline, scheduled clock time, device or source availability, and optional temporary context.
5. **Observed outcomes**: independent accuracy, transfer, delayed retention, completion, early exits, confidence calibration, support level, and active time.

The authority order is not one global list. Different inputs own different decisions:

- task and knowledge own eligibility and scaffolding boundaries;
- explicit available time is a hard duration cap;
- accessibility constraints are hard product constraints;
- learner profile and prior history rank eligible methods and shape delivery;
- repeated comparable outcomes can eventually outweigh self-report;
- explicit student choice remains decisive among genuinely equivalent routes.

Missing evidence must produce a task-and-knowledge baseline, not invented personalization.

## 8. Deterministic routing algorithm

### Stage 1: establish the learning job

Understanding arbitrary learner language and long source documents is semantic work. A model may propose source-anchored target candidates and bounded task classifications under a strict schema. It may not create durable target identity, assign demonstrated knowledge, or choose the pedagogical route.

Code then:

- validates source anchors, scope, and schema;
- canonicalizes and assigns stable target identifiers;
- deduplicates targets and preserves prerequisite relationships;
- accepts or rejects the bounded task classification;
- determines the Learn or Practice recommendation;
- resolves each target's current topic-specific knowledge stage and uncertainty;
- enforces required assessment and source constraints.

The learner can correct scope and emphasis. Claiming to know a target does not create knowledge evidence by itself.

Initial task families remain:

- memorization;
- conceptual learning;
- problem solving;
- reading to quiz;
- writing and argumentation;
- programming;
- mixed assessment.

### Stage 2: hard eligibility

Code removes methods that conflict with:

- session type;
- task family;
- the relevant targets' knowledge stages;
- source requirements;
- required output or assessment format;
- accessibility or interaction constraints;
- insufficient time for the method's minimum coherent recipe.

This stage is not personalized scoring. It is the evidence-constrained boundary.

### Stage 3: rank eligible methods

Each survivor receives a transparent internal score from:

- task-and-stage affinity;
- learner-profile fit;
- self-reported past success with the method or its primitives;
- comparable observed outcome evidence;
- current feasibility;
- continuity with the current topic route;
- any explicit method preference.

Observed evidence gains authority gradually. A single answer must not create a learner identity or permanent method rule.

Initial evidence progression:

- one comparable session: observing;
- two to three comparable sessions: early signal;
- approximately four or more comparable sessions with independent or later retrieval evidence: recent results support the recommendation.

When self-report and results conflict, YOVA may mention the conflict after two comparable sessions. A default method change should normally wait for approximately four comparable sessions or later retrieval evidence.

The final tie-breaker between genuinely equivalent candidates is the learner's preference.

### Stage 4: apply feasibility and duration

Code selects duration, phase budgets, initial support, activity count, optional timed break, and any deferred targets. Explicitly available time is a hard maximum.

### Stage 5: validate the route

A valid route must pass deterministic checks for:

- recognized identifiers and schema version;
- a valid lifecycle transition and immutable predecessor;
- method eligibility;
- mode-method compatibility;
- execution-environment compatibility;
- required phases and ordering;
- phase durations summing to active minutes;
- elapsed time respecting the hard maximum;
- per-target stage, evidence provenance, review contract, coverage, or explicit deferral;
- difficulty and support bounds;
- source-grounding requirements;
- completion evidence;
- a truthful rationale trace.

If validation fails, YOVA uses a deterministic default for the same task, mode, target-state snapshot, and duration. It does not ask the model to repair the route.

### Stage 6: persist before generation

The validated route is saved before subject-specific content generation. Plan, Home, Agenda, setup, and the session then read the same route.

### Stage 7: fill semantic slots

The model receives:

- exact targets;
- bounded source excerpts;
- the method recipe;
- ordered phase slots;
- required interaction types;
- support and difficulty bounds;
- output schemas.

It returns the content for those slots. Code parses structure and required fields. Semantic quality checks should usually inform logging and review rather than create repeated model-grader failure loops. A bounded retry is allowed when the response is unusable and a retry is likely to help.

### Stage 8: update from outcomes

Immediate updates may change:

- the relevant target's knowledge evidence and uncertainty;
- difficulty;
- hints and support;
- error repair;
- the relevant target's next review time;
- the next session's Learn or Practice recommendation.

Method-level learner conclusions require repeated comparable work. YOVA does not deliberately randomize or test alternate methods in v1. It learns passively from routes the learner naturally completes.

## 9. Stability and change policy

- Prefer a stable primary method for a topic long enough to gather interpretable evidence.
- Do not switch methods merely to make personalization visible.
- A small in-session repair can happen without changing the named method.
- A major method or mode change happens between sessions and is explained.
- YOVA Decides may apply a sufficiently supported between-session change automatically.
- Help Me Choose requests confirmation.
- I'll Customize preserves the learner's selection and offers the new recommendation separately.
- v1 does not deliberately explore alternate methods.
- v1 does not expose evidence expiration or reset controls.
- Evidence records must still keep timestamps and version information so later decay or correction can be introduced safely.

Because v1 does not run controlled comparisons, learner-facing claims must remain observational:

- Allowed: "Your recent results with Active Recall have been stronger on similar recall work."
- Allowed: "This recommendation uses your preference and your last four comparable sessions."
- Not allowed: "Active Recall is proven to be your best method."

## 10. Duration engine

### 10.1 Duration choices

Normal sessions use these visible duration levels:

- 10 minutes;
- 15 minutes;
- 25 minutes;
- 45 minutes;
- 60 minutes.

Scheduled retrieval reviews use approximately 2–5 minutes and remain lightweight, usually multiple choice or another low-cost deterministic interaction.

### 10.2 Duration inputs

The recommendation may use:

- Learn versus Practice;
- task size and complexity;
- number and stage of knowledge targets;
- required method minimums;
- declared sustainable session length;
- starting friction and cognitive stamina signals;
- current clock time and the learner's declared preferred work periods;
- schedule and deadline;
- explicit available minutes;
- recent completion, early-exit, and active-time history.

Time of day may materially influence the initial recommendation using the learner's declared schedule/profile, not only after repeated observations. YOVA must describe this as a planning fit, not a biological or fixed chronotype claim.

### 10.3 Duration rules

- An explicit availability value is a hard maximum.
- A manual duration choice applies only to the current session and does not silently rewrite the durable profile.
- No "use this more often" prompt appears in v1.
- If the chosen time cannot hold the full target, code creates a coherent smaller session and records the deferred targets.
- Deferred work is shown and suggested in Agenda; it is not scheduled invisibly.
- Repeated meaningful early exits may lower the next recommendation by one duration level.
- Repeated completed sessions with maintained performance may cautiously raise it by one level.
- The learner can always override the recommendation.
- A five-minute first action may be used within a longer session when starting friction is relevant.

### 10.4 Break behavior

An optional timed break may be inserted at an eligible phase boundary in longer sessions. If the learner has a hard elapsed-time limit, the break is reserved before phase allocation. Otherwise the expanded recipe distinguishes active learning time from total elapsed time.

Changing this setting must not cause a second content-generation call. Code redistributes time, removes an optional activity, or defers a lower-priority target using deterministic rules.

## 11. Launch method catalog

The learner sees recognizable names organized by goal. Internally, these names map to a smaller library of reusable phases and runtimes.

### Learn something new

| Learner-facing method | Internal basis | Initial implementation status |
| --- | --- | --- |
| Worked Examples | complete model, guided completion, fading, independent transfer | Extend existing `worked_example_fading` |
| Feynman Technique | plain-language self-explanation, source comparison, repair, explain again | Alias/recipe over existing `self_explanation` |
| SQ3R | survey, question, bounded reading, closed-source recall, review | Expand existing `read_recall_review` |
| Pretesting | brief prediction or attempt, instruction, feedback, later check | New bounded recipe using existing phases |
| Concept Mapping | retrieve concepts, connect relationships, verify, repair | New recipe and interaction; do not treat as a learning style |

### Remember and review

| Learner-facing method | Internal basis | Initial implementation status |
| --- | --- | --- |
| Active Recall | unsupported retrieval, feedback, corrective retrieval | Rename/present existing `retrieval_practice` |
| Blurting | broad free recall, source check, gap identification, corrective retrieval | Variant of the retrieval runtime |
| Spaced Repetition | scheduled retrieval with misses returned sooner | Present existing `spaced_retrieval` |
| Practice Tests | representative unsupported set, confidence, error classification, repair | Present existing `practice_test_error_repair` |

### Apply and master

| Learner-facing method | Internal basis | Initial implementation status |
| --- | --- | --- |
| Practice Problems | independent application, feedback, changed-context transfer | New formal recipe using existing practice phases |
| Interleaving | mixed related types, method selection, discrimination, error review | Present existing `interleaved_practice` |
| Outline from Memory | retrieve claim and structure, verify evidence, draft | Rename/present existing `retrieval_based_outlining` |
| Trace–Code–Test | trace a model, predict, complete missing code, build or debug independently | Rename/present existing `scaffolded_coding` |

Supporting techniques are not separate primary methods in v1. Examples include:

- self-explanation prompts inside another method;
- corrective feedback;
- error logs;
- confidence prediction;
- dual representation when the content itself benefits from a diagram;
- a worked example used briefly for repair;
- an end-of-session independent check.

Flashcards are an interface for retrieval and spacing, not a distinct pedagogical method. Pomodoro is timing, not a learning method. Feynman and Blurting are recognizable implementations of underlying self-explanation and free-recall mechanics, not unique scientific mechanisms.

## 12. Learner profile and onboarding

YOVA should have one canonical global onboarding/profile questionnaire, not three overlapping systems.

### 12.1 Questionnaire contract

Each question must document:

1. the signal it captures;
2. the decision it may change;
3. the maximum authority of the answer;
4. the explanation YOVA may show;
5. the evidence that can confirm or contradict it;
6. how the signal can be corrected in future iterations.

Questions should use a mix of direct choices and concrete scenarios, allow **Depends** or **Not sure**, avoid branching in v1, and end with a short **How YOVA will work with you** summary.

No question may infer a diagnosis, personality type, intelligence level, fixed learning style, or neurotype.

### 12.2 Target question areas

The final copy should be research-reviewed, but the canonical questionnaire should cover approximately 8–12 questions across:

1. preferred control mode;
2. starting friction;
3. realistic session length;
4. preferred entry into unfamiliar material;
5. self-reported approach that has produced lasting success;
6. typical post-study breakdown, such as recognition without recall or understanding without application;
7. preferred first repair after a mistake;
8. workspace structure;
9. focus and pacing during demanding sessions;
10. optional functional or accessibility support.

Energy and day-specific state are not permanent-profile identities. Preferred working periods may inform scheduling. Temporary energy, stress, or readiness questions remain optional, quiet, expiring context; the app must work completely without them.

### 12.3 Migration

Existing answers from onboarding, the 12-question Study Profile, and the deeper learner profile should be mapped into the new signal model wherever the meaning is compatible. Missing answers remain unknown. YOVA must not require existing users to complete another long questionnaire before studying.

Detailed profile information belongs primarily in You. Session surfaces show only the short reason needed to understand the current decision.

## 13. Visible personalization

### Home and Agenda

The collapsed card shows only:

- Learn or Practice;
- primary method;
- total duration;
- one short reason;
- the primary Start action.

Example:

> Practice · Active Recall · 25 minutes
> Fits this recall task and your usual evening sessions.

### Expanded recipe or setup

On demand, the learner can see:

- named phases and minutes;
- active versus elapsed minutes when a break exists;
- what the task requires;
- what the learner told YOVA;
- what YOVA observed;
- what YOVA is still unsure about;
- up to two alternatives;
- what changed since the previous route.

### After the session

The concise personalization receipt separates:

- **You said**;
- **YOVA saw**;
- **Next change**;
- **Not sure yet**.

The You screen may maintain a fuller ledger and method history without moving that density onto Home or Agenda.

Rationales must be generated from the actual rule trace, not merely from personalized-sounding prose.

## 14. Short reviews

- Short reviews are 2–5 minutes.
- They are primarily retrieval checks and should usually use multiple choice or another cheap validated interaction.
- They appear on Home and in Agenda/calendar.
- YOVA may schedule them automatically from concept evidence.
- The learner may move or remove them.
- They should use cached items or deterministic templates when possible and should not require a full session-generation call.
- A miss can create a bounded repair or recommend a larger Learn/Practice session; the review itself should remain lightweight.

## 15. Outcome learning

YOVA's primary learning outcomes are:

1. delayed retention;
2. independent application or transfer;
3. independent performance without excessive support;
4. learning achieved per active minute.

Secondary feasibility outcomes include:

- initiation;
- completion;
- early exit or abandonment;
- actual versus planned duration;
- confidence calibration;
- learner difficulty feedback.

Method evidence is comparable only when work is reasonably aligned on:

- task family;
- knowledge stage;
- difficulty;
- duration;
- support level;
- target relationship;
- assessment type.

Success may transfer cautiously across similar task families, not across an entire subject or person. For example, successful definition recall may weakly inform other memorization work but must not determine a calculus problem-solving route.

v1 does not deliberately create randomized method comparisons. Therefore it can learn useful observational tendencies but cannot claim causal individual method effects.

### 15.1 Semantic evaluation uncertainty

When code cannot evaluate an answer directly, a model may return a bounded formative judgment grounded in the activity's source or reference answer and explicit rubric.

The evaluation must support an explicit **uncertain** state. An uncertain judgment—or a failed evaluation that cannot be scored safely—may reveal the reference and give cautious feedback, but it must not:

- mark the target secure or in need of repair;
- change target knowledge state;
- enter method-outcome comparisons;
- support a personal-method claim;
- silently become correct or incorrect for completion statistics.

YOVA should use deterministic evaluation for interactions such as validated multiple choice whenever possible. Model evaluation remains formative and bounded; it does not receive authority over the route.

## 16. Reliability, cost, and failure behavior

### Code owns

- route and schema versions;
- task, target, and phase identifiers;
- method eligibility and ranking math;
- Learn/Practice contract;
- duration and phase budgets;
- required phase order;
- difficulty and support bounds;
- review timing;
- target deferral;
- route persistence;
- structural validation;
- fallback selection;
- UI explanation provenance.

### The model may own

- bounded subject-specific explanations;
- source-grounded examples;
- questions and distractors inside fixed activity types;
- semantic feedback and tutoring language;
- bounded semantic evaluation where code cannot evaluate the subject matter directly.

Model-based semantic judgment must not be allowed to rewrite the route. Avoid using a second model call as a hard style or quality gate when deterministic structure is valid.

### Degraded path

1. Parse and structurally validate the first result.
2. If unusable and a retry is likely to help, retry once with the same fixed route.
3. Choose the usable result or deterministic fallback.
4. Preserve the route and use a simpler source-grounded sequence, such as bounded review, retrieval prompts, comparison, and a follow-up check.
5. Log the degraded path with safe metadata.
6. If no trustworthy source or content exists, do not invent facts; offer a source-independent setup action or ask for readable material.

## 17. Implementation sequence

This must not be implemented as one sweeping prompt or rewrite.

### Milestone 0: freeze the contract and characterize current behavior

- Keep this specification canonical.
- Add characterization tests around current plan, route, session, duration, profile, review, and fallback behavior.
- Record the known current gaps without rewriting production logic.

### Milestone 1: introduce StudyRoute and adapters

- Add the versioned route schema, explicit lifecycle, per-target snapshots, and execution environment.
- Build adapters from current plan sessions and routing briefs.
- Persist the route without changing the learner experience.
- Prove all surfaces can read the same route.

### Milestone 2: deterministic duration engine

- Add 10-minute normal sessions while preserving 15/25/45/60 compatibility.
- Implement hard availability caps, time-of-day/profile inputs, early-exit/completion adjustments, coherent target splitting, and visible deferral.
- Keep scheduled reviews on their existing lightweight path.

### Milestone 3: canonical method routing

- Separate eligibility, scoring, stability, preference tie-breaking, and validation.
- Remove the runtime planned-method pin as the source of truth; the persisted StudyRoute becomes the commitment.
- Reconcile exact-method and method-family outcome signals.
- Keep current nine methods working before adding new visible recipes.

### Milestone 4: plan and session integration

- Create provisional StudyRoutes during plan generation.
- Recheck feasibility near session time without casually changing the method.
- Pass fixed route scaffolds into generation.
- Guarantee that Home, Agenda, setup, active session, and post-session evidence share the same committed route revision.

### Milestone 5: method catalog expansion

- First expose the current engines under the agreed recognizable names.
- Add Blurting as a retrieval variant.
- Add Pretesting, Concept Mapping, and Practice Problems individually, each behind its own tests and rollout flag.
- Reuse phase primitives and runtimes rather than creating thirteen separate systems.

### Milestone 6: profile consolidation

- Define the canonical signal schema and question-to-decision registry.
- Migrate compatible existing answers.
- Replace overlapping questionnaires with the concise onboarding and optional profile view.
- Update product copy so profile can influence method selection within evidence constraints.

### Milestone 7: learner agency and visible recipe

- Connect YOVA Decides, Help Me Choose, and I'll Customize to the same router.
- Add the minimal collapsed card and progressively disclosed recipe.
- Add truthful change explanations and bounded alternatives.
- Preserve the current focused UI rather than adding dashboards to every tab.

### Milestone 8: evidence updates, reliability, and cost

- Unify method evidence thresholds and comparable-session rules.
- Remove active exploration from the v1 path.
- Move all computable generation decisions into code.
- Implement the single-retry and source-grounded degraded path.
- Measure model calls, generation failures, fallback use, and cache reuse.

### Milestone 9: controlled rollout

- Run unit, integration, counterfactual, and browser tests.
- Use route versions and a feature flag for staged migration.
- Compare new behavior with the strong existing task-and-mastery baseline.
- Roll back by route version rather than reversing unrelated product changes.

Each milestone must leave the app usable and tested. A later milestone cannot be required to repair a broken earlier rollout.

## 18. Required acceptance tests

### Counterfactual routing

Hold task, material, deadline, available time, account history, and requested mode fixed. Change exactly one relevant signal and assert the appropriate difference in:

- method when the signal has method authority;
- duration when the signal has timing authority;
- structure or support when the signal has delivery authority;
- rationale and provenance;
- persisted route identity.

### Invariance

When no relevant input changes, YOVA must produce the same deterministic route even if prose generation varies.

### Agency

- YOVA Decides applies supported between-session changes and shows them.
- Help Me Choose requires confirmation.
- I'll Customize preserves the learner's valid selection.
- Questionable methods produce an explanation and safe mapping, not a dead end.

### Duration

- Explicit time is never exceeded.
- Manual duration is one-session-only.
- Too-large targets are coherently deferred and shown in Agenda.
- Repeated early exits and completions move at most one duration level per update.
- A timed break does not trigger content regeneration.

### Cross-surface consistency

Plan, Home, Agenda, setup, active session, saved resources, completion, and later evidence must reference the same committed route revision. A material change creates a provisional successor and, once approved or automatically accepted under the agency contract, a new immutable committed revision that supersedes the old one.

### Mixed-target state

- One session containing differently staged targets preserves a separate stage, uncertainty, evidence trace, and review decision for each target.
- Compatible target needs may share one dominant Learn or Practice route with target-specific support.
- Incompatible target needs are split or deferred rather than collapsed into one session-level stage.

### Execution environment

- Learn and Practice work both inside and outside YOVA.
- An outside-YOVA completion remains execution evidence unless YOVA obtains a valid independent knowledge check.
- Changing execution environment creates a new route revision and cannot silently reuse incompatible generated content.

### Failure behavior

- Invalid generated structure cannot change the route.
- One failed model result can retry once.
- A second failure produces a usable source-grounded fallback when possible.
- Missing trustworthy source content never produces fabricated grounded claims.

### Learning loop

- A miss changes support and review timing immediately.
- A single session cannot produce a strong personal-method claim.
- Only comparable sessions contribute strong method evidence.
- The learner-facing reason names only signals actually used.
- An uncertain or failed semantic evaluation provides no mastery or method-outcome evidence.

## 19. Evaluation and claims

Engineering correctness is necessary but does not prove learning efficacy.

The new system should eventually be evaluated against a strong task-and-mastery baseline using:

- delayed retention;
- changed-context transfer;
- independent performance;
- learning per active minute;
- initiation, completion, and abandonment as guardrails;
- confidence calibration;
- route acceptance and override behavior.

The evaluation must distinguish:

- improvements caused by the task/method baseline;
- improvements caused by self-reported profile adaptation;
- improvements caused by observed-outcome adaptation;
- improvements caused only by more persuasive personalization copy.

Until such evaluation exists, YOVA may claim that it builds evidence-constrained personalized routes and adapts them from learner inputs and observed results. It may not claim that the overall system or an individual recommendation is proven to improve grades, retention, or learning for every student.

## 20. Deliberately deferred from v1

- randomized or bandit-driven method experimentation;
- causal individual-method-effect claims;
- learner-facing signal expiration and reset controls;
- Flowtime and a large productivity-method catalog;
- mandatory daily mood, stress, or energy check-ins;
- personality, diagnosis, neurotype, learning-style, or chronotype inference;
- a separate exam mode;
- multiple subject-specific permanent profiles;
- automatic invisible scheduling of deferred work;
- a full visualization dashboard on every product surface.

These omissions are scope control, not missing foundations. The data model should retain versioning, timestamps, and provenance so later evidence-based additions do not require another rebuild.

## 21. Definition of done for the first release

The first personalization release is complete when a learner can:

1. create or open an existing plan without losing current YOVA functionality;
2. see a concise recommended Learn or Practice route with a recognizable method and duration;
3. understand why the route was chosen without opening a technical dashboard;
4. accept it, choose between bounded alternatives, or customize it;
5. complete a structurally reliable source-grounded session;
6. receive immediate support and review changes from demonstrated gaps;
7. return later to a consistent route visible across Home and Agenda;
8. see YOVA distinguish declarations from observations and uncertainty;
9. receive meaningfully different routes when relevant profile or outcome evidence differs;
10. avoid arbitrary differences when the relevant evidence is the same.

From an engineering perspective, the release is complete only when these behaviors are covered by deterministic tests, cross-surface integration tests, browser journeys, failure-path tests, route-version migration tests, and cost instrumentation.
