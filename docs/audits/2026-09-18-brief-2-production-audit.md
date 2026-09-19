# YOVA Brief 2 — production browser audit (18 Sept 2026, ~21:20–22:35 BST)

Tested as a learner on www.yovaapp.com in Sebastian's account, on deployed commit `843f7ee` (PR #97 / Brief 2 merged). Three learner profiles, five plan creations, two full practice sessions, one edit/undo cycle, one deadline change, one add-material, Study Now, Calendar Add. Test files: pasted class notes on cell transport (3 sections), `Unit6_Study_Guide.txt` (pure scope outline: "Unit 6 goals", vocab, exam format), `Carbon_Cycle_Notes.pdf` (7 sections that teach), `Nitrogen_Cycle_Notes.txt`.

State left behind: four saved test plans (2× "Cell Transport Test Preparation", "Ecology Unit 6 Test Preparation", "Periodic Table Quiz Preparation"); profile restored to the original answers; the account's daily planning allowance is exhausted (5th plan hit a 429).

Legend: **[B2]** Brief 2 requirement broken · **[BUG]** functional defect · **[GEN]** generated content is wrong/dumb · **[UI]** visual/interaction defect · **[COPY]** wording.

---

## 1. Verdict

Brief 2 did not ship the core claim. The plan is not "an ordered queue of learn and practice blocks shaped by the profile". Every plan I built, under every profile, with every kind of material (notes that teach, a scope-only study guide, a PDF, nothing), produced **practice-only queues**: every topic says "Teaching skipped; start with an independent practice check." There is no learn-with-source block, no learn-no-source block, and no block ever tells the learner to open their own material. Blocks named "Learn X" are closed-book quizzes. The profile changes block *count* and *length* but not *method*, and the scheduler puts most blocks after the deadline in every plan, including a plan whose deadline was nine minutes away. Editing is unreliable (Undo hung and did not survive reload) and the plan screen is unstyled native form controls. The two-profile contrast test fails on the brief's own criterion: "if two contrasting profiles get the same plan, Brief 2 failed" — they got the same *kind* of plan (all Active Recall, all practice, all after the deadline); only the numbers moved.

---

## 2. Brief 2 core failures (blocking)

