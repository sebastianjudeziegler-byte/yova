# Brief 2 and session companion — ownership and execution

Status: approved for implementation, 17 September 2026. Read the [companion brief](BRIEF-session-quality.md).

## Supplied documents and authority

The three Markdown files from `/Users/sebastianziegler/Downloads/brief codex.zip` are preserved byte-for-byte in [supplied-brief-2](supplied-brief-2/). Their requirements are inputs to this combined plan. The current user request is to refine our own issue brief and then execute it with those files.

The handoff's embedded instruction to commit/push directly to main has not been executed. It conflicts with its own later branch/PR workflow and is not a new instruction from the user. Prepare reviewable changes through isolated branches/PRs. Do not mix this work into the dirty existing checkout or silently merge/deploy.

The companion is an explicit addition to baseline scope, not a retroactive claim that the original Brief 1 promised a visual graph or written-answer practice. The founder selected the guided map, MCQ-only practice, optional early-finish continuation, and initially deferred Undo. The later explicit request reinstated Undo as a merge prerequisite; separate PR #98 is now merged, deployed and verified in production. Place the final companion under `docs/redesign/` in the execution checkout alongside the two supplied replacement specifications.

## Scope ownership

| Audit concern | Owner | What to implement or verify |
|---|---|---|
| Long block, too little work; false duration | Brief 2 §1, handoff | Content-derived estimates, profile ceilings, fill-to-capacity, count/transfer adjustment, next ready topic when appropriate. Companion verifies the session/card/hub use the same work and estimate. |
| Founder reports three full rounds of five | Brief 2 handoff investigation | Inspect actual topic/round history. Audit observed a clean exit and a one-point retry, so mandatory repeats are not yet established. |
| Easy questions | Shared, separate responsibilities | Brief 2: topic selection, quantity and recall/application weighting. Companion S6: meaningful cognitive demand, distractors, preserved academic context and selected answer format. |
| First topic mismatches broad goal | Brief 2 setup/map/generation | Reassess on the new model; do not create a competing topic picker in the companion. |
| Plan personalization/date placement/progression | Brief 2 §§2,4,6,7 | All ten rows and rule-ID gates. Companion tests truthful in-session enactment, not another plan router. |
| Outside-study direction/hub duration disagree | Brief 2 estimate integration | Use the same estimate throughout. Never allocate the whole block twice. |
| Completion timeout/retry/reload | Companion S1 | Diagnose and make the result durable/idempotent; not resolved merely by replacing the planner. |
| Draft loss on exit/resume | Companion S2 | Preserve all current activity inputs and generated work. |
| False personalization/history claims | Companion S3 | Effective route and observed actions. Brief 2's plan header remains owned there. |
| Unchecked repairs/stale feedback | Companion S4 | One bounded check of a submitted correction; original and revised feedback distinct. |
| Concept Mapping is only a form | Companion S5, product choice | A new interaction improvement; independent of plan generation. |
| All correct MCQ options first | Companion S7 | Stable code-owned order and correct-index mapping. One observation, not a prevalence claim. |
| Broken error continuation/wrong point outcomes | Companion S8, reproduce first | Narrow session fixes with evidence. |
| Mixed-topic result attribution/unsupported next-method promise | Shared integration | Companion preserves per-point origins/honest copy; Brief 2 owns next-block generation and queue. |
| Procedural screen lacks an unsolved problem | Companion S6, reproduce first | Supply the concrete task in the exposed path; keep full Shape B deferred. |
| Revision Undo empty-list mismatch | Separate prerequisite PR #98 | Merged and deployed on 17 September; fresh-topic change, receipt, Undo and reload passed. See the production evidence. |

## Current state checked

