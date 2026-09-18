# Brief 2 + dependable sessions: implementation handoff

Status: implementation candidate in progress, PR #97, branch `codex/plan-and-session-launch`, isolated checkout `/private/tmp/yova-plan-and-session-launch`. Original base75ea40a; current main0ce2292 merged after prerequisite PR #98. The original founder checkout is dirty and untouched. Do not merge/deploy; the founder does that.

Read the approved `docs/redesign/BRIEF-session-quality.md`, ownership document under `docs/briefs/2026-09-17-session-quality/`, and the three unchanged ZIP inputs in `supplied-brief-2/`. Priorities: public paid-launch reliability, worthwhile sessions, essential research-to-profile-to-effective-route personalization. Keep MCQs, bounded guided visual maps and optional next-ready continuation.

Undo is no longer deferred. Separate #98 canonicalizes omitted/empty editedFields while retaining genuine edit conflicts. It is merged, deployed and production verified on a fresh Moon Phases test plan: change, confirm, receipt, Undo, reload, original six sessions restored. See PRODUCTION-UNDO.md. Water Cycle Quiz Foundations was untouched.

Implemented candidate behavior:

- Code-owned topic queue, content-derived workload, accepted source-role/topic slices, signed map corrections, optional placement, profile-driven methods/question mix/spacing, and explicit-time Study Now. New fixes preserve valid partial-placement evidence and prevent method edits from changing untargeted deadline-spill sessions.
- Shared workload reaches the actual session. The resumed fill work packs at most two independently ready, compatible topic activities into a shared<=60min block, each<=32questions. Queue chunks are consumed once. Per-segment scope, route, source and result remain separate. No whole-block completion after activity1; exit/reload preserves both finished and unfinished work. Revision must preserve both slices or reconstruct valid single-topic work.
- Durable terminal outbox, exact lost-reply reconciliation, stable attempt identity, actual cloud reload. Segment receipts must survive outbox/transport/database/reload, sum to terminal totals, match both persisted IDs and retain authorized topic origins. These are execution reports under the existing MCQ grading model, not proof of learner mastery.
- Deterministic visual map, preserved final keystroke/drafts, original-versus-revised feedback and one bounded recheck; truthful effective-route claims, available retry tips and produce tips.
- <=8-question generation batches share one teaching context and one50s provider deadline. Stable option permutation preserves grading. Actual CI410 s12 had no fully correct choice; the full sample is retained. Independent review hides the proposed key, checks options/conditions/explanation/reasoning/distractors/repetition, and allows one repair phase with recheck. It is fallible and adds latency; live timing/success evidence is mandatory. Five-point pair selection no longer cycles through only half the available pairs.

Database release dependencies: `20260917160001_topic_plan_workloads.sql`, `20260917170001_plan_session_authenticated_reads.sql`, `20260917180001_topic_segment_completions.sql`. Service-only readiness RPC v6 must return contract `20260917180001`, owner-scoped reads, workload persistence and atomic segment completions. The new migration extends the existing locked writer and exact replay checks; no direct table write surface is opened.

Evidence:

- EVIDENCE.md and owner reports record red/green tests. Integrated checkpoint:4,534passed/105gated or skipped; full lint and25runner checks passed. Later scoped routing checks and typecheck pass; these are overlapping checkpoints, not additive totals.
- CI410 passed migrated adjustment/completion, units, lint/types and build, but failed multiple browser/setup cases. Those failures are not waived. Current-main comparison should use CI413 on0ce2292 once complete. The historical comparator remains00995f1 and has a narrower scope; do not label it current main or use it to waive new acceptance cases.
- New migrated cases cover per-segment hydration, malformed/partial receipt rejection, exact both-topic completion, retry/reload and changed-replay refusal. They must run in CI; no local database run is claimed.
- New live cases verify the retained bad MCQ versus a sound replacement;6/24/32-question samples retain full content and elapsedMs. Review those outputs substantively, not only their schema/count/type labels. See GENERATED-QUALITY-REVIEW.md.
- RECORDINGS.md distinguishes controlled recovery fixtures, live preview journeys and unrecorded production Undo. Eleven CI410videos decode; P1failed at a selector and P2/profiledelta did not execute. Fresh successful contrasting-profile and two-activity replays are still required.

Compatibility: older plans remain usable. Automatic review previously rejected blocking them without a migration; no old data was deleted. The earlier production completion timeout's exact cause remains unproven. Do not equate automated elapsed time, MCQ counts or a green unit suite with educational efficacy. The mobile briefing's long instruction/reason panel remains a usability concern.
