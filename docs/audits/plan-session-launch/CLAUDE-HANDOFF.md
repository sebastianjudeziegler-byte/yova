# Implementation handoff: Brief 2 + session reliability

Status: work in progress, no merge or deployment. Base main75ea40a; branch `codex/plan-and-session-launch` in isolated worktree `/private/tmp/yova-plan-and-session-launch`. The founder's original worktree is dirty and was not used for application edits.

Read `docs/redesign/BRIEF-session-quality.md` and `OWNERSHIP-AND-EXECUTION.md`, then the three unchanged supplied files in `docs/briefs/2026-09-17-session-quality/supplied-brief-2/`. Founder decisions: guided reliable map, keep MCQs, optional next-ready continuation, Undo deferred, research-backed profile routing essential.

The plan composer now uses code-owned topic/workload metadata and bounded topic splits, with signed/persisted source-role corrections. New setup has an explicit understanding screen and optional placement. Completion uses the existing durable terminal outbox plus an exact authenticated receipt; it does not replace terminal ordering or route provenance. Shape A retains draft/revision provenance and can lead into the planned MCQs. Concept maps use stable node/link IDs and deterministic rendering. Generation uses <=8-question batches sharing the initial lesson/keypoints and a provider budget below the route timeout. Source-outline content cannot become teaching excerpts. Practice choices have stable remapped order.

Review the owner reports and `EVIDENCE.md` for actual red/green results, scope exceptions and pending gates. The new database migration/versioned readiness check is required. Production source of the old completion deadline remains unproven. A successful mocked fixture is not evidence of real generation quality; inspect retained live outputs and replay videos with their stated environment.

Integrated local result: 4,453 unit tests passed, 99 gated/skipped; 25 runner tests passed; lint and types passed. The one focused map recovery browser case passed, with a decoded/visually inspected replay indexed in RECORDINGS.md. Full browser/provider/migrated-DB evidence remains pending CI. New migration: `20260917160001_topic_plan_workloads.sql`; readiness contract v6.

Explicit deferred gap: ordinary blocks do not combine the next eligible topic into spare capacity. A 60-minute factual allowance can yield 32 questions and an honest 33-minute estimate. Optional continuation preserves the queue and prerequisites, permits an early next learning block only when its date is a suggestion, and preserves future practice spacing. Do not claim complete ZIP fill-to-capacity parity.

Compatibility exception: automatic approval review rejected blocking older normal plans without a migration. They retain their existing session path. No old data was deleted. No change to the deferred Undo fix is claimed.
