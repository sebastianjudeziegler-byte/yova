# Main versus branch: every failed or unavailable live case

| Test | Main c7b3ca9 | Branch f7fcfb8 | Disposition |
| --- | --- | --- | --- |
| src/evals/launch-lesson-streams.live.test.ts::launch lesson delivery > streams the validated calculus teaching | UNAVAILABLE (failed) | PASS (passed) | Pass in this branch sample; no fix claimed. |
| src/evals/launch-lesson-streams.live.test.ts::launch lesson delivery > streams the validated osmosis teaching | PASS (passed) | UNAVAILABLE (failed) | Unavailable in branch; neither pass nor semantic failure. |
| src/evals/launch-session-journeys.live.test.ts::launch session journeys with committed recipes > 'calculus' | FLAKY (failed) | FLAKY (passed) | Existing quarantine retained; raw failed attempts stay visible. |
| src/evals/launch-session-journeys.live.test.ts::launch session journeys with committed recipes > 'osmosis' | PASS (passed) | FAIL (failed) | Known intermittent case, explicitly deferred; quarantine added. No product fix. |
| src/evals/outside-teaching-reliability.live.test.ts::live outside-YOVA teaching reliability > builds an arbitrary three-target teaching-first session repeatedly | FLAKY (failed) | FLAKY (failed) | Existing quarantine retained; raw failed attempts stay visible. |
| src/evals/plan-creation-blockers.live.test.ts::live provider launch canaries > real placement questions and a map-only scope correction preserve demonstrated ATP | PASS (passed) | FAIL (failed) | Known intermittent case, explicitly deferred; quarantine added. No product fix. |
| src/evals/plan-quality.live.test.ts::live OpenAI plan quality > 'Calculus problem-solving plan' | FAIL (failed) | PASS (passed) | Pass in this branch sample; no fix claimed. |
| src/evals/plan-quality.live.test.ts::live OpenAI plan quality > 'General-learning finance pathway' | UNAVAILABLE (failed) | PASS (passed) | Pass in this branch sample; no fix claimed. |
| src/evals/plan-quality.live.test.ts::live OpenAI plan quality > 'General-learning startup funding path…' | UNAVAILABLE (failed) | PASS (passed) | Pass in this branch sample; no fix claimed. |
| src/evals/plan-quality.live.test.ts::live OpenAI plan quality > 'History essay using outside sources' | UNAVAILABLE (failed) | PASS (passed) | Pass in this branch sample; no fix claimed. |
| src/evals/plan-session-journey.live.test.ts::live plan-to-session journeys > 'Full beginner calculus pathway' | FLAKY (passed) | FLAKY (failed) | Existing quarantine retained; raw failed attempts stay visible. |
| src/evals/plan-session-journey.live.test.ts::live plan-to-session journeys > 'History essay using outside sources' | PASS (passed) | FAIL (failed) | BLOCKING pass→fail comparison; capacity error. No quarantine or fix claimed. |
| src/evals/plan-session-journey.live.test.ts::live plan-to-session journeys > 'World War I unit guide in short sessi…' | FLAKY (failed) | FLAKY (failed) | Existing quarantine retained; raw failed attempts stay visible. |
| src/evals/session-quality.live.test.ts::live OpenAI session quality > 'Biology teaching from learner notes' | FAIL (failed) | FAIL (failed) | Pre-existing deferred failure; unchanged case outcome. |
| src/evals/session-quality.live.test.ts::live OpenAI session quality > 'History reasoning from a primary-sour…' | FAIL (failed) | FAIL (failed) | Pre-existing deferred failure; unchanged case outcome. |
| src/evals/session-quality.live.test.ts::live OpenAI session quality > 'Literature close reading from a short…' | FAIL (failed) | FAIL (failed) | Pre-existing deferred failure; unchanged case outcome. |
| src/evals/session-quality.live.test.ts::live OpenAI session quality > 'Teaching from a thin biology study gu…' | FAIL (failed) | FAIL (failed) | Pre-existing deferred failure; unchanged case outcome. |
| src/evals/session-quality.live.test.ts::live OpenAI session quality > 'World War I teaching for a complete b…' | FAIL (failed) | FAIL (failed) | Pre-existing deferred failure; unchanged case outcome. |
| src/evals/teaching-assessment-contract.live.test.ts::live teaching and assessment alignment > explains every glycolysis product before accepting a learner's paraphrase | FLAKY (failed) | FLAKY (passed) | Existing quarantine retained; raw failed attempts stay visible. |
| src/lib/diagnostics/map-diagnostic.live.test.ts::live map diagnostic generation > generates from a ai_generated map and reports latency | FLAKY (failed) | UNAVAILABLE (failed) | Unavailable in branch; neither pass nor semantic failure. |
| src/lib/diagnostics/map-diagnostic.live.test.ts::live map diagnostic generation > generates from a material map and reports latency | FLAKY (failed) | FLAKY (passed) | Existing quarantine retained; raw failed attempts stay visible. |

Raw rows and nested error causes: [comparison.json](comparison.json). These are one complete sample per revision, with historical quarantine evidence explicitly named. Missing generated lesson fixtures remain unavailable.