1. **[B2][BUG] No learn blocks exist.** All 5 plans × all topics: "Teaching skipped; start with an independent practice check." Triggered regardless of: material classified as "Teaches the content" (pasted notes, PDF), study-guide-only topics (should take the no-source teaching path per Rule 1), topics with no source at all ("YOVA will teach this"), and whether "Already covered" was ticked. The edit-mode preview confirms it: every block is listed as `Practice: Learn Ecosystems…`.
2. **[B2][GEN] Blocks named "Learn …" are quizzes.** "Learn Ecosystems and Ecological Roles · Active Recall · ~48 min · ~32 questions" on a topic the learner has never been taught, sourced from a study guide that only lists goals. The learner is examined for 48 minutes on content nobody explained.
3. **[B2] Attached material is never pointed at.** Carbon topic with the PDF as source: block is still a closed-book quiz; the PDF is listed as a bullet and never opened, referenced, or assigned as reading. Same after attaching nitrogen notes to an active plan.
4. **[B2] Block length is fixed by profile, not computed from content.** 45–60 profile: every first block is 48 min / 32 questions whether the topic has 4 subtopics or 8; nitrogen and predator-prey got *two* 48-min/32-q blocks each (64 questions per topic). 10–15 profile: 8 or 11 min. After a deadline change the 60-min learner's blocks collapsed to 9–11 min / 5–7 q. No "dense topics get shorter blocks", no read-estimate + produce + compare.
5. **[B2] Fill-to-capacity is inverted.** 32 questions on a 5-bullet diffusion section is not "filling", it is padding: 8 questions took under 3 minutes with slow tooling, so 32 ≈ 10–12 min of real work under a 48:00 timer. Profile A: 5 questions, session complete at 4:40 of 8:00. The founder's bug ("40-minute timer, 5 easy questions") is now "48-minute timer, 32 easy questions". Timer still does not match work delivered.
6. **[B2] Method is not routed from Q6.** map_it → Active Recall. explain_back → Active Recall. solve_it → (plan failed on allowance, but the sessions before it) Active Recall. No Concept Mapping, Feynman or Practice Problems appeared at creation. Concept Mapping only appears when an edit regenerates blocks (and then it silently replaces the method).
7. **[B2] Two contrasting profiles → same plan shape.** A (10–15, very often) vs B (45–60, rarely) on identical notes: A = 4 blocks × 8–11 min Active Recall; B = 6 blocks × 48/11 min Active Recall. Different numbers, same method, same practice-only structure, same post-deadline spill. That is "different wording", which the brief explicitly says is a fail.
8. **[B2][BUG] Scheduler spills past the deadline in every plan.** 8-day test: 1 of 4 (A) and 2 of 6 (B) blocks after the test. 6-day test (ecology): 9 of 12 after the test, running to Oct 7. 3-day deadline (after edit): 10 of 10 after. Deadline in 9 minutes: 10 of 10 after, dated Sep 19 – Oct 2. Brief: "practice never lands after the deadline", "never a full queue marked after the deadline".
9. **[B2] First passes do not outrank returns near the deadline.** Profile B: "Active Transport and ATP" first pass on Sat 26 (after the Fri 25 test) while practice returns for diffusion/osmosis sit before it. Ecology: learn blocks for 4 of 6 topics after the test.
10. **[B2] No priority card.** Quiz "tonight at 10:27pm" (typed at 22:18): time ignored, "Test in 1 day · Fri 18 Sept", 10 blocks, full queue after deadline, personalization sentence literally says "the full queue remains available". Home unchanged. At least it did not throw.
11. **[B2] Q8 "starts late → first block within 24h" fails.** Profile A (often_delay, most days, evening): first block Tue 22 Sept, four days out; banner "Your next available window is more than 24 hours away" while Sat/Sun/Mon evenings exist. Profile B (on_time): first block Sun 20, nothing on Sat 19.
12. **[B2][BUG] "Most days" is hard-coded to Fri/Sat/Sun/Tue/Wed.** Visible in the edit panel's availability windows. No Monday, no Thursday, ever — which is why blocks skip Mon 21 in every plan and why a Thursday test gets fewer windows than the learner has.
13. **[B2] No feasibility check at setup.** Availability preview said "5 study windows available" for a 7-hour plan with 4×60-min windows before the test, and for a deadline in 9 minutes. Estimate step said "Roughly 15–15 blocks" (A) and delivered 4; "5–9" → 6; "9–18" → 12; "8–15" → 10.
14. **[B2][BUG] Source pre-selection on "What YOVA understood" is wrong.** With study guide + carbon PDF uploaded, all 6 topics were pre-assigned `Unit6_Study_Guide.txt`, including "Carbon movement through ecosystems" which the PDF teaches. Brief: YOVA pre-selects, learner confirms — the pre-selection would have sent every topic down the scope-outline path.
15. **[B2][GEN] Topic extraction is non-deterministic and invents scope.** Same pasted notes: run A found 4 topics including an invented "Comparing cell transport mechanisms" with subtopics like "Interpreting unfamiliar cell transport scenarios" (not in the notes); run B found 3. Material is supposed to be the scope.
16. **[B2][BUG] Undo does not hold.** Mark covered → Undo → button stuck on "Restoring…" for >60 s → reload → change still applied, Undo gone. Second test: date move then Undo restored the *method* change (the change before), left the date in the UI, and after reload the date was back to the old value. UI, undo stack and server disagree.
17. **[B2][BUG] Receipts lie.** "Practice Ecosystems and ecological roles: you learned it elsewhere; everything else unchanged." — in fact the block was renamed, method switched Active Recall → Concept Mapping, 48 → 26 min, 32 → 17 q, date moved to Sun 4 Oct (10 days after the test), and post-deadline banners went from 5 to 10. Method change receipt: "Change selected study blocks; everything else unchanged." (generic).
18. **[B2][BUG] Changing the deadline rewrites the whole plan.** Deadline Thu 24 → Mon 21: preview changed every block to Concept Mapping, renamed them "Map …", produced duplicate names inside a topic ("Map Food Chains and Food Webs" ×2), and left every date Sep 22 – Oct 6. After confirm: 0 of 10 blocks before the deadline; header "Test in 4 days" (it was 3) and "12 blocks" (10 remained). Brief: deadline change re-spaces remaining practice only.
19. **[B2] "Already covered" has no visible effect** because every topic is already "teaching skipped". Ticking it on Food chains produced an identical 2-block practice topic.
20. **[B2] Personalization sentence is a canned paragraph, not rules that fired.** Profile A got nine stitched sentences ("Dense topics stop at three learning blocks, with every subtopic retained. Your session-length answer sets a 11-minute ceiling and topic-sized blocks. Shorter blocks are separated across days to protect focus. Each block has a proposed date and a clear next action. There is at most one learning block per day. Practice gives extra attention to precise recall. The first block is short and proposed at the next available opportunity. Shorter sections reduce the amount in each sitting. The next block stays prominent and the rest of the queue is collapsed."). "Dense topics stop at three learning blocks" appears on a plan with zero learning blocks. "a 11-minute", "a 8-minute". None of it is written as "because you said…".
21. **[B2] Home personalization is driven by the legacy questionnaire.** "Personalized today: Big picture first · One step at a time · Smaller steps" = `big_picture`, `one_step`, `smaller_steps` from the old 11-question section, unchanged after every profile flip.
22. **[B2][GEN] The §8 bug is live in an existing plan.** "Biology Unit 6 Test Preparation" (created earlier from a study guide) has topics "Unit 6 test scope", "Unit 6 concept explanations", "Unit 6 representations and evidence", "Unit 6 question application", "Cumulative test readiness" and a first block "Map the Unit 6 Test Scope · Trace–Code–Test · ~8 min · ~4 questions". The document became the subject, with a coding method label on a biology test.
23. **[B2][GEN] Document-referential questions (Rule 2).** Profile A session, 3 of 5: "Which factor *from the notes* would make a substance diffuse faster…", "Which correction best *fits the notes*?", "Which transport route *matches the notes*?"
24. **[B2][BUG] Placement check fails.** "Start placement check" spun ~40 s ("sampling prerequisite and central topics from your knowledge map") then "The placement check is unavailable right now… YOVA could not prepare the placement check yet." No retry.
25. **[B2][BUG] Study Now ("Just study something now") is down.** "Help me understand osmosis" → "YOVA could not map this learning goal yet. Try again in a moment. Your information is safe." twice. Network: POST /api/plans/generate 503 (×2), POST /api/errors 503, POST /api/events 503.
26. **[BUG] Daily planning allowance hit on the 5th plan** (`generate?mode=understanding` → 429). Copy on the topic-map step: "This account has reached its planning allowance. Skip the placement check or return after the allowance resets." (wrong step named). "Skip for now" skips the entire "What YOVA understood" screen and goes to availability; building then fails with the generic "Your information is safe. YOVA could not map this learning goal yet. Try again in a moment." with a Try again button that will keep failing. `/api/errors` itself returns 503, so client errors are not being recorded.
27. **[B2] Q4 exact_guidance vs learner_choice difference is cosmetic.** exact → sentence "Each block has a proposed date and a clear next action"; learner_choice → "you choose its dates" plus a label "Choose a day" with no control on the preview. In the session, learner_choice shows the pill "you asked to decide" and no chooser.
28. **[B2] Q1 energy only sets the availability default** (evening → 7:00 PM slots, morning → 9:00 AM). No learn-in-peak / practice-off-peak split, because there are no learn blocks to split.
29. **[B2] Q3 "never two blocks back to back" is untestable/unhelpful:** with very_often the plan simply spreads one block per day and skips days it has windows for.
30. **[B2] Q5 concrete_example → nothing visible** (no "topics with worked examples first" note anywhere).
31. **[B2] Q9 frequent_check_ins** could not be verified (allowance) — no sentence for it appeared in any personalization text seen.
32. **[B2] Dates are shown with two conflicting values in one row:** "Suggested: Sun 4 Oct" beside a date input reading 09/20/2026 (and later "Suggested: Fri 2 Oct" beside 10/02, "Suggested: Sat 3 Oct" beside 10/06).
33. **[B2][BUG] "Start next block" → "YOU ARE AHEAD OF SCHEDULE" modal on the very first session** (planned Tue 22, 7:00 PM) with three choices. Its recommended primary action "Start and adjust calendar" errors: "Choose a time on or before this goal's deadline." Brief: dates are suggestions that slip; the deadline must never throw.
34. **[B2] Exiting a session mid-way leaves no trace on the plan** ("0 done", same Start next block, same AHEAD modal); resume works and keeps the timer but skips the pre-session card.
35. **[B2] Plan count excludes practice because there is none:** "5 blocks · 0 done", "4 blocks", "6 blocks" — and the count goes stale after edits ("12 blocks" with 10 present).
36. **[B2] Ordering:** date order is not monotonic with queue order (Sep 23 then Sep 22), and after edits the same topic's two blocks share a name.
37. **[B2] No topic checkmark, no topic note ("split into 2 blocks — 5 subtopics"), no drag-to-reorder, no X-to-remove** on the plan screen. Q10 collapse ("3 more topics") is the one plan-screen rule that visibly works.

