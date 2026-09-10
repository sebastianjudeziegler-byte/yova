# Release comparison: BLOCKED

Main c7b3ca99964524cefc04437b7236b37fe8fe2666; branch 347f53947d56d61fba76202748c1be58cf649e41. Raw live counts: {"pass":50,"fail":5,"flaky":20,"unavailable":2}.

| Case | Main | Branch | Disposition |
| --- | --- | --- | --- |
| src/evals/launch-session-journeys.live.test.ts::launch session journeys with committed recipes > 'calculus' | 0 pass / 1 fail / 0 unavailable | 0 pass / 1 fail / 0 unavailable | Established flaky quarantine; raw outcomes retained |
| src/evals/launch-session-journeys.live.test.ts::launch session journeys with committed recipes > 'osmosis' | 1 pass / 0 fail / 0 unavailable | 0 pass / 1 fail / 0 unavailable | Established flaky quarantine; raw outcomes retained |
| src/evals/launch-session-journeys.live.test.ts::launch session journeys with committed recipes > 'recall' | 1 pass / 0 fail / 0 unavailable | 0 pass / 1 fail / 0 unavailable | Established flaky quarantine; raw outcomes retained |
| src/evals/launch-lesson-streams.live.test.ts::launch lesson delivery > streams the validated calculus teaching | 0 pass / 0 fail / 1 unavailable | 0 pass / 0 fail / 1 unavailable | Unavailable samples are neither red nor green |
| src/evals/launch-lesson-streams.live.test.ts::launch lesson delivery > streams the validated osmosis teaching | 1 pass / 0 fail / 0 unavailable | 0 pass / 0 fail / 1 unavailable | Unavailable samples are neither red nor green |
| src/evals/outside-teaching-reliability.live.test.ts::live outside-YOVA teaching reliability > builds an arbitrary three-target teaching-first session repeatedly | 0 pass / 1 fail / 0 unavailable | 1 pass / 0 fail / 0 unavailable | No regression |
| src/evals/plan-quality.live.test.ts::live OpenAI plan quality > 'Calculus problem-solving plan' | 0 pass / 1 fail / 0 unavailable | 1 pass / 0 fail / 0 unavailable | No regression |
| src/evals/plan-session-journey.live.test.ts::live plan-to-session journeys > 'World War I unit guide in short sessi…' | 0 pass / 1 fail / 0 unavailable | 0 pass / 1 fail / 0 unavailable | Established flaky quarantine; raw outcomes retained |
| src/evals/plan-session-journey.live.test.ts::live plan-to-session journeys > 'Full beginner calculus pathway' | 1 pass / 0 fail / 0 unavailable | 0 pass / 1 fail / 0 unavailable | Established flaky quarantine; raw outcomes retained |
| src/evals/session-quality.live.test.ts::live OpenAI session quality > 'Biology teaching from learner notes' | 0 pass / 1 fail / 0 unavailable | 0 pass / 1 fail / 0 unavailable | Pre-existing or improved failure; no product fix claimed |
| src/evals/session-quality.live.test.ts::live OpenAI session quality > 'World War I teaching for a complete b…' | 0 pass / 1 fail / 0 unavailable | 0 pass / 1 fail / 0 unavailable | Pre-existing or improved failure; no product fix claimed |
| src/evals/session-quality.live.test.ts::live OpenAI session quality > 'History reasoning from a primary-sour…' | 0 pass / 1 fail / 0 unavailable | 0 pass / 1 fail / 0 unavailable | Pre-existing or improved failure; no product fix claimed |
| src/evals/session-quality.live.test.ts::live OpenAI session quality > 'Literature close reading from a short…' | 0 pass / 1 fail / 0 unavailable | 0 pass / 1 fail / 0 unavailable | Pre-existing or improved failure; no product fix claimed |
| src/evals/session-quality.live.test.ts::live OpenAI session quality > 'Teaching from a thin biology study gu…' | 0 pass / 1 fail / 0 unavailable | 0 pass / 1 fail / 0 unavailable | Pre-existing or improved failure; no product fix claimed |
| src/evals/teaching-assessment-contract.live.test.ts::live teaching and assessment alignment > explains every glycolysis product before accepting a learner's paraphrase | 0 pass / 1 fail / 0 unavailable | 1 pass / 0 fail / 0 unavailable | No regression |
| src/lib/diagnostics/map-diagnostic.live.test.ts::live map diagnostic generation > generates from a material map and reports latency | 0 pass / 1 fail / 0 unavailable | 0 pass / 1 fail / 0 unavailable | Established flaky quarantine; raw outcomes retained |
| src/lib/diagnostics/map-diagnostic.live.test.ts::live map diagnostic generation > generates from a ai_generated map and reports latency | 0 pass / 1 fail / 0 unavailable | 1 pass / 0 fail / 0 unavailable | No regression |
| core-learning-loop.spec.ts::desktop-chromium::map revision cannot activate a stale draft and fresh placement uses the revised map | 1 pass / 0 fail / 0 unavailable | 0 pass / 0 fail / 0 unavailable | Required case was not executed |
| core-learning-loop.spec.ts::mobile-chromium::map revision cannot activate a stale draft and fresh placement uses the revised map | 1 pass / 0 fail / 0 unavailable | 0 pass / 0 fail / 0 unavailable | Required case was not executed |
