# Session-writing paths after Brief B

This inventory separates plan revision from the runtime/lifecycle writes that Brief B explicitly leaves in place. There is one **topic/calendar-delta rebuilding pipeline**. There are still multiple session-table writers; claiming otherwise would hide the required method-choice and runtime authorities.

| Entry point | Authority / write path | Scope |
| --- | --- | --- |
| Active plan Adjust, learned-elsewhere, source attachment; draft content/schedule/starting-level controls; legacy Calendar/tutor adjustment entry points | `/api/plans/adjust`: strict MapDelta → `buildPlanRevision` → `composeNormalPlanEnvelopes` → fixed-slot Brief A fill → materialize affected future sessions | Single revision builder; the provider cannot select structure or submit sessions |
| Confirm / Undo on an active plan | `persistAcceptedPlanRevision` → service-only `apply_plan_revision` | One atomic revision writer, owner/revision/map/preimage checks, durable receipt; Undo applies an inverse patch |
| Confirm / Undo on a draft | Same signed builder/projection; fresh bounded activation receipt | Changes the draft only; no active session row is written |
| Initial activation | `/api/plans/activate` → permit-protected `save_generated_plan_with_routes` | Creates the plan and initial committed routes; preserves reviewed draft revision |
| Explicit per-session method choice | `/api/plans/method-choice` (draft), `/api/sessions/method-choice` (active) | Existing guarded learner choice retained as explicitly required by the brief |
| Session generation | `/api/sessions/generate` → generated-resource cache authority | Runtime resource caching, unchanged |
| Checkpoint, interruption, completion and scheduled review | `save_active_session_checkpoint_with_route`, `delete_active_session_checkpoint`, `record_session_interruption_with_route`, `complete_plan_session_with_route`, `activate_concept_review_with_route` | Runtime/lifecycle and measured evidence, unchanged |
| Calendar positioning / start-now | `/api/sessions/schedule` → `reschedule_plan_sessions` / compatibility wrapper | Existing scalar scheduling authority; Calendar UI outside Brief B |
| Legacy duration endpoint | `/api/sessions/duration` → `adjust_plan_session_duration` | Existing legacy-only scalar boundary; routed sessions reject this path; no live UI caller found |
| Archive/delete | `/api/plans/status` | Existing plan lifecycle, unchanged |

Retired HTTP writers: the former wholesale `/api/plans/adjust` payload and `/api/materials/attach` return preview-required errors. Free-text direction remains rejected, including the Sept 7 photosynthesis case. `plan-redirector.ts` has no live import. Historical adjustment helpers/migrations remain for retained evidence; direct old-RPC containment is separately verified in the database tests.

All tests and captures for this inventory run in GitHub Actions. No production settings or runtime validator changes are part of this branch.