---

## 3. Profile answer → plan effect (what actually happened)

| Q | Answer flipped | Visible plan effect |
|---|---|---|
| Q1 energy | evening / morning / afternoon | Only changes the recommended availability slot (7 PM / 9 AM). No learn-vs-practice placement. |
| Q2 length | 10–15 / 45–60 / 20–30 | Changes ceiling sentence and block minutes (11 / 60 / 25) and question counts. Works, but sizes are fixed per profile, not computed. |
| Q3 focus | very often / rarely / often | One sentence ("separated across days"). No observable schedule difference beyond skipping days. |
| Q4 guidance | exact / learner choice / flexibility | Sentence only; "Choose a day" label without a control; no session chooser. |
| Q5 difficulty | step-by-step / concrete example | step-by-step → "at most one learning block per day" (on a plan with no learning blocks). concrete example → nothing. |
| Q6 prove | map it / explain back / solve it | Nothing. Always Active Recall. |
| Q7 gist/detail | gist / detail | Sentence changes ("precise recall" vs "relationships and comparisons"); question-type mix claimed in "Why this session ran". |
| Q8 starting | often delay / on time / deadline pressure | Sentence changes; first block is not within 24 h in any case. |
| Q9 support | shorter sections / no extra support / frequent check-ins | shorter sections → sentence + smaller blocks; others → nothing seen. |
| Q10 extra | long plans shut down / forget during tests | Collapse works; extra practice block per topic works. The two rules that actually change the plan. |

