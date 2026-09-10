# Required pipeline boundary decision

Status: narrowly approved by the founder on September 10, 2026. Source binding may become topic-scoped within the existing pipeline only. Add a permanent non-inheritance test; retain Brief B's byte-identical protection for every unrelated session; record reproduction on main. No other pipeline changes are authorized; stop and ask if the correction grows.

## Observed failure

The permanent regression in `src/evals/brief-c-source-boundary.test.ts` creates a real fixed-slot plan with a PDF mapped only to ATP, activates its exact routes, and attempts to open the unsourced Enzymes session through the same source-binding check used by `/api/sessions/generate`.

[GitHub Actions run 34472411719](https://github.com/sebastianjudeziegler-byte/yova/actions/runs/34472411719), commit `c3422c41eef747622d6c9aac0ab07b1032a629a2`, is **red: one failed / two passed**. Its product code is byte-identical to main `80323614fec32563a340528fb558a84657a00773`; the commit adds only the regression test, CI workflow, and audit documents.

The failed session is titled **Build Enzymes and activation energy**. The returned reason is **This material-grounded StudyRoute has no selected source section for its active targets.** The HTTP entry point appends a rebuild instruction and refuses to open the session. The sourced ATP session opens its exact PDF section; missing or substituted PDF sources remain rejected.

The five recorded validator suites pass **101/101**, including their Brief 0.5 negatives. Raw per-test results and source SHA are retained in [evidence/initial-source-boundary](evidence/initial-source-boundary/). This is a deterministic pre-implementation failure, not a provider flake or a new Brief C regression.

Classification: **pre-existing Brief B seam on main `8032361`**, corrected within Brief C because it blocks C's required mixed-source default path. The test-only commit runs unchanged main product code, as confirmed by the recorded changed-file inventory; this is not inferred from an unrelated legacy-material canary.

## Cause

`internalRouteShell` in `src/lib/study-route/normal-plan-envelope-integration.ts` calls the legacy route adapter using the whole materialized plan. `legacyPlanSessionToStudyRoute` in `src/lib/study-route/adapters.ts` copies `plan.sourceMode` and every plan material ID into each route's `sourceRequirements`. This happens before the route is committed. An unsourced topic therefore receives a material-grounded route simply because another topic in the same plan has a PDF.

`studyRouteSourceBindingIssue` in `src/lib/study-route/source-contract.ts` correctly refuses an empty selected source section for that committed material requirement. Removing this rejection alone would weaken an existing authority boundary and conceal the incorrect committed requirement.

## Proposed minimal correction

Authorize the existing normal-plan composition/revision pipeline to bind each newly composed or revised route's source requirements to its own selected map topics, using their authorized source references/attachments. An unsourced topic receives a generated-source requirement; a sourced topic identifies its own required source(s). Keep the plan-level material inventory unchanged.

Make runtime source resolution validate against that topic-specific committed binding, retaining ownership, usable-source, exact-topic, unavailable-source, and substituted-source rejection. Version the binding where needed so legacy records cannot silently acquire new authority. Do not add another writer or rewrite committed routes during session opening.

This changes source-binding metadata within the existing pipeline only. It does not authorize changes to session count/order, scheduling, method choice, protection rules, preview/apply/Undo, or unrelated legacy-material cases. Preserve old route compatibility explicitly and test the new binding through the real creation/revision path.

Tradeoff: this crosses the pipeline boundary reserved by Brief C, but corrects the source requirement where it is committed and lets the required mixed-source journey work without weakening the opening check. Leaving the pipeline untouched leaves that journey blocked; bypassing the runtime source check is not proposed.
