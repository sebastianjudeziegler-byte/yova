# Personalization Milestone 0: Frozen Baseline

Status: deterministic baseline complete; paid live-provider snapshot deferred
Captured: August 23, 2026
Canonical contract: [`PERSONALIZATION-SYSTEM-SPEC.md`](./PERSONALIZATION-SYSTEM-SPEC.md)

## 1. Purpose

Milestone 0 freezes what YOVA does now before the personalization architecture changes. It does not change learner-facing behavior and it does not treat the current implementation as the desired final design.

The baseline has four jobs:

1. keep the agreed product definition canonical;
2. preserve important current behavior during migration;
3. name current limitations so they are not accidentally preserved as product requirements;
4. define the tests that will prove the new system rather than relying on personalized-sounding copy.

The executable characterization suite is [`src/evals/personalization-milestone-zero.test.ts`](../src/evals/personalization-milestone-zero.test.ts). It intentionally tests current production functions without adding a `StudyRoute` or changing routing behavior.

## 2. Captured environment

| Item | Baseline |
|---|---|
| Git commit | `ad770d4` |
| Branch | `codex/structural-streamed-recovery-2026-08-23` |
| Node | `v24.19.0` (`package.json` requires `24.x`) |
| pnpm | `11.19.0` (`package.json` declares `11.16.0`) |
| Local timezone | `Europe/London`, BST `+0100` |
| CI timezone | `America/Los_Angeles` |
| Dependency state | Existing locked install used; `pnpm-lock.yaml` unchanged |
| Worktree caveat | The worktree was already non-clean. The pre-existing `next-env.d.ts` change and `tmp/` directory were not intentionally modified by Milestone 0. |

Timezone is recorded because several schedule tests are date-sensitive. A London-local failure should not be compared silently with CI's Los Angeles result.

## 3. Baseline results

| Gate | Result | Meaning |
|---|---:|---|
| Milestone 0 characterization | 7 passed | The frozen corpus and current routing, delivery, duration, review, and fallback boundaries are executable. |
| Full deterministic Vitest suite | 284 files passed, 13 skipped; 2,065 tests passed, 55 skipped | Includes unit tests, route-handler integration tests, deterministic rubrics, and the new characterization file. Specialist live suites remain opt-in. |
| ESLint | Passed | No lint error. |
| Next.js production build | Passed | TypeScript, compilation, and 43 application routes/pages completed successfully. |
| Preview Playwright suite | 130 passed, 8 skipped | All ordinary journeys passed in desktop Chromium and Pixel 7 projects. The eight skips are the four password-auth tests in both projects. |
| Password-auth Playwright suite | 7 passed, 1 skipped | Auth passed separately in desktop and mobile; the desktop project's phone-layout assertion is intentionally skipped. |

The earlier report of `ReferenceError: uniqueReviewMaterials is not defined` is not a current baseline exception. The identifier is absent from the current source and the full deterministic suite passes. It remains historical context only.

### What these results do not prove

The preview browser config deliberately disables OpenAI, Supabase, and email. It proves deterministic/fallback product behavior and learner-facing flows, not live generation quality or learning efficacy.

The live OpenAI plan, session, journey, and answer evaluations were not run during this baseline because they consume API credits and are nondeterministic. That is an explicit deferral, not an unreported skip. Before a material prompt or generation-policy change, run a cost-bounded live snapshot with explicit approval using at least:

- `biology_initial_teaching`;
- `bioenergetics_multi_target_study`;
- `calculus_targeted_repair`;
- `history_writing_outside`;
- `javascript_scaffold_fading`.

Passing those rubrics would still require human review of factual usefulness, problem quality, tone, and the learner experience.

## 4. Frozen science scenarios

These eight scenarios form the minimum quality matrix. “Current proof” describes exactly what the existing suite establishes. “Next contract” is intentionally not left as a failing test before its underlying architecture exists.