---

## 4. Plan setup flow — UI / copy / behaviour

38. **[UI]** Step 2 is not the materials step; it is a mode chooser: "Where should the learning come from? Pick one starting mode. YOVA will use the same choice throughout the plan" (Use my materials / Create it for me / Guide me outside YOVA). Contradicts per-topic sources. "Nothing to upload? Skip — YOVA will build this from what it knows" duplicates "Create it for me" and stays visible even after "Create it for me" is selected.
39. **[UI]** Upload accepts PPTX/PDF/TXT/MD only — no DOCX (brief lists DOCX).
40. **[UI]** Goal step: "A test / An assignment / My own goal" render as plain grey text with no default even when the sentence says "test"; selected state is a faint grey pill.
41. **[UI]** Goal step has an empty band between two horizontal rules above Cancel/Continue.
42. **[UI]** Every step opens mid-scroll (header cut off); the plan page opens scrolled to the bottom.
43. **[UI]** Flow logo (star icon) differs from app logo ("Y" square).
44. **[UI]** Material chip says "Ready · Text read and ready" (redundant) and gives no summary ("32 slides"); on the understanding screen the summary is "1 section read".
45. **[UI][BUG]** While uploading two files only the second file's status line ("Carbon_Cycle_Notes.pdf · Uploading") was visible; the first file's chip appeared only after both finished.
46. **[BUG]** A plain text-only PDF failed the "private text reader" and fell back to AI reading; the warning ("YOVA used AI to read this PDF after the private text reader could not finish. Review the generated plan against the original document before relying on it.") is loose text at the bottom of the step, not on the chip.
47. **[UI]** "What YOVA understood": the Study guide / Notes or slides toggle renders as two overlapping wrapped words ("StudyNotes / guide or / slides") with no selected state — the most important screen's most important control is broken.
48. **[UI]** Topics are a numbered `<ol>` with native `<select>`s labelled "Source for <full topic title>", a checkbox labelled "Already covered: <full topic title>", and "↑ ↓ Remove" text buttons. No drag, no X, no card.
49. **[UI]** Added topic renders as "Predator-prey cyclesSource for Predator-prey cycles" (title glued to the next label), no subtopics.
50. **[COPY]** "Roughly 15–15 blocks, including learning and practice."
51. **[COPY]** Availability preview: "YOVA recommends most days in 15-minute blocks because evening is when you reported having the most usable energy." Non-sequitur, repeated with 60/25.
52. **[UI]** Custom timetable: green check circle overlaps the day name; "Specific time (optional)" label wraps into and under the duration select; native `--:-- --` time input; Friday (today, 22:20) is pre-selected with "Afternoon".
53. **[UI]** No-materials path shows the same "What YOVA understood" screen with "Source: YOVA will teach this" selects that have one option, rather than a lightweight proposed-topics screen.
54. **[UI]** Placement offer layout: "Back" sits alone under the two main buttons.
55. **[UI]** "Building your plan…" step list ("Reviewing your goal / Identifying the starting approach / Sequencing teaching and practice") — 20–40 s, then a plan with no teaching.
56. **[UI]** Plan preview shows "Add material" and "Edit plan" buttons on a plan that does not exist yet ("Nothing is active until you save this plan").
57. **[BUG]** Two plans can be saved with the identical name ("Cell Transport Test Preparation" ×2); no disambiguation anywhere.
58. **[COPY]** "Test in 8 days · Fri 25 Sept" on 18 Sept (7 days); "Test in 4 days · Mon 21 Sept" (3 days); "Test in 1 day" for tonight.

