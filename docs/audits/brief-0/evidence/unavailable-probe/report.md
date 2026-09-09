# Live gate: NON-BLOCKING — includes unavailable results

Commit: e03a082659f51172c0b06bf84daffdd5599ac773. Runs: 1. All files execute serially; quarantined flaky tests still execute.

Pass: **0** · Fail: **0** · Flaky: **0** · Unavailable: **66**

Flaky and unavailable rows do not block. An unavailable result is neither a pass nor a semantic failure. Unknown failures and unexpected skips block.

| Test | Run | Result | Triage | Evidence |
| --- | --- | --- | --- | --- |
| src/evals/session-quality.live.test.ts — live OpenAI session quality > the requested case exists | 1 | UNAVAILABLE | unclassified | OPENAI_API_KEY is missing; this case was not run |
| src/evals/session-quality.live.test.ts — live OpenAI session quality > 'Biology teaching from learner notes' | 1 | UNAVAILABLE | REAL | OPENAI_API_KEY is missing; this case was not run |
| src/evals/session-quality.live.test.ts — live OpenAI session quality > 'Bioenergetics multi-target retrieval …' | 1 | UNAVAILABLE | unclassified | OPENAI_API_KEY is missing; this case was not run |
| src/evals/session-quality.live.test.ts — live OpenAI session quality > 'Fifteen-minute temperature and reacti…' | 1 | UNAVAILABLE | STALE | OPENAI_API_KEY is missing; this case was not run |
| src/evals/session-quality.live.test.ts — live OpenAI session quality > 'Fifteen-minute first product-rule les…' | 1 | UNAVAILABLE | FLAKY | OPENAI_API_KEY is missing; this case was not run |
| src/evals/session-quality.live.test.ts — live OpenAI session quality > 'Mapped product-rule and chain-rule fi…' | 1 | UNAVAILABLE | REAL | OPENAI_API_KEY is missing; this case was not run |
| src/evals/session-quality.live.test.ts — live OpenAI session quality > 'Production-shaped derivative-foundati…' | 1 | UNAVAILABLE | FLAKY | OPENAI_API_KEY is missing; this case was not run |
| src/evals/session-quality.live.test.ts — live OpenAI session quality > 'World War I teaching for a complete b…' | 1 | UNAVAILABLE | REAL | OPENAI_API_KEY is missing; this case was not run |
| src/evals/session-quality.live.test.ts — live OpenAI session quality > 'Mapped 45-minute World War I baseline…' | 1 | UNAVAILABLE | FLAKY | OPENAI_API_KEY is missing; this case was not run |
| src/evals/session-quality.live.test.ts — live OpenAI session quality > 'Calculus repair after a weak check' | 1 | UNAVAILABLE | FLAKY | OPENAI_API_KEY is missing; this case was not run |
| src/evals/session-quality.live.test.ts — live OpenAI session quality > 'Self-contained delayed calculus review' | 1 | UNAVAILABLE | unclassified | OPENAI_API_KEY is missing; this case was not run |
| src/evals/session-quality.live.test.ts — live OpenAI session quality > 'History writing outside YOVA' | 1 | UNAVAILABLE | unclassified | OPENAI_API_KEY is missing; this case was not run |
| src/evals/session-quality.live.test.ts — live OpenAI session quality > 'Beginner JavaScript with fading suppo…' | 1 | UNAVAILABLE | REAL | OPENAI_API_KEY is missing; this case was not run |
| src/evals/session-quality.live.test.ts — live OpenAI session quality > 'General-learning finance application' | 1 | UNAVAILABLE | STALE | OPENAI_API_KEY is missing; this case was not run |
| src/evals/session-quality.live.test.ts — live OpenAI session quality > 'Fifteen-minute vocabulary review' | 1 | UNAVAILABLE | unclassified | OPENAI_API_KEY is missing; this case was not run |
| src/evals/session-quality.live.test.ts — live OpenAI session quality > 'Startup funding foundations for a new…' | 1 | UNAVAILABLE | STALE | OPENAI_API_KEY is missing; this case was not run |
| src/evals/session-quality.live.test.ts — live OpenAI session quality > 'History reasoning from a primary-sour…' | 1 | UNAVAILABLE | REAL | OPENAI_API_KEY is missing; this case was not run |
| src/evals/session-quality.live.test.ts — live OpenAI session quality > 'Literature close reading from a short…' | 1 | UNAVAILABLE | REAL | OPENAI_API_KEY is missing; this case was not run |
| src/evals/session-quality.live.test.ts — live OpenAI session quality > 'Spanish conversation with supported t…' | 1 | UNAVAILABLE | REAL | OPENAI_API_KEY is missing; this case was not run |
| src/evals/session-quality.live.test.ts — live OpenAI session quality > 'Teaching from a thin biology study gu…' | 1 | UNAVAILABLE | REAL | OPENAI_API_KEY is missing; this case was not run |
| src/evals/plan-creation-blockers.live.test.ts — live provider launch canaries > real placement questions and a map-only scope correction preserve demonstrated ATP | 1 | UNAVAILABLE | STALE | OPENAI_API_KEY is missing; this case was not run |
| src/evals/plan-creation-blockers.live.test.ts — live provider launch canaries > a ten-minute triage generates a runnable lesson on its saved topic | 1 | UNAVAILABLE | unclassified | OPENAI_API_KEY is missing; this case was not run |
| src/evals/plan-quality.live.test.ts — live OpenAI plan quality > the requested case exists | 1 | UNAVAILABLE | unclassified | OPENAI_API_KEY is missing; this case was not run |
| src/evals/plan-quality.live.test.ts — live OpenAI plan quality > 'Biology test with learner notes' | 1 | UNAVAILABLE | STALE | OPENAI_API_KEY is missing; this case was not run |
| src/evals/plan-quality.live.test.ts — live OpenAI plan quality > 'Calculus problem-solving plan' | 1 | UNAVAILABLE | STALE | OPENAI_API_KEY is missing; this case was not run |
| src/evals/plan-quality.live.test.ts — live OpenAI plan quality > 'Calculus unit with mixed placement ev…' | 1 | UNAVAILABLE | unclassified | OPENAI_API_KEY is missing; this case was not run |
| src/evals/plan-quality.live.test.ts — live OpenAI plan quality > 'One product-rule skill in short sessi…' | 1 | UNAVAILABLE | STALE | OPENAI_API_KEY is missing; this case was not run |
| src/evals/plan-quality.live.test.ts — live OpenAI plan quality > 'World War I unit guide in short sessi…' | 1 | UNAVAILABLE | STALE | OPENAI_API_KEY is missing; this case was not run |
| src/evals/plan-quality.live.test.ts — live OpenAI plan quality > 'Full beginner calculus pathway' | 1 | UNAVAILABLE | STALE | OPENAI_API_KEY is missing; this case was not run |
| src/evals/plan-quality.live.test.ts — live OpenAI plan quality > 'General-learning startup funding path…' | 1 | UNAVAILABLE | STALE | OPENAI_API_KEY is missing; this case was not run |
| src/evals/plan-quality.live.test.ts — live OpenAI plan quality > 'History essay using outside sources' | 1 | UNAVAILABLE | STALE | OPENAI_API_KEY is missing; this case was not run |
| src/evals/plan-quality.live.test.ts — live OpenAI plan quality > 'Beginner JavaScript practice' | 1 | UNAVAILABLE | STALE | OPENAI_API_KEY is missing; this case was not run |
| src/evals/plan-quality.live.test.ts — live OpenAI plan quality > 'General-learning finance pathway' | 1 | UNAVAILABLE | STALE | OPENAI_API_KEY is missing; this case was not run |
| src/evals/plan-session-journey.live.test.ts — live plan-to-session journeys > the requested journey exists | 1 | UNAVAILABLE | unclassified | OPENAI_API_KEY is missing; this case was not run |
| src/evals/plan-session-journey.live.test.ts — live plan-to-session journeys > 'One product-rule skill in short sessi…' | 1 | UNAVAILABLE | STALE | OPENAI_API_KEY is missing; this case was not run |
| src/evals/plan-session-journey.live.test.ts — live plan-to-session journeys > 'World War I unit guide in short sessi…' | 1 | UNAVAILABLE | REAL | OPENAI_API_KEY is missing; this case was not run |
| src/evals/plan-session-journey.live.test.ts — live plan-to-session journeys > 'Full beginner calculus pathway' | 1 | UNAVAILABLE | STALE | OPENAI_API_KEY is missing; this case was not run |
| src/evals/plan-session-journey.live.test.ts — live plan-to-session journeys > 'History essay using outside sources' | 1 | UNAVAILABLE | STALE | OPENAI_API_KEY is missing; this case was not run |
| src/evals/outside-teaching-reliability.live.test.ts — live outside-YOVA teaching reliability > builds an arbitrary three-target teaching-first session repeatedly | 1 | UNAVAILABLE | FLAKY | OPENAI_API_KEY is missing; this case was not run |
| src/evals/streamed-world-war-one-skeleton.live.test.ts — live exact World War I baseline skeleton > creates the production 45-minute streamed teaching session | 1 | UNAVAILABLE | REAL | OPENAI_API_KEY is missing; this case was not run |
| src/evals/streamed-world-war-one-skeleton.live.test.ts — live streamed World War I session skeleton > reliably creates a valid subject-specific session outline | 1 | UNAVAILABLE | unclassified | OPENAI_API_KEY is missing; this case was not run |
| src/lib/diagnostics/map-diagnostic.live.test.ts — live map diagnostic generation > generates from a material map and reports latency | 1 | UNAVAILABLE | FLAKY | OPENAI_API_KEY is missing; this case was not run |
| src/lib/diagnostics/map-diagnostic.live.test.ts — live map diagnostic generation > generates from a ai_generated map and reports latency | 1 | UNAVAILABLE | FLAKY | OPENAI_API_KEY is missing; this case was not run |
| src/evals/streamed-world-war-one-lesson.live.test.ts — live streamed World War I lesson > delivers substantive teaching from the first generated lesson brief | 1 | UNAVAILABLE | REAL | OPENAI_API_KEY is missing; this case was not run |
| src/evals/streamed-ap-biology.live.test.ts — live streamed AP Biology session > builds a topic-specific teaching skeleton | 1 | UNAVAILABLE | REAL | OPENAI_API_KEY is missing; this case was not run |
| src/evals/answer-evaluation-quality.live.test.ts — live OpenAI answer evaluation quality > the requested case exists | 1 | UNAVAILABLE | unclassified | OPENAI_API_KEY is missing; this case was not run |
| src/evals/answer-evaluation-quality.live.test.ts — live OpenAI answer evaluation quality > 'accepts a correct biology paraphrase' | 1 | UNAVAILABLE | REAL | OPENAI_API_KEY is missing; this case was not run |
| src/evals/answer-evaluation-quality.live.test.ts — live OpenAI answer evaluation quality > 'catches confident biology keyword soup' | 1 | UNAVAILABLE | unclassified | OPENAI_API_KEY is missing; this case was not run |
| src/evals/answer-evaluation-quality.live.test.ts — live OpenAI answer evaluation quality > 'marks a materially incomplete causal …' | 1 | UNAVAILABLE | unclassified | OPENAI_API_KEY is missing; this case was not run |
| src/evals/answer-evaluation-quality.live.test.ts — live OpenAI answer evaluation quality > 'accepts equivalent mathematical notat…' | 1 | UNAVAILABLE | unclassified | OPENAI_API_KEY is missing; this case was not run |
| src/evals/answer-evaluation-quality.live.test.ts — live OpenAI answer evaluation quality > 'does not reward a true statement that…' | 1 | UNAVAILABLE | unclassified | OPENAI_API_KEY is missing; this case was not run |
| src/evals/answer-evaluation-quality.live.test.ts — live OpenAI answer evaluation quality > 'accepts a concise programming explana…' | 1 | UNAVAILABLE | REAL | OPENAI_API_KEY is missing; this case was not run |
| src/evals/answer-evaluation-quality.live.test.ts — live OpenAI answer evaluation quality > 'admits uncertainty when the prompt la…' | 1 | UNAVAILABLE | REAL | OPENAI_API_KEY is missing; this case was not run |
| src/evals/streamed-rayleigh.live.test.ts — live streamed Rayleigh-scattering session > builds the production 15-minute two-target teaching skeleton | 1 | UNAVAILABLE | STALE | OPENAI_API_KEY is missing; this case was not run |
| src/evals/teaching-assessment-contract.live.test.ts — live teaching and assessment alignment > explains every glycolysis product before accepting a learner's paraphrase | 1 | UNAVAILABLE | FLAKY | OPENAI_API_KEY is missing; this case was not run |
| src/evals/launch-session-journeys.live.test.ts — launch session journeys with committed recipes > 'calculus' | 1 | UNAVAILABLE | FLAKY | OPENAI_API_KEY is missing; this case was not run |
| src/evals/launch-session-journeys.live.test.ts — launch session journeys with committed recipes > 'osmosis' | 1 | UNAVAILABLE | unclassified | OPENAI_API_KEY is missing; this case was not run |
| src/evals/launch-session-journeys.live.test.ts — launch session journeys with committed recipes > 'recall' | 1 | UNAVAILABLE | unclassified | OPENAI_API_KEY is missing; this case was not run |
| src/evals/streamed-melatonin-skeleton.live.test.ts — live streamed Melatonin session skeleton > reliably creates the affected 15-minute teaching-first session | 1 | UNAVAILABLE | unclassified | OPENAI_API_KEY is missing; this case was not run |
| src/evals/launch-lesson-streams.live.test.ts — launch lesson delivery > streams the validated calculus teaching | 1 | UNAVAILABLE | UNAVAILABLE | OPENAI_API_KEY is missing; this case was not run |
| src/evals/launch-lesson-streams.live.test.ts — launch lesson delivery > streams the validated osmosis teaching | 1 | UNAVAILABLE | unclassified | OPENAI_API_KEY is missing; this case was not run |
| src/evals/lesson-tutor.live.test.ts — live in-lesson Ask YOVA safeguards > answers a genuinely off-topic question instead of refusing it | 1 | UNAVAILABLE | unclassified | OPENAI_API_KEY is missing; this case was not run |
| src/evals/lesson-tutor.live.test.ts — live in-lesson Ask YOVA safeguards > does not reveal the answer to a later protected knowledge check | 1 | UNAVAILABLE | unclassified | OPENAI_API_KEY is missing; this case was not run |
| src/evals/material-osmosis-session.live.test.ts — live shortened material-backed osmosis session > keeps two current targets and defers the third in a 15-minute window | 1 | UNAVAILABLE | FLAKY | OPENAI_API_KEY is missing; this case was not run |
| e2e/plan-launch-live.spec.ts — a live-generated deadline lesson streams, finishes unrated and preserves completion on reload (desktop-chromium) | 1 | UNAVAILABLE | FLAKY | OPENAI_API_KEY is missing; this case was not run |
| e2e/plan-launch-live.spec.ts — a live-generated deadline lesson streams, finishes unrated and preserves completion on reload (mobile-chromium) | 1 | UNAVAILABLE | FLAKY | OPENAI_API_KEY is missing; this case was not run |
