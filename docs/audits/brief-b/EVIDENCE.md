# Brief B — living plans

Base: merged main `c7b3ca99964524cefc04437b7236b37fe8fe2666`. Branch: `codex/brief-b-living-plan`.

## Before implementation

Verification evidence for this brief is collected in GitHub Actions. No local browser suite or live gate is authorized. The initial commit adds tests against the existing PATCH adjustment route: structured previews currently return 422, so tests assert missing learner-visible behavior without importing a nonexistent implementation. Evidence/mode tests exercise existing readers with an unchecked learner report. The frozen-clock founder journey uses actual creation/activation/revision flows and saves video/screens on desktop and mobile. Inspect the baseline to distinguish absent features from an earlier fixture/setup failure.

Current code already keeps `plan-redirector.ts` out of the live adjustment route. Remaining duplication: API and development-preview UI independently reconstruct every unfinished session; one saved-work session blocks all adjustment. Draft regeneration and material attachment are separate paths. Plan edits will converge on scoped topic/calendar-delta composition and guarded revision persistence. Completed/saved-work sessions must remain unchanged; ordinary runtime/lifecycle persistence stays outside this brief.

Authority boundaries: strict delta operations and server-owned topic IDs; signed draft/proposal authority; current plan/route revision checks; server-owned active-plan, material, calendar and saved-work context; atomic apply/Undo. Learner report is stored only as `{ source: "learner_report", outcome: "covered_elsewhere", checked: false }`, retaining independently scored placement evidence. It cannot create gap or mastery evidence.

The required preview confirmation is the only apply confirmation; no verification quiz for learned-elsewhere. No product source changed in the baseline commit. Red results are pending remote execution, not claimed yet.

Known exceptions retained: intermittent osmosis, cross-tab Calendar timeout, A16/A19/A24/A30/A31/A33 legacy sources, A05 and A17. Compare main before labeling a regression. Do not extend session validators: capture a blocking false rejection and use existing recovery. Brief B's desktop/mobile AP Bio journey is required. No merge, deploy or production settings change is authorized.

## Red run — 2026-09-09

[GitHub Actions 34393557359](https://github.com/sebastianjudeziegler-byte/yova/actions/runs/34393557359), source `5ed4b920045cc2822ba1f9b5046a753cf604cc30` (tests only above main): unit baseline **15 failed / 5 passed**. Twelve positive structured-preview assertions fail on the absent route contract (422 instead of 200); the existing five injection rejections pass. All three evidence-reader regressions fail: a learner report becomes an incorrect diagnostic, reported coverage cannot select Practice, and retained placement evidence is not recognized as requiring receipt authority. No green behavior is claimed yet. Browser baseline is still running; early setup failures will be distinguished from absent-feature failures in the final artifact review.

Shared implementation boundary, recorded before product edits: introduce a strict map/calendar delta and signed proposal; compose only the affected future sessions using the existing fixed-slot pipeline. Keep measured placement in a separate record when a learner reports coverage. The report controls the starting activity only, never diagnostic correctness, gap evidence or mastery. Apply/Undo must use current revision and affected-row preimages, retaining unrelated progress.

Browser baseline artifact [10120991317](https://github.com/sebastianjudeziegler-byte/yova/actions/runs/34393557359/artifacts/10120991317): all six entries stopped during setup at the obsolete “25 minutes” selector. These are test-fixture failures, **not** red evidence for revision. The fixture now follows the existing new-plan journey; the next CI run explicitly checks out unchanged main `c7b3ca9` before running it.

## First green slice

[Run 34394906552](https://github.com/sebastianjudeziegler-byte/yova/actions/runs/34394906552), branch `2a4b2f0`: **20/20** route/evidence assertions pass, including all 15 previously failing cases; lint passes. Typecheck reports five integration errors (readonly evidence input, horizon imports, duration literal type, optional method context); those are being corrected before broader gates. This is not a complete Brief B result: active persistence/apply/Undo/UI are still pending.

Corrected browser fixture ran on unchanged main `c7b3ca9` in the same job. Desktop/mobile action cases now reach the active plan and fail on the missing “I already learned this” button; the save case also reaches that absent action. The founder case stops during completion because the baseline intentionally has no provider key and this ATP fixture has no matching built-in lesson. Its missing activity heading is a consequence of that explicit unavailable state, not an obsolete selector. Use an existing supported respiration lesson fixture for this setup; do not change the runtime or validators. [Raw artifact 10121285734](https://github.com/sebastianjudeziegler-byte/yova/actions/runs/34394906552/artifacts/10121285734).

## Apply / active-context red

[Run 34395687055](https://github.com/sebastianjudeziegler-byte/yova/actions/runs/34395687055), source `9d4b9b5`: **7 failed / 22 passed**, typecheck and lint pass. The three apply/receipt cases fail on the unsupported apply action; four active-context/protection cases fail on the explicitly unavailable saved-plan boundary. Fixed-event and draft-capacity limits already pass. This run precedes adding the active loader and apply persistence.

[Run 34396236198](https://github.com/sebastianjudeziegler-byte/yova/actions/runs/34396236198), source `21320bf`: **27 passed / 2 failed**, lint and typecheck pass. The three apply/receipt cases and two active-context cases move to pass. Two new active-test fixtures were incorrect: the unchanged-topic helper received a session ID, and an indexed “unrelated” resource was actually the ETC session under revision. Correct the fixtures to select topic IDs and unrelated sessions explicitly; retain exact assertions for the later ETC session and all unrelated work. The observed protection of opened ETC work is correct behavior, not a product defect. Atomic database persistence remains unimplemented; its new pgTAP contract is run against the old schema before migration work.