---

## 5. Plan screen — UI / copy

59. **[UI]** Opening a plan keeps the Learning page header ("What you're working toward", giant "New plan" button, Active/Recent/Archive/Methods tabs) above it, then a full-width "Archive plan" button before the plan itself.
60. **[UI]** Topic rows are native `<details>` disclosure triangles. Expanded content is raw: "1. Learn Ecosystems and Ecological Roles", "Method for Learn Ecosystems and Ecological Roles [select]", "Choose a dayMove Learn Ecosystems and Ecological Roles [date 09/20/2026]" (labels glued, wrapping mid-sentence), "Topic actions for Ecosystems and ecological roles [Choose an action]".
61. **[UI]** Date inputs are US format (09/20/2026) for a UK learner; everywhere else dates read "Sun 4 Oct".
62. **[UI]** Up to 10 stacked yellow warning boxes ("…availability or prerequisites put this suggestion after the deadline; move it or change availability." / "the reviewed date falls after the deadline") above the Start button.
63. **[UI]** Receipt + Undo for topic actions renders at the very top of the page above the app header; the learner acting on a topic halfway down never sees it. Receipt for attach-material renders at the bottom instead. Inconsistent.
64. **[UI][BUG]** "Edit plan" appears to do nothing: the edit panel is appended at the bottom of the page below all topics, no scroll, no modal. Same for "Add material".
65. **[UI]** Edit panel is raw: "Day for window 1[Friday]Time for Friday[Morning]Minutes for Friday[60]", "Remove window 1", "Add study window", topics as "1. Ecosystems and ecological roles ↑ ↓ / Remove Ecosystems and ecological roles".
66. **[UI]** Preview "Before/After" lists show raw ISO timestamps to the learner ("2026-10-03T08:00:00+00:00" in Before, "2026-09-22T08:48:00.000Z" in After — two formats).
67. **[UI]** Removing a topic is labelled "Include Remove future work on Predator-prey cycles" with a "Target topic" dropdown and method/time editors for the blocks being deleted.
68. **[UI]** Method dropdown in the preview lists all 12 catalog methods (SQ3R, Pretesting, Trace–Code–Test, Practice Tests…) while plan rows offer only Active Recall / Concept Mapping; existing Unit 6 plan shows "Trace–Code–Test" as a label that its own dropdown cannot select; its first topic has no method dropdown at all.
69. **[UI]** "Add material" form = generic "Add another change" builder: "Change type [I already learned this / Attach a source / Add a topic / Remove future work / Move a topic / Change the deadline / Change available time]", "Change topic [Whole plan]", "Source URL", native "Choose File". No "which topic?" pre-fill.
70. **[UI]** Every inline action greys the whole plan for 10–20 s with no progress indicator.
71. **[COPY]** "Learning source — Created by YOVA. Teaching and practice for this goal. Attach a source to a topic to plan time for it; completed work stays saved." on a plan built from uploaded files; "Study resources — Nothing extra to browse yet".
72. **[COPY]** Personalization banner: "Your next available window is more than 24 hours away, so the first block uses that opportunity." (false); "With the deadline close, first passes stay ahead of return practice; the full queue remains available."

---

## 6. Sessions — behaviour, questions, copy