| Scenario | Current proof | Missing next contract |
|---|---|---|
| Beginner Learn | The browser proves a declared beginner receives Teaching first, a model, guided work, independent performance, transfer, and bounded repair in [`core-learning-loop.spec.ts`](../e2e/core-learning-loop.spec.ts#L379). Plan-preview tests route new material to teaching-first work. | Prove the same journey through successful generated content while preserving target identity, phase order, support fading, independent evidence, and any deferred targets. The current browser test deliberately exercises fallback content. |
| Reviewer Practice | The browser proves Practice first, visible retrieval rationale, a high-confidence miss, immediate repair, recheck, and no duplicate repair in [`core-learning-loop.spec.ts`](../e2e/core-learning-loop.spec.ts#L148). | Add a clean successful-review path: retrieval remains first, unnecessary teaching does not appear, independent evidence is recorded, and the correct delayed return is scheduled. |
| Mixed target states | Placement tests can separate demonstrated targets from gaps into different sessions; practice directives can prioritize a gap while lightly checking a stronger target; multi-target generation preserves topic attribution. | One session with novice, practiced, and retained targets must preserve separate stage, uncertainty, evidence, and review decisions. Compatible needs may share a dominant route; incompatible needs must split or defer. |
| Confident wrong answer | This is the strongest current scenario. The browser and unit tests prove confidence capture, direct repair, a fresh check, and bounded follow-up behavior. | Bind the miss and its adaptation to one committed route revision. Support and review timing may change without silently rewriting the method, targets, or historical route. The explanation must cite the actual high-confidence miss. |
| Problem solving | Unit tests select a quantitative workpad; generator recovery tests protect a worked-example method and reject malformed worked-example sequences. | Add a full problem-solving journey: complete model → guided analogous problem → fresh independent problem → feedback or repair. Solving work—not a recognition-only question or generic explanation—must provide the evidence. |
| Outside YOVA | The browser proves an external assignment routes outside YOVA, keeps a visible method, advances execution without fabricating topic evidence, and creates verification work in [`core-learning-loop.spec.ts`](../e2e/core-learning-loop.spec.ts#L649). | Prove the return path: only a valid independent check may update knowledge. Switching execution environment must create a successor route and cannot reuse incompatible generated content. |
| Uncertain semantic evaluation | The response schema and UI support `uncertain`, and live answer cases include uncertain judgments. Deterministic tests mainly cover output-language safety. | `uncertain`, timeout, malformed output, and evaluator failure must create no mastery evidence, method-outcome evidence, or inferred misconception. The UI must state that YOVA could not judge the answer and offer a safe recheck. |
| Generation or source failure | Browser and generator tests cover usage exhaustion, transient failure, unsafe teaching fallback, learner requirements, recovery, and fail-closed paths. | Invalid content cannot change the route; retry at most once; a second failure must preserve the route and use a source-grounded fallback when possible. Missing or unreadable source content must never produce fabricated grounded claims. |

## 5. Current behavior being characterized, not endorsed

### Plan and routing

- Plan sessions currently store free-text method, reason, duration, learning mode, and targets rather than one immutable route decision.
- When no method is committed, profile and repeated method evidence can change the named method among eligible choices.
- When a valid method is already written into the plan, runtime routing pins it even when learner-fit ranking would select another method. The new characterization suite freezes this limitation so a later milestone must change it deliberately.

### Session delivery and profile

- Holding the learning job and 25-minute duration fixed, two profiles can receive materially different presentation, repair, retention, and workspace policies.
- These decisions are real code-level changes, but current end-to-end tests do not compare two otherwise identical learners side by side.
- The initial profile, deep profile, and Study Profile remain overlapping sources rather than one canonical signal contract.

### Duration

- The initial recommendation parses declared schedule text into the fixed levels 15, 25, 45, or 60 minutes.
- Manual shortening, 10-minute fallback/split work, and quick 5- or 10-minute reviews already exist in separate flows.
- There is no canonical deterministic function that jointly uses task, target load, profile, recent behavior, time of day, and explicit available time to choose a normal session duration.

### Review and evidence

- Review directives are already separate per observed concept/topic and use different repair, verification, and maintenance timings.
- Knowledge stage used by method routing is still coarse at the session level.
- Semantic `uncertain` is visible but does not yet have one explicit evidence-eligibility object carried through every mastery and method-learning path.

### Fallback

- A 10-minute outside-YOVA workflow is bounded and contains no invented teaching block.
- Built-in recovery is intentionally conservative: active YOVA-generated sessions may use validated outage fallback; material-backed sessions do not silently substitute generic content.
- The target contract will preserve that restraint while adding a source-grounded degraded path where verified source anchors actually exist.

## 6. Required future-test inventory

The following tests are specified now but should become executable only with the corresponding architecture. The main suite must not be kept intentionally red.

1. **Semantic-evaluation authority:** uncertain or failed evaluation produces feedback only and no durable learning or method evidence.
2. **Per-target state:** mixed-stage targets keep separate snapshots, evidence, uncertainty, and review decisions; incompatible targets split or defer.
3. **Normal generated Learn:** a successful generated beginner session preserves the committed recipe and produces independent evidence.
4. **Real problem solving:** worked model, faded analogous work, and a fresh independent problem execute in order and remain within time.
5. **Route-preserving failure:** invalid generation, one retry, fallback, cache, and recovery all retain the same committed route revision.
6. **Clean Practice:** a correct reviewer path avoids unnecessary reteaching and schedules the right later check.
7. **Counterfactual routing:** hold task, material, deadline, time, and history fixed; vary exactly one authorized signal; assert only its permitted method, duration, support, or rationale effect.
8. **Invariance:** identical decision inputs always produce the same route regardless of generated prose.
9. **Cross-surface identity:** Plan, Home, Agenda, setup, active session, saved resource, completion, and evidence use the same committed revision.
10. **Agency:** YOVA Decides, Help Me Choose, and I'll Customize all pass through the same router and persist truthful provenance.

## 7. Failure classification for later milestones

- **Deterministic product failure:** reproducible Vitest, lint, build, or preview-E2E failure. It blocks the next milestone until fixed or explicitly owned as a pre-existing defect.
- **Environment failure:** wrong runtime, missing browser, unavailable port, or timezone-only mismatch. Correct the environment and rerun before blaming product logic.
- **Expected skip:** only a documented opt-in live suite, separate auth mode, or project-specific layout condition.
- **Live provider failure:** timeout, quota, or provider request failure. Record separately from generated-session quality.
- **Live quality failure:** a completed generated result violates a required rubric. Rerun the exact case once; a repeated semantic failure becomes a product risk.
- **Human-quality concern:** an output can pass structure checks and still be factually weak, confusing, or unhelpful. Automation does not close this category.

## 8. Milestone 0 disposition

Milestone 0 is complete for deterministic migration work:

- the product contract is canonical;
- current behavior has a passing characterization suite;
- test, lint, build, desktop, mobile, and isolated auth baselines are clean;
- skips and the live-provider deferral are explicit;
- the eight quality scenarios and future acceptance tests are frozen;
- current limitations are recorded rather than hidden;
- the separate [`STUDY-ROUTE-IMPACT-MAP.md`](./STUDY-ROUTE-IMPACT-MAP.md) identifies the safest Milestone 1 seams.

No learner-facing routing or generation behavior changed in this milestone.
