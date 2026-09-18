# Live deployed-session audit — evidence notes

Date: 17 September 2026. Target: https://www.yovaapp.com/. Exact deployed source: b75ec8d3da25695e6b008aa3e5f82855d415298e (see deployment-verification.md).

Test identity: existing signed-in release-test account, display name Plan Learner, address beginning `yova-plan-release-`. Not the founder's personal account. Existing plans left in place; new Study Now sessions created for this audit. Profile settings changed deliberately to test contrasting journeys on the same account. Thus this is not a clean comparison between newly created accounts.

## A — Biology novice, concept mapping

Profile: morning; 10–15 minutes; loses focus often; exact guidance; concrete example first; proves knowledge by mapping; gist learner; short sections and simpler instructions; long plans overwhelming. Starting pattern retained as delays starting (no v1 effect).

Exact Study Now prompt: “A-level biology: understand how diffusion, osmosis and active transport differ, and predict what happens to animal and plant cells in dilute and concentrated solutions. I am revising for an exam and need to apply these ideas, not just define the terms.” Inside YOVA, no uploaded materials.

Pre-session: topic “Membranes, concentration gradients and water potential”; Concept Mapping selected from profile; card says 25 min. Sidebar after start: 11-minute timer (short band + focus/support rules), Shape A, steps 4/4/1/2 minutes. These are different advertised time values. Plan generation/splitting is out of this audit's verdict, but learner-visible session time mismatch is recorded.

Teaching: a short paragraph + five key points covering permeability, concentration gradient, osmosis direction, water availability and dynamic equilibrium. Continue then displays a separate worked example “Plant cell in sugar solution,” four simple steps. Therefore example-first support really appears, not just a label. Continue hides the source and opens map inputs.

Map UI: 3 concept text fields, plus a separate From / label / To row, Add concept and Add link. No visual graph. The instruction is “Task: map the concepts and links, without looking at the material.” Tip: “Say each step in plain words / Plain language keeps the chain of ideas visible while you explain it.” This tip does not name the current topic.

**Live reproduction: lost draft.** Entered concepts `partially permeable membrane`, `osmosis`, `water potential`; link `osmosis` / `moves water down a gradient of` / `water potential`. All six values were visibly present. Clicked Exit session → opened new plan on Home → Start next session. Returned directly to Produce, source still hidden and timer retained at 1:20, but all six text fields blank. No warning before exit. Screenshot was captured before exit in the tool conversation. Initial narrow viewport; subsequent audit switched to 1440×1000 because the shipped desktop hub and explicitly undesigned mobile layout must be distinguished.

After resume, deliberately entered a common misconception: `osmosis` / `moves water from low to high` / `water potential`, alongside concepts osmosis, water potential, partially permeable membrane. Submitted for comparison.

Comparison correctly identified the reversed direction, quoted the submitted link, named missing concepts, and explicitly said “Feedback, not a verdict. Nothing here changes the topic's status.” This is useful, specific feedback.

**Live reproduction: unchecked repair.** On Repair, submitted “Water moves from low to high water potential by osmosis.” (deliberately repeats the exact misconception). Save repair immediately showed Session complete, with the earlier 5 missing / 1 to correct count and no new feedback. No correctness claim was made, but the learning loop never checked whether correction succeeded.

At end: “Nothing else queued in this plan”; no next practice/check offered. Tip claimed “Because you lose focus often, the timer dropped one band and stopping points were added.” Timer did change; additional stopping points were not identifiable from this run.

**Save failure:** First Finish click displayed Saving, then “YOVA could not save this session. Your work is still on screen; try again.” Console: `YOVA session completion sync failed [client:deadline]`, timestamp 2026-09-17T12:21:16.141Z. Retried once. This was real production, no network interception or simulated errors.

Second Finish also failed. Exiting showed a cloud-sync warning and the plan at 0/1 complete. Reload recovered the signed-in account and new plan/profile, still with no recorded completion. A separate read-only Supabase auth-health request returned HTTP 200. This does not establish that the completion RPC was healthy or isolate a root cause.

## B — Confident biology learner, long Active Recall