73. **[UI]** Pre-session card: "I've already covered this — The block becomes practice. Your report is not proof." shown on a block that is already practice. "Your report is not proof" is condescending.
74. **[COPY]** "Because you asked for shorter sections, this block uses a 8-minute estimate and a smaller workload." ("a 8"); the same sentence is shown on the completion screen under "WHAT'S NEXT … Practice block · 11 min" (11 ≠ 8).
75. **[UI]** Hub shows internal labels: "SHAPE C · CLOSED-BOOK PRACTICE"; 7–8 "CHOSEN BECAUSE" pills ("you asked to decide", "recall comes before review", "a missed point needs another try", "this is a conceptual topic") none of which explain why Active Recall over the method the learner chose in Q6.
76. **[BUG]** Timer starts and runs during "Writing your questions…" (10–20 s, twice per session) and keeps RUNNING on the "Session complete" screen.
77. **[UI]** Round 2 header regresses to "STEP 1 OF 3"; "1 point still to pass."; "5 of 6 correct · 2 rounds, checked in code".
78. **[COPY]** "Why this session ran this way" = 13 "Because…" lines; four of them restate the 8-minute estimate with different justifications; "YOVA applied the method without a chooser"; "YOVA recorded every decision behind this session, which ran Active Recall."
79. **[GEN]** Question quality (Profile A, 5 q): Q1 "A dye spreads through water without any energy input. What direction does the net movement follow?" with distractors "Only through carrier proteins" / "Only when ATP is available"; Q3's correct option is the longest by far; correct answer was A in 4 of 5; repair question stem gives the answer away ("one is kept warmer than the other. Which change would increase the rate?" → "Higher temperature").
80. **[GEN]** Profile B, 32 q: Q1 is the same dye question; Q2 says "amount of particle crowding" instead of concentration; Q2/Q6/Q7 are all "which factor changes the rate"; Q5 and Q8 are osmosis questions inside the Diffusion block while an Osmosis block follows two days later (topic bleed = the same content will be asked twice).
81. **[GEN]** Repair round ("Error Repair round · Recall question") is labelled as a different round type from the hub ("Closed-book round 2").
82. **[B2]** Finish → Home worked on double-click (no spin). Good.
83. **[UI]** Session hub is desktop-width content in a mobile-width column: tip card, timer card, shape card, target card, source card stacked under every question; the question itself is the 4th card down.

---

## 7. Elsewhere in the app

### Home
84. **[BUG]** "UP NEXT · THU 9:00 AM" is *last* Thursday (Sep 17) — an overdue block from a plan whose test was tonight at 11:59 PM — shown with no overdue label and read as next week. Learning tab shows the same block as "NEXT SESSION Thu 9:00 AM".
85. **[GEN]** That card: "Practice · Concept Mapping · 25 minutes · WHY THIS: … It also provides the example-led, step-by-step start you requested before working independently." on a practice block.
86. **[BUG]** Up-next carousel "1 of 17" → "1 of 21" as junk plans accumulate; old/junk plans ("Teach Me About Github", "Learn About Tech Literacy As a Non Technnical Ceo", "Learning About Tech Literacy for My Startup As a Non Technical Ceo", "Reading Internaitonal Relations Chapter 2", "Need to Fully Understand Whats Going on in This Research Paper") are all active and feed Home, Calendar and week totals. Brief: pre-Brief-2 plans are refused/deleted.
87. **[BUG]** "Your week — FRI · TODAY: Map the Purposes of Cell Division 140 min · 7 sessions" vs the Today list (3 sessions, ~65 min) vs that plan's own "0 of 2 sessions". Three different counts.
88. **[BUG]** Home "Today" list and Calendar "Your day" ignore all four plans created today; a quiz "tonight" never appears.
89. **[UI]** Today rows show "AM" with no time; "2 topics + 2 practice checks + about 25 min".
90. **[COPY]** Week subtitle lower-cased: "ap biology test on cellular respiration in 7 days".
91. **[COPY]** Weekly review: "3 completed · 4m studied. Starting and continuation: 2 recent sessions ended early (self-report and behavior agree). Next suggestion: Use short active rounds and change the activity only at planned checkpoints while keeping the same objective."
92. **[UI]** "Where you stand" shows two random 0% plans (Melatonin, Vibe Coding).
93. **[UI]** Plan list subtitles "Teaching first · Fri 12:15 PM", "Practice first · Sat 3:07 PM" look like creation timestamps; user typos are Title-Cased into permanent titles ("Whats", "Technnical").
94. **[UI]** Milestone card "SAT · DEC 5 Public Speaking — plan adjusts as sessions complete".
95. **[UI]** "Add plan — Notes, syllabus, link" and "Study now — Quick, off-plan" cards duplicate the header Add button.

