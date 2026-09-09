# Combined release 2098e66: actual outcomes (merge held)

GitHub Actions run 34370432851; tested merge `a013b63229834d0b8e579e995040ff4613154521`; release head `2098e66d57cd21b37113d329a603bfacc2ae8cf1`.

These are the observed results, separate from the historical quarantine policy. UNAVAILABLE is neither red nor green. The main column comes from Brief 0's retained baseline, with its original test expectations; supplementary same-day main comparisons and corrected stale expectations are identified in EVIDENCE.md.

| Case / test | Main baseline (runs 1–3) | Release (runs 1–3) | Policy |
| --- | --- | --- | --- |
| X02 — launch session journeys with committed recipes > 'calculus' | FAIL / PASS / PASS | FAIL / PASS / PASS | flaky |
| — — launch session journeys with committed recipes > 'osmosis' | PASS / PASS / PASS | PASS / PASS / PASS | pass |
| — — launch session journeys with committed recipes > 'recall' | PASS / PASS / PASS | PASS / PASS / FAIL | fail / pass |
| X01 — launch lesson delivery > streams the validated calculus teaching | UNAVAILABLE / PASS / PASS | UNAVAILABLE / PASS / PASS | pass / unavailable |
| — — launch lesson delivery > streams the validated osmosis teaching | PASS / PASS / PASS | PASS / PASS / PASS | pass |
| — — live OpenAI answer evaluation quality > the requested case exists | PASS / PASS / PASS | PASS / PASS / PASS | pass |
| A01 — live OpenAI answer evaluation quality > 'accepts a correct biology paraphrase' | FAIL / FAIL / FAIL | PASS / PASS / PASS | pass |
| — — live OpenAI answer evaluation quality > 'catches confident biology keyword soup' | PASS / PASS / PASS | FAIL / PASS / PASS | fail / pass |
| — — live OpenAI answer evaluation quality > 'marks a materially incomplete causal …' | PASS / PASS / PASS | PASS / PASS / PASS | pass |
| — — live OpenAI answer evaluation quality > 'accepts equivalent mathematical notat…' | PASS / PASS / PASS | PASS / PASS / PASS | pass |
| — — live OpenAI answer evaluation quality > 'does not reward a true statement that…' | PASS / PASS / PASS | PASS / PASS / PASS | pass |
| A02 — live OpenAI answer evaluation quality > 'accepts a concise programming explana…' | FAIL / FAIL / FAIL | PASS / PASS / PASS | pass |
| A03 — live OpenAI answer evaluation quality > 'admits uncertainty when the prompt la…' | FAIL / FAIL / FAIL | PASS / PASS / PASS | pass |
| — — live grader calibration across subjects > complete: 'accepts a correct biology paraphrase' | Not in the retained main cohort | PASS / PASS / PASS | pass |
| — — live grader calibration across subjects > complete: 'accepts a concise programming explana…' | Not in the retained main cohort | PASS / PASS / PASS | pass |
| — — live grader calibration across subjects > complete: 'history: complete-history' | Not in the retained main cohort | PASS / PASS / PASS | pass |
| — — live grader calibration across subjects > insufficient: 'biology: underspecified-biology' | Not in the retained main cohort | PASS / PASS / PASS | pass |
| — — live grader calibration across subjects > insufficient: 'programming: underspecified-programmi…' | Not in the retained main cohort | PASS / PASS / PASS | pass |
| — — live grader calibration across subjects > insufficient: 'history: underspecified-history' | Not in the retained main cohort | PASS / PASS / PASS | pass |
| — — live grader calibration across subjects > insufficient: 'biology: missing-context-biology' | Not in the retained main cohort | PASS / PASS / PASS | pass |
| — — live grader calibration across subjects > insufficient: 'programming: missing-context-programm…' | Not in the retained main cohort | PASS / PASS / PASS | pass |
| — — live grader calibration across subjects > insufficient: 'history: missing-context-history' | Not in the retained main cohort | PASS / PASS / PASS | pass |
| — — live in-lesson Ask YOVA safeguards > answers a genuinely off-topic question instead of refusing it | PASS / PASS / PASS | PASS / PASS / PASS | pass |
| — — live in-lesson Ask YOVA safeguards > does not reveal the answer to a later protected knowledge check | PASS / PASS / PASS | PASS / PASS / PASS | pass |
| X05 — live shortened material-backed osmosis session > keeps two current targets and defers the third in a 15-minute window | FAIL / PASS / PASS | PASS / PASS / PASS | flaky |
| A04 — live outside-YOVA teaching reliability > builds an arbitrary three-target teaching-first session repeatedly | FAIL / PASS / FAIL | PASS / PASS / PASS | flaky |
| — — Brief A real-provider personalization delta > writes two distinct learner plans inside fixed slots using the real provider | Not in the retained main cohort | PASS / PASS / PASS | pass |
| A05 — live provider launch canaries > real placement questions and a map-only scope correction preserve demonstrated ATP | FAIL / FAIL / FAIL | PASS / UNAVAILABLE / PASS | pass / unavailable |
| — — live provider launch canaries > a ten-minute triage generates a runnable lesson on its saved topic | PASS / PASS / PASS | PASS / PASS / PASS | pass |
| — — live OpenAI plan quality > the requested case exists | PASS / PASS / PASS | PASS / PASS / PASS | pass |
| A06 — live OpenAI plan quality > 'Biology test with learner notes' | FAIL / FAIL / FAIL | PASS / PASS / UNAVAILABLE | pass / unavailable |
| A07 — live OpenAI plan quality > 'Calculus problem-solving plan' | FAIL / FAIL / FAIL | UNAVAILABLE / PASS / PASS | pass / unavailable |
| — — live OpenAI plan quality > 'Calculus unit with mixed placement ev…' | PASS / PASS / PASS | PASS / PASS / PASS | pass |
| A08 — live OpenAI plan quality > 'One product-rule skill in short sessi…' | UNAVAILABLE / FAIL / FAIL | PASS / PASS / PASS | pass |
| A09 — live OpenAI plan quality > 'World War I unit guide in short sessi…' | FAIL / FAIL / FAIL | PASS / FAIL / PASS | fail / pass |
| A10 — live OpenAI plan quality > 'Full beginner calculus pathway' | FAIL / FAIL / FAIL | PASS / UNAVAILABLE / PASS | pass / unavailable |
| A11 — live OpenAI plan quality > 'General-learning startup funding path…' | FAIL / FAIL / FAIL | PASS / UNAVAILABLE / PASS | pass / unavailable |
| A12 — live OpenAI plan quality > 'History essay using outside sources' | UNAVAILABLE / UNAVAILABLE / FAIL | PASS / PASS / PASS | pass |
| A13 — live OpenAI plan quality > 'Beginner JavaScript practice' | FAIL / FAIL / UNAVAILABLE | PASS / PASS / PASS | pass |
| A14 — live OpenAI plan quality > 'General-learning finance pathway' | FAIL / FAIL / FAIL | PASS / PASS / PASS | pass |
| — — live plan-to-session journeys > the requested journey exists | PASS / PASS / PASS | PASS / PASS / PASS | pass |
| A15 — live plan-to-session journeys > 'One product-rule skill in short sessi…' | FAIL / UNAVAILABLE / FAIL | PASS / FAIL / PASS | fail / pass |
| A16 — live plan-to-session journeys > 'World War I unit guide in short sessi…' | FAIL / FAIL / FAIL | PASS / FAIL / FAIL | fail / pass |
| A17 — live plan-to-session journeys > 'Full beginner calculus pathway' | FAIL / FAIL / FAIL | PASS / FAIL / PASS | fail / pass |
| A18 — live plan-to-session journeys > 'History essay using outside sources' | FAIL / FAIL / FAIL | UNAVAILABLE / PASS / PASS | pass / unavailable |
| — — live OpenAI session quality > the requested case exists | PASS / PASS / PASS | PASS / PASS / PASS | pass |
| A19 — live OpenAI session quality > 'Biology teaching from learner notes' | FAIL / FAIL / FAIL | FAIL / FAIL / FAIL | fail |
| — — live OpenAI session quality > 'Bioenergetics multi-target retrieval …' | PASS / PASS / PASS | PASS / PASS / PASS | pass |
| A20 — live OpenAI session quality > 'Fifteen-minute temperature and reacti…' | FAIL / FAIL / FAIL | PASS / PASS / PASS | pass |
| A21 — live OpenAI session quality > 'Fifteen-minute first product-rule les…' | FAIL / PASS / FAIL | PASS / PASS / PASS | flaky |
| A22 — live OpenAI session quality > 'Mapped product-rule and chain-rule fi…' | FAIL / FAIL / FAIL | PASS / PASS / PASS | pass |
| A23 — live OpenAI session quality > 'Production-shaped derivative-foundati…' | PASS / FAIL / PASS | PASS / FAIL / PASS | flaky |
| A24 — live OpenAI session quality > 'World War I teaching for a complete b…' | FAIL / FAIL / FAIL | FAIL / FAIL / FAIL | fail |
| A25 — live OpenAI session quality > 'Mapped 45-minute World War I baseline…' | PASS / FAIL / PASS | PASS / PASS / PASS | flaky |
| A26 — live OpenAI session quality > 'Calculus repair after a weak check' | FAIL / FAIL / PASS | PASS / PASS / PASS | flaky |
| — — live OpenAI session quality > 'Self-contained delayed calculus review' | PASS / PASS / PASS | PASS / PASS / PASS | pass |
| — — live OpenAI session quality > 'History writing outside YOVA' | PASS / PASS / PASS | PASS / PASS / PASS | pass |
| A27 — live OpenAI session quality > 'Beginner JavaScript with fading suppo…' | FAIL / FAIL / FAIL | PASS / PASS / FAIL | fail / pass |
| A28 — live OpenAI session quality > 'General-learning finance application' | FAIL / FAIL / FAIL | PASS / PASS / PASS | pass |
| — — live OpenAI session quality > 'Fifteen-minute vocabulary review' | PASS / PASS / PASS | PASS / PASS / PASS | pass |
| A29 — live OpenAI session quality > 'Startup funding foundations for a new…' | FAIL / FAIL / FAIL | PASS / PASS / PASS | pass |
| A30 — live OpenAI session quality > 'History reasoning from a primary-sour…' | FAIL / FAIL / FAIL | FAIL / FAIL / FAIL | fail |
| A31 — live OpenAI session quality > 'Literature close reading from a short…' | FAIL / FAIL / FAIL | FAIL / FAIL / FAIL | fail |
| A32 — live OpenAI session quality > 'Spanish conversation with supported t…' | FAIL / FAIL / FAIL | PASS / PASS / PASS | pass |
| A33 — live OpenAI session quality > 'Teaching from a thin biology study gu…' | FAIL / FAIL / FAIL | FAIL / FAIL / FAIL | fail |
| X06 — live streamed AP Biology session > builds a topic-specific teaching skeleton | FAIL / FAIL / FAIL | PASS / PASS / PASS | pass |
| — — live streamed Melatonin session skeleton > reliably creates the affected 15-minute teaching-first session | PASS / PASS / PASS | PASS / PASS / PASS | pass |
| A34 — live streamed Rayleigh-scattering session > builds the production 15-minute two-target teaching skeleton | FAIL / FAIL / FAIL | PASS / PASS / PASS | pass |
| A35 — live streamed World War I lesson > delivers substantive teaching from the first generated lesson brief | FAIL / FAIL / FAIL | PASS / PASS / PASS | pass |
| A36 — live exact World War I baseline skeleton > creates the production 45-minute streamed teaching session | FAIL / FAIL / FAIL | PASS / PASS / PASS | pass |
| — — live streamed World War I session skeleton > reliably creates a valid subject-specific session outline | PASS / PASS / PASS | PASS / PASS / PASS | pass |
| X07 — live teaching and assessment alignment > explains every glycolysis product before accepting a learner's paraphrase | PASS / PASS / FAIL | PASS / PASS / PASS | flaky |
| X03 — live map diagnostic generation > generates from a material map and reports latency | UNAVAILABLE / PASS / FAIL | PASS / FAIL / PASS | flaky |
| X04 — live map diagnostic generation > generates from a ai_generated map and reports latency | FAIL / PASS / PASS | PASS / UNAVAILABLE / PASS | flaky / unavailable |
| A37 — a live-generated deadline lesson streams, finishes unrated and preserves completion on reload (desktop-chromium) | PASS / PASS / FAIL | PASS / PASS / PASS | flaky |
| A38 — a live-generated deadline lesson streams, finishes unrated and preserves completion on reload (mobile-chromium) | PASS / PASS / FAIL | PASS / PASS / PASS | flaky |

Policy counts (observations): pass: 162, fail: 23, flaky: 35, unavailable: 8.

Actual counts (observations): FAIL: 26, PASS: 194, UNAVAILABLE: 8.