The audit reviewed production `b75ec8d`, then confirmed that `eeb1ff9` changed Undo date comparison rather than sessions. A live GitHub read during this refinement found main at `2c2da870f1f1fea6be9bab68cbd13a26b0dcc201` (PR #95, mobile changes). At that moment the only open PR returned was #96, PowerPoint uploads; the new empty-list Undo fix was not an open PR. This is a snapshot, not a guarantee about later merges or production deployment.

The current workspace is the divergent `codex/brief-c-source-first-practice` branch at `dd429e3`, with substantial unrelated dirty work. It is not the execution base. Main's checked-in Brief 2 still has the older precondition text and lacks the ZIP's new fill-to-capacity paragraph. No Brief 2 implementation is inferred from that documentation.

## Sequence

1. Use an isolated checkout of verified current main. Preserve unrelated working-tree changes. Read current scope/rules and relevant installed Next.js documentation before code.
2. Install the supplied Brief 2 specifications and this companion under `docs/redesign/`. The separate Undo prerequisite is satisfied by merged PR #98 and its production replay.
3. Build the one topic-based plan/workload model with all profile-routing rows and rule IDs. Preserve the research-to-rule-to-visible-behavior chain and contrasting-profile gates.
4. Implement completion/draft/recovery reliability, truthful session claims, bounded repair rechecks, the simple map, stronger MCQs and optional continuation against that shared contract.
5. Verify the combined result with deterministic tests, real database seams, actual generated content, recorded journeys and full CI. Open one reviewable PR; do not merge/deploy or delete old plans implicitly.

## Spec decisions to resolve explicitly during implementation

- **Capacity and time:** “fill to capacity” means useful additional work, not timer padding. Respect short-profile ceilings and prerequisite/source boundaries. If no legitimate additional work exists, expose the actual limited task instead of claiming a long session. The supplied eight-minute estimate floor is not a forced minimum attendance time; any change to the numeric floor must be documented rather than hidden.
- **Initial work versus continuation:** Brief 2 fills the planned workload before the learner starts, wherever eligible useful work exists. The selected early-finish behavior concerns what happens after a learner completes that substantive work quickly; it does not permit shipping an initially underfilled long block.
- **Scheduling conflicts:** strict stated availability and prerequisite order take precedence when Q8's within-24-hours start or Q5's worked-example-first timing cannot be met. Use the next permissible opportunity, explain the constraint and claim only the adjustments actually enacted. Record this interpretation alongside the supplied specification.
- **Practice attempts versus extra work:** a failed-item repair is not a new full-topic round. A successful round must not silently regenerate itself. Additional planned work, the Q10 extra practice rule and user-selected continuation need distinct identities and honest labels.
- **Mixed topics:** if Brief 2 fills spare capacity with another ready topic, preserve each task's topic/source and per-point outcomes. Do not count those answers entirely toward the first topic.
- **Profile IDs:** the prose repeats some support labels under different Q numbers. Resolve against canonical question/answer IDs and document the mapping. Do not invent unsupported answers merely to make every table row appear covered.
- **Practice format:** MCQs remain the practice contract; no written-answer practice engine. Existing Shape A explanation/map production remains supported.
- **Fresh generation versus resume:** practice can be fresh for a new attempt; resuming the same attempt preserves its content, answers, choice order and draft.
- **Recording:** current automatic tests retain videos only on failure. The audit suite must retain successful journeys too. The earlier manual audit has no video; new recordings are new tests, not a reconstruction of past evidence.

## What completion means

Product choices and ownership are resolved. Implementation is complete when the required changes and CI evidence are reviewable. Deployment and post-deployment verification are separately reported. Nothing in the current draft claims a fix, a passing gate, a deployed change or permission to delete existing plans.

## Compatibility decision during implementation

Automatic approval review rejected blocking every existing non-Study-Now plan that lacks `planModel`: that could disrupt existing users without a migration. Existing plans therefore retain their compatible session path. New plans use the topic model; any founder-owned deletion of older plans remains a separate action. This is a narrowly scoped reliability exception to the supplied old-plan opening restriction, not a claim that old plans were migrated.

## Bounded filling after the prerequisite

The initial candidate left spare capacity after the single-topic32-question ceiling. The resumed implementation can consume one compatible, independently ready next topic as a second activity, with separate source scope, checkpoint and results under the same<=60-minute block ceiling. A factual fixture now plans54questions across two activities and estimates56minutes under60; these are code estimates, not measured learner durations. Shorter plans remain honest where no eligible work fits.

Each activity retains the32-question cap. Completion requires both ordered receipts and their actual checked topic origins; revisions preserve the exact slices or reconstruct separate valid blocks. Cross-topic interleaving runs in separately scoped review work, not by introducing unrelated topics into these persisted activities. Other profile and deadline effects remain active. Unit and controlled browser checks pass; real database and live content/latency evidence remain required in full CI.