### Learning tab
96. **[BUG]** "Active 8" (then 9, 10, 11) here vs "17 active" on Home.
97. **[BUG]** "Photosynthesis Test Preparation — TEST SEP 18 — 0 of 2 sessions complete — NEXT SESSION Thu 9:00 AM" (yesterday's date as the next session, for a test that ends tonight).
98. **[BUG]** Mitosis plan: "NEXT SESSION Fri 12:00 PM · 10 min" (already passed today) with no overdue state.

### Calendar
99. **[COPY]** "21 open blocks · 8 upcoming outcomes · manual changes stay under your control." / "Manual items stay on this device; learning plans and deadlines keep their existing sync." / "Adjust today's available time — Opt in, review the safe change, then approve it."
100. **[UI]** Stale "A SESSION IS STILL WAITING" card from an old Melatonin plan ("YOVA will preserve the unfinished content whichever option you choose. What got in the way? OPTIONAL Ran out of time / Interrupted / …").
101. **[UI]** "NEXT UP — Your order of business" lists ~10 OVERDUE items from junk plans.
102. **[UI]** Two items at 9:00 AM today (overlap); "Your day: 7 open".
103. **[GEN]** Natural-language add produced an event titled the whole sentence with typos: "Commmunications Class Every Mondey And Wednseday · 5:30 PM · Class", alongside "Communications Class 11:00 AM".
104. **[UI]** Jump-to-date shows the week start (09/14/2026, US format), not today; "QUICK ADD … ⌘K" keyboard hint in a mobile layout.
105. Calendar → Add → inline event form with "Start a learning plan instead" matches the brief (good).

### You (profile)
106. **[BUG]** Two questionnaires on one page: "Ten answers that change how sessions run" and, below it, "Review or change the 11 optional questions" (badged "Migrated from existing answers") — session length, energy and starting pattern are asked twice and can hold different answers; Home reads the legacy one.
107. **[COPY]** Developer notes under every question: "Layer 4: timer one band down and more stopping points when often or very often.", "Layer 5: whether the method choice is silent, visible, or offered.", "Layer 3: the Shape A produce step.", "Nothing in v1. Retained as signal for stage-aware behaviour in v2.", "Layer 4: delivery modifiers (timer, question cap, produce step, instruction style, stopping points).", "Cannot make an ineligible method valid or weaken the learning target.", "A self-report never overrides eligibility, observed outcomes, or a committed route."
108. **[COPY]** Page intro: "Keep one optional study profile, inspect comparable method evidence, and correct either whenever context is missing." / "Your profile is a changeable preference record, not a brain type."
109. **[UI]** No save confirmation when answers change; Q6 (prove) and Q7 (gist/detail) were "Not answered" on the founder's own account, i.e. onboarding did not capture them.
110. **[COPY]** "Because you asked for step-by-step instructions, YOVA held the scaffolding one level higher and numbered the steps."

### Global
111. **[BUG]** URL never changes (always `/`): no deep links, browser back leaves the app, refresh always lands on Home.
112. **[BUG]** Console: "Error: Access to storage is not allowed from this context." on every page load.
113. **[BUG]** `/api/errors` returns 503 — the client error reporter is itself failing.
114. **[UI]** Bottom nav tap occasionally needs a second tap (nav click during route transition is swallowed).

---

## 8. What worked

- Date parsing from the goal sentence ("next Friday" → Fri 25 Sept; "Thursday 24th" → Thu 24 Sept).
- Add on Home opens the plan flow with the two links; Add on Calendar opens the event form with "Start a learning plan instead".
- Placement offer never auto-opens; Start / Skip present.
- Q10 long_plan_shutdown collapses the queue ("3 more topics"); forget_during_tests adds a practice block per topic.
- Corrections on "What YOVA understood" (source change, already-covered, remove, add topic) apply on Continue and the block estimate updates.
- Practice delivered in parts ("PART 1 OF 4 · QUESTION 1 OF 8"), repair round only on missed items, immediate feedback per question, Finish returns without spinning, session resume after exit keeps position and timer.
- Topic extraction from a real study guide produced real topics (not meta-topics) this time.
