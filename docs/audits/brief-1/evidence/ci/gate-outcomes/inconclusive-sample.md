# Release comparison: INCONCLUSIVE — re-run the gate

14 of 77 live cases were unavailable (18.2%, over the 10% ceiling). The provider was degraded, so this sample cannot establish a regression either way. Re-run the gate.

Main c7b3ca99964524cefc04437b7236b37fe8fe2666; branch f430b6165e33c2f2073c76472b737dc51df60108. Raw live counts: {"pass":39,"fail":9,"flaky":15,"unavailable":14}.

Inconclusive blocks the merge exactly as a regression does. It reports that this sample cannot answer the question, not that the branch is clean.

| Case | Main | Branch | Disposition |
| --- | --- | --- | --- |
| src/evals/launch-session-journeys.live.test.ts::launch session journeys with committed recipes > 'calculus' | 0 pass / 1 fail / 0 unavailable | 1 pass / 0 fail / 0 unavailable | No regression |
| src/evals/outside-teaching-reliability.live.test.ts::live outside-YOVA teaching reliability > builds an arbitrary three-target teaching-first session repeatedly | 0 pass / 1 fail / 0 unavailable | 0 pass / 1 fail / 0 unavailable | Established flaky quarantine; raw outcomes retained |
| src/evals/plan-creation-blockers.live.test.ts::live provider launch canaries > real placement questions and a map-only scope correction preserve demonstrated ATP | 1 pass / 0 fail / 0 unavailable | 0 pass / 1 fail / 0 unavailable | Established flaky quarantine; raw outcomes retained |
| src/evals/plan-quality.live.test.ts::live OpenAI plan quality > 'Calculus problem-solving plan' | 0 pass / 1 fail / 0 unavailable | 1 pass / 0 fail / 0 unavailable | No regression |
| src/evals/plan-quality.live.test.ts::live OpenAI plan quality > 'World War I unit guide in short sessi…' | 1 pass / 0 fail / 0 unavailable | 0 pass / 1 fail / 0 unavailable | Established flaky quarantine; raw outcomes retained |
| src/evals/plan-quality.live.test.ts::live OpenAI plan quality > 'History essay using outside sources' | 0 pass / 0 fail / 1 unavailable | 0 pass / 0 fail / 1 unavailable | Unavailable samples are neither red nor green |
| src/evals/plan-session-journey.live.test.ts::live plan-to-session journeys > 'World War I unit guide in short sessi…' | 0 pass / 1 fail / 0 unavailable | 0 pass / 1 fail / 0 unavailable | Established flaky quarantine; raw outcomes retained |
| src/evals/session-quality.live.test.ts::live OpenAI session quality > 'Biology teaching from learner notes' | 0 pass / 1 fail / 0 unavailable | 0 pass / 1 fail / 0 unavailable | Pre-existing or improved failure; no product fix claimed |
| src/evals/session-quality.live.test.ts::live OpenAI session quality > 'World War I teaching for a complete b…' | 0 pass / 1 fail / 0 unavailable | 0 pass / 1 fail / 0 unavailable | Pre-existing or improved failure; no product fix claimed |
| src/evals/session-quality.live.test.ts::live OpenAI session quality > 'History reasoning from a primary-sour…' | 0 pass / 1 fail / 0 unavailable | 0 pass / 1 fail / 0 unavailable | Pre-existing or improved failure; no product fix claimed |
| src/evals/session-quality.live.test.ts::live OpenAI session quality > 'Literature close reading from a short…' | 0 pass / 1 fail / 0 unavailable | 0 pass / 1 fail / 0 unavailable | Pre-existing or improved failure; no product fix claimed |
| src/evals/session-quality.live.test.ts::live OpenAI session quality > 'Teaching from a thin biology study gu…' | 0 pass / 1 fail / 0 unavailable | 0 pass / 1 fail / 0 unavailable | Pre-existing or improved failure; no product fix claimed |
| src/evals/teaching-assessment-contract.live.test.ts::live teaching and assessment alignment > explains every glycolysis product before accepting a learner's paraphrase | 0 pass / 1 fail / 0 unavailable | 1 pass / 0 fail / 0 unavailable | No regression |
| src/lib/diagnostics/map-diagnostic.live.test.ts::live map diagnostic generation > generates from a material map and reports latency | 0 pass / 1 fail / 0 unavailable | 0 pass / 1 fail / 0 unavailable | Established flaky quarantine; raw outcomes retained |
| src/lib/diagnostics/map-diagnostic.live.test.ts::live map diagnostic generation > generates from a ai_generated map and reports latency | 0 pass / 1 fail / 0 unavailable | 0 pass / 1 fail / 0 unavailable | Established flaky quarantine; raw outcomes retained |
