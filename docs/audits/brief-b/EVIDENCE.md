# Brief B — living plans

Base: merged main `c7b3ca99964524cefc04437b7236b37fe8fe2666`. Branch: `codex/brief-b-living-plan`.

## Before implementation

Verification evidence for this brief is collected in GitHub Actions. No local browser suite or live gate is authorized. The initial commit adds tests against the existing PATCH adjustment route: structured previews currently return 422, so tests assert missing learner-visible behavior without importing a nonexistent implementation. Evidence/mode tests exercise existing readers with an unchecked learner report. The frozen-clock founder journey uses actual creation/activation/revision flows and saves video/screens on desktop and mobile. Inspect the baseline to distinguish absent features from an earlier fixture/setup failure.

Current code already keeps `plan-redirector.ts` out of the live adjustment route. Remaining duplication: API and development-preview UI independently reconstruct every unfinished session; one saved-work session blocks all adjustment. Draft regeneration and material attachment are separate paths. Plan edits will converge on scoped topic/calendar-delta composition and guarded revision persistence. Completed/saved-work sessions must remain unchanged; ordinary runtime/lifecycle persistence stays outside this brief.

Authority boundaries: strict delta operations and server-owned topic IDs; signed draft/proposal authority; current plan/route revision checks; server-owned active-plan, material, calendar and saved-work context; atomic apply/Undo. Learner report is stored only as `{ source: "learner_report", outcome: "covered_elsewhere", checked: false }`, retaining independently scored placement evidence. It cannot create gap or mastery evidence.

The required preview confirmation is the only apply confirmation; no verification quiz for learned-elsewhere. No product source changed in the baseline commit. Red results are pending remote execution, not claimed yet.

Known exceptions retained: intermittent osmosis, cross-tab Calendar timeout, A16/A19/A24/A30/A31/A33 legacy sources, A05 and A17. Compare main before labeling a regression. Do not extend session validators: capture a blocking false rejection and use existing recovery. Brief B's desktop/mobile AP Bio journey is required. No merge, deploy or production settings change is authorized.