Same exact broad Study Now prompt as A, new session, same account. Changed profile to 45–60 minutes, rarely loses focus, recommends options/learner decides, trying first with feedback, proves knowledge by answering questions, detail learner who loses connections, no extra support, nothing else. Morning and starting-delay answers unchanged. This is a controlled profile change at the goal level, but not an identical topic/source trial: generated first topic was “Diffusion, osmosis and active transport,” not A's membrane-foundations topic.

Pre-session selected Active Recall and said: “Because you said trying first helps most, you produced before studying and then compared.” Already-covered remained OFF. Session visibly began with READ THE EXPLANATION and a short paragraph (about 90 words) plus five key points. No answering/produce step preceded it. Sidebar: **55-minute timer**, **20 MIN read**, **25 MIN closed-book round**, **10 MIN review**. Tip said “Start by answering first” on the read-only explanation screen. Screenshot captured in tool conversation at timer 0:50.

The five MCQs were:

1. Recall: dye spreading through still water; why diffusion rather than active transport? Correct: crowded to less crowded without energy. Deliberately chose low→high using energy. Immediate feedback was accurate.
2. Application: plant vacuole fills in pure water; identify water crossing partially permeable membrane from dilute to concentrated. Correct.
3. Compare: passive versus active energy/direction. Correct.
4. Compare: membrane-free diffusion versus water-specific osmosis. Correct.
5. Misconception: why not all membrane transport is passive. Correct: active transport uses energy against gradient.

All use four visible answer choices. Several distractors are plainly wrong (osmosis not involving movement; active transport only for water; diffusion only in living cells). This is genuine question-type mix, but modest intellectual demand for the stated A-level application goal. No quantitative data, unfamiliar multi-step experiment, or free retrieval in this round. 4/5 correct with one deliberate error.

Round 1 review said “1 point still to pass,” round 2 covers only misses. Clicked Start round 2. Sidebar still allocates 25 MIN to closed-book round 2 even though only one key point remains.

Round 2 successfully generated exactly ONE Error Repair question: smell spreading through still air, identify high→low without energy. This changed the example but tested essentially the same rule as the missed dye question. Correct answer completed the session at displayed **5:23 / 55:00**, including UI inspection and model-generation waits. This is an automated audit time, not a measured human learning time. End receipt correctly counted 5/6 correct across two rounds, but repeated the false “you produced before studying and then compared” claim. No further work was offered except another topic/plan. End tip: “Let the timer run / Because you said long sessions are realistic, the timer started at fifty-five minutes.”

Screenshot taken later at 7:35 while already on completed screen (the counter continues on the end screen); Finish submitted. Native page-export capability was unavailable, so screenshots remain in the tool conversation rather than downloadable evidence files.

**B save also failed**, with the same visible failure message and cloud warning on exit. This is a second distinct session with an unconfirmed completion, not just repeated clicking on A.

## C — Mathematics learner, attempt before explanation

Profile: B except 20–30 minute preference and “Working through a problem.” Exact prompt: “A-level mathematics: practise differentiating products using the product rule. I already know the power rule and basic derivatives of sin x and cos x. Give me exam-style problems involving a polynomial multiplied by a trigonometric function, and help me avoid forgetting one of the two terms.”

Generated first topic “Recognising and setting up the product rule,” classified conceptual and offered Feynman Technique; method alternatives were Concept Mapping and Active Recall. The mismatch between requested procedural practice and conceptual first topic is recorded as legacy planning behavior, not charged as missing Brief 2. We continued the actual resulting Feynman journey.

Try-first worked here: blank explanation input appeared before teaching, with a 25-minute timer and Produce→Study→Compare→Repair rail. Header's generic method instructions still said study an explanation first, but the actual step order honored the preference.

Submitted a plausible error: “For y = x² sin x, I differentiate each factor and multiply the derivatives: dy/dx = 2x cos x. A product has two functions changing, so multiplying their rates of change gives the rate of change of the product.” Then a relevant short product-rule explanation and five key points appeared, including u′v + uv′.

