# Brief 2.5 - Plan model repair: evidence

Branch `plan-model-repair`, base main 843f7ee.

> **Blocker on the finding map.** The acceptance audit
> `docs/audits/2026-09-18-brief-2-production-audit.md` is not in the repository,
> on main, or in Downloads. The per-finding table (all 114, each fixed / design
> pass / founder action) is written against it once the founder supplies the
> file. The finding numbers below come from the brief.

## Root cause 1 - The word "test" deletes teaching (findings 1-7, 19, 21, 35, 37; 3)

**Cause.** `recommendLearningIntent` read test/exam/quiz/review/prepare/study
in the goal sentence as `intent: "study"`. `firstTargetDecision` gives a topic
with no placement evidence, no learner-report tick and status `not_started` the
plan intent, so every topic in every test-prep plan opened in practice
("Teaching skipped", zero learn blocks).

**Fix.** `src/lib/learning/learning-intent.ts`: the goal-word study signal is
deleted. Only the learner's own words can start a plan in practice: "already
learned/know/covered/studied", "need (more) practice", "test my recall",
"mostly reviewing", "skip the basics", "don't/do not/no need to teach|explain".
Everything else starts at `learn`. Placement `demonstrated`, learner-report
ticks and recorded encounters still set `study` per topic in
`firstTargetDecision` (unchanged).

| Test | Red before fix | Green after |
|---|---|---|
| `learning-intent.test.ts` "teaches first when only the goal mentions a test or review" (6 goals) | `expected 'study' to be 'learn'` | 39/39 |
| `plans/generate/route.test.ts` "gives every untouched topic a learn block for a test-prep goal" ("I have a biology test next Friday", "Prepare for my AP Biology Unit 6 test") | `expected 'study' to be 'learn'` | 63/63 |
| `plan-generation/test-goal-teaches-first.test.ts` - goal -> intent -> composer -> router; notes-backed topic routes `learnPath: "source"`, direction reads `Review Chapter 12 notes.pdf...`; the topic without notes routes `ai_explanation` (finding 3) | `first block for ...01: expected 'study' to be 'learn'` | green |
| `src/evals/test-goal-teaches-first.live.test.ts` (permanent live test: provider map + provider fill, two test-prep goals, every scheduled topic's first block is learn) | n/a (live) | runs in CI's live step on every push and in the nightly live gate (auto-discovered) |

**Tests that had encoded the bug.** Seven route mechanics tests (Study Now
timing, forty-minute workload, repeated outcomes, degraded baseline, metered
mapping, method prose, fixed structure) used a fixture whose starting context
said "I need the concepts taught from the beginning" yet expected practice
blocks - practice they got only from the goal words. They now carry explicit
learner evidence ("I already learned this and need practice."); their
assertions are unchanged.

**Residual risk (founder).** A plan drafted before deploy with
`learningIntent: "study"` from goal words alone will now fail activation's
intent consistency check (`schema.ts` reuses `resolveLearningIntent`) and must
be regenerated. Legacy plans are being deleted per the brief.

Full unit suite: 508 files / 4603 tests passed. Lint and typecheck clean.
