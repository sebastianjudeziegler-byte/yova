# Independent review of CI #414 live session evidence

Reviewed candidate `e3dfd97ef369a3593f2779e0160102dd1863aa0d`, [run 35254727222](https://github.com/sebastianjudeziegler-byte/yova/actions/runs/35254727222). The retained artifact is [session-launch-live-35254727222, ID 10513265939](https://github.com/sebastianjudeziegler-byte/yova/actions/runs/35254727222/artifacts/10513265939), 58,022,721 bytes, SHA-256 `f4a847a8c5c3e88c1114875aa1b3aa62562b88d7958b01a3d41745fcd7bfefbf`. It was extracted for inspection at `/private/tmp/yova-pr97-live414`.

This is CI development-preview evidence using real generated session content. It is not a production run or a claim about durable completion for authenticated accounts. The parent cancelled the remaining run after retaining the live artifact and pushing a diagnostic follow-up; these results describe this completed live step, not all gates for the candidate.

## Browser results and failures

`baseline-live-practice.json` reports **14 passed, 3 failed, 0 skipped, 0 flaky**, across 17 cases. The step started at `2026-09-17T17:52:44.785Z` and lasted 557.270 seconds. Each failing case has one recorded attempt.

| Case | Exact failed assertion | Retained HTTP evidence |
| --- | --- | --- |
| Mobile Practice Test: `baseline-practice-retry.live.spec.ts:109` | At line 117, `baseline-question` never appeared with `data-practice-round="practice_test"`; the 120-second locator wait expired. Total case time: 129.451 seconds. | Trace records `POST /api/sessions/shape`, action `practice`, round 1, `roundKind=practice_test`, target/cap 5, `workloadBounded=false`, no supplied key points. Response **502**, `code=generation_failed`, after **17.173 seconds**. |
| Mobile Interleaved Review: `baseline-practice-retry.live.spec.ts:128` | At line 141, `baseline-question` never appeared with `data-practice-round="interleaved_review"`; the 120-second locator wait expired. Total case time: 129.326 seconds. | Trace records action `practice`, round 1, `roundKind=interleaved_review`, target/cap 5, `workloadBounded=false`, four supplied key points. Response **502**, `code=generation_failed`, after **18.280 seconds**. |
| Desktop 32-question application workload: `baseline-session-quality.live.spec.ts:15` | At line 23, expected HTTP 200, received 502. Total case time: 46.860 seconds. | Trace records action `learn_block`, target/cap 32, `workloadBounded=true`. Response **502**, `code=generation_failed`, after **46.842 seconds**. |

Both mobile error contexts show the correct method label and the required routing rule had already passed its assertion. The visible session then showed “YOVA couldn't build this. Try again, or add material for this topic,” with **Try again** and **Exit and add material**. This is a failed content-generation request, not evidence that a mobile question element merely had the wrong locator or was below the fold. The artifact does not identify the internal provider/reviewer failure, so it does not prove a specific root cause or establish that the failure is inherently mobile-specific. Both corresponding desktop cases passed.

Other successful live cases include the two profile journeys and their comparison, outside-source return-to-practice on desktop and mobile, one- and two-point retries on both projects, the 6-question and 24-question workload checks, and the unchanged-versus-corrected osmosis comparison. The 24-question case passed in **39.132 seconds**; the 6-question case passed in **6.727 seconds**. Those timings are complete test durations, not learner study time.

## What the two profiles actually changed

Both journeys create a fresh preview learner through the UI, answer the onboarding questions, and start Study Now with the same goal: “Explain how photosynthesis converts light energy into chemical energy inside a leaf.” This test does not inject a fixed plan or override a workload in local storage. It uses separate live generations, so variations in the generated topic prose are not a controlled causal measure of personalization.

| Observed dimension | P1 | P2 |
| --- | --- | --- |
| Onboarding | 10–15 minutes; loses focus very often; concrete example; mapping; exact guidance; shorter sections and simpler instructions | 45–60 minutes; rarely loses focus; try first and feedback; explain back; learner choice |
| Method and order | Concept Mapping. Study → worked example → map → compare → optional repair → practice | Feynman Technique. Produce an explanation first → study → compare → optional repair → practice |
| Produce control | Named concepts, relationship endpoints and a relationship label; the screenshot shows a rendered directed link | Free-text explanation; the first produce screen has no generated tip yet |
| Method choice | Exact-guidance presentation | A visible change-method affordance before producing; locked afterward |
| Workload visible in the hub | **22 minutes, six practice questions** | **22 minutes, six practice questions** |

The profile rule IDs and displayed pills differ in the expected directions. P1 includes `L3.q5.concrete_example`, `L3.q6.map_it`, `L4.q2.minutes_10_15`, `L4.q3.very_often`, and the shorter/simpler-section rules. P2 includes `L3.q5.try_then_feedback`, `L3.q6.explain_back`, `L4.q2.minutes_45_60`, `L4.q3.rarely`, and learner choice. The hub records label their visible tips `origin=generated`, and the test asserts each shown tip references a fired rule.

The tips also visibly differ: P1's study tip is “Trace one example end to end”; its produce tip is “Say each step in plain words.” P2's study tip is “Follow one process from start to finish,” describing its produce-before-study sequence. This supports method, order, affordance and tip personalization.

It **does not establish workload personalization**. Both screenshots show 22:00 and six questions; both embedded `P1-generated-questions.json` and `P2-generated-questions.json` attachments contain exactly six questions, and both end screens show 6 of 6 correct in one round. P1's end tip says the session uses “a shorter workload allowance and a 22-minute estimate,” despite its 10–15-minute answer and the identical P2 workload. The contradictory P1 sizing/claim was sent to the planner owner for a red-first reproduction. No production cause is inferred here.

These tests stop on the end screen before clicking **Finish** and answer from the observed generated answer key. Their successful end screens prove traversal and generated-content handling, not learner mastery or a successful authenticated database save. The test clock is frozen, so 0:00 in the screenshots is expected and cannot measure time on task. The recordings take about 27–29 seconds because this is automation, not a realistic study-time trial.

## Recording integrity and visual inspection

All **12** retained `video.webm` files were decoded from start to finish with `/private/tmp/yova-video-tools/imageio_ffmpeg/binaries/ffmpeg-macos-aarch64-v7.1`, using `-nostdin -v error -i <video> -map 0:v:0 -f null -`. Every decode exited **0** with empty error output. These are the two profile recordings, two outside-source recordings, and eight practice/retry recordings. This proves decodability; it is not a claim that every frame received a visual review.

Representative screenshots inspected directly: P1 study, map produce and end; P2 initial produce, study and end; mobile Practice Test failure. They confirm the method/order/control differences and the identical 22-minute/six-question workloads described above. Relevant artifact directories begin `baseline-hub-profiles.live-ca51e-` (P1), `baseline-hub-profiles.live-e5718-` (P2), and `baseline-practice-retry.li-6e9d6-` (Practice Test). Per-step metadata is retained at `baseline-live-practice/hub-profiles/P1.json` and `P2.json`.

Passed profile cases retain screenshots, video, hub JSON and generated questions, but **no request trace**. Their generation request payloads and complete saved session metadata cannot be recovered from this artifact; that limitation was communicated to the planner owner. Failed cases do retain trace ZIPs, from which the HTTP status, request class and timing above were independently read.