Generated tip: “Trace one product start to finish / You come back with the right terms in the wrong order, so follow a single product through before you look at anything else.” This diagnosis does not describe the submitted error (multiplying derivatives, not incorrect ordering) and is more specific than the selected detail-oriented preference warrants.

Comparison correctly identified product-of-derivatives versus the required two-term sum. Repair submitted the correct worked derivative, 2x sin x + x² cos x, with u/v and a reason for two terms. It advanced immediately without assessing the correction. End still showed original “5 missing · 2 to correct.” No retrieval questions occurred in C, yet the repair tip said “practice asked one more question comparing two ideas.” This is another live false personalization claim, not merely awkward wording. End reached at displayed 2:00/25:00 (automated timing). Finish attempted once.

**C saved successfully.** Returned Home, then Learning→Recent showed mathematics “1 of 1 sessions complete” and “Goal completed.” A and B still showed 0/1 in that same list. Thus persistence failure is intermittent/session-specific in this audit, not a claim that every completion fails. A/B root cause remains unknown.

## D — Short, source-based outside study

Profile: 10–15 minutes, rare focus loss, choose among recommendations, simple explanation first, answering questions, gist learner, no extra support. Uploaded the accompanying synthetic `source-photosynthesis.txt` (revision notes, not private user content). Selected Outside YOVA.

Exact prompt: “GCSE biology: I will study these notes outside YOVA, then test whether I can identify limiting factors of photosynthesis from experimental results. Focus on explaining a plateau and interpreting what happens when light or carbon dioxide changes.”

Upload reported “Securely stored · ready for this session.” First generated topic was Photosynthesis rate foundations. Directions named the uploaded file and specific contents (chlorophyll, reactants/products, chemical energy), then requested closed-book questions after return. This was direction→I'm back→questions; no unnecessary map/produce stage or substitute generated lesson. The requested limiting-factor application was not in the first-topic question set; attribute first-topic selection/goal coverage to legacy planning and retest after Brief 2.

Timer: 15 minutes. External-study directions suggested 15 minutes, while the rail assigned 5 minutes to study + 7 questions + 3 review. The same screen therefore gives inconsistent time guidance.

Round 1 had five questions, with actual type mix 2 recall / 1 application / 1 comparison / 1 misconception (contrasts with B's 1/1/2/1). Topics: chlorophyll captures light; CO₂ + water as inputs; increased glucose and oxygen as higher photosynthesis rate; pigment vs chemical-energy storage; CO₂ is a reactant rather than product. All were grounded in the supplied notes, no “according to the document” questions. All five correct answers were in the first position. B had varied answer positions, so this is one observed all-first pattern, not a claimed rate across YOVA. Source code has no deterministic shuffle.

Answered all correctly. One clean round ended at displayed 3:46/15:00 (automated audit, outside reading time not a learner-duration study). Receipt accurately said 5/5, 1 round. No extra rounds forced after success. Short profile did NOT reduce the five-question count versus B; the route's short-session cap is itself five, so that observation is compliant.

Timer controls passed: Pause→+5→Hide→Show preserved 3:57 elapsed, displayed 20-minute nudge and PAUSED, with Resume available. Finish clicked while paused.

**D save failed**, then failed again after one retry. Initial error logged at 2026-09-17T12:50:55.690Z as `YOVA session completion sync failed [client:deadline]`. Exiting showed cloud-sync warning and D still appeared as an available unfinished session. A browser approval timeout affected one later read, was retried as allowed and succeeded; that tool timeout is not counted as an app defect.

## Cleanup / retained evidence

Restored original baseline profile values through the UI: evening, 45–60 minutes, sometimes loses focus, clear structure with flexibility, concrete example first, proof preference unanswered, gist/detail unanswered, delays beginning, no extra support, extra context unanswered. The older eleven-question profile was not edited. New audit plans and uploaded synthetic notes retained; no user data deleted.

**Final reload verification:** account recovered. Learning→Recent showed A 0/1, B 0/1, C 1/1 completed, D 0/1. Restored select values were verified from the visible You profile after reload. Temporary viewport override reset. The original test data and four newly created audit plans remain available; no application fixes were made.
