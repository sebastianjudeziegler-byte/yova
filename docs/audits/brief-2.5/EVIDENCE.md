# Brief 2.5 - Plan model repair: evidence

Branch `plan-model-repair`, base main 843f7ee.

> The acceptance audit is `docs/audits/2026-09-18-brief-2-production-audit.md`
> (843f7ee, 18 Sept, 114 findings). The per-root-cause sections below were
> written before it was available and cite the brief's finding numbers; where
> those differ from the audit, the **finding map at the end of this file is
> authoritative** (corrections listed there).

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

## Root cause 2 - The scheduler places blocks after the deadline (findings 8-13, 32, 36, 62, 72)

**Causes found.**
1. `topic-plan-model.ts` searched availability with the deadline removed
   (`{...request, deadline: null}`), a year ahead, and only appended "...puts
   this suggestion after the deadline" to the plan (8, 9). The plan rubric
   exempted topic plans from "no work after the deadline" if that note was
   present, and five tests asserted the note - so CI blessed the bug.
2. "Most days" enabled positions 0,1,2,4,5 of the next seven days
   (`frequencyIndexes`), so a Friday start silently dropped Monday and
   Thursday: Fri/Sat/Sun/Tue/Wed (12). The Q8 banner "next available window is
   more than 24 hours away" (11) follows from the missing days.
3. Priority card (10): `buildDeadlinePriority` returned `null` when there was
   **no** window before the deadline. The five browser cases all put a short
   window before the deadline, so they passed; a deadline minutes away with
   evening-only availability returned no card and the plan was built from
   windows after the test. This is the path production took *by inference* -
   the audit file is needed to confirm the exact inputs.

**Fix.**
- Slots are searched only up to the deadline, and the validator now fails any
  block that ends after it (`a block ends after the deadline`).
- Fitting ladder when the work does not fit: (0) normal spacing; (1) learning
  blocks not spread one per day; (2) practice returns sooner; (3) shorter
  blocks, two per window, never under 15 minutes; then extra practice rounds -
  and, with the deadline within 3 days, first practice (first passes outrank
  returns) - are left out with the reason shown; then the lowest-priority
  topics are deferred (`deadline_capacity`) with the reason shown. Each step
  records the rule that fired; rules from discarded attempts are not recorded.
- Revisions never change scope on their own: a unit that does not fit is the
  existing "does not fit before the deadline. Move a block, shorten scope or
  add time." blocker.
- A deadline under ten minutes away with no window gets the priority card for
  the time remaining, starting now. A later deadline with no window is a 422
  naming the fix ("No study window falls before the deadline...").
- "Most days" is every day; the learner removes days.
- The plan view lists deferred topics: "Saved for later - <topic>: <reason>".

| Test | Red before fix | Green after |
|---|---|---|
| `deadline-enforcement.test.ts` 3-day deadline, zero blocks after it | 9 blocks after the deadline | green |
| `deadline-enforcement.test.ts` 8-day deadline, zero blocks after it | 6 blocks after the deadline | green (all six topics taught and practised, shorter blocks) |
| `deadline-enforcement.test.ts` 9-minute deadline outside every window -> priority card; composer refuses | `expected undefined to be 'deadline_priority'` | green |
| `study-schedule.test.ts` Most days is every day | `expected [0,1,2,4,5] to deeply equal [0..6]` | green |
| `deadline-enforcement.test.ts` Q8: first block within 24h, no banner | (passes once the days are right) | green |
| e2e `a deadline nine minutes away outside every study window is a priority card` (new) | - | CI |
| e2e `a 1-/3-day deadline places nothing after it and names what is saved for later` (replaces "retains the full queue...") | - | 3-day run locally: pass; CI for both |

**Tests rewritten because they asserted the bug** (each now asserts zero
blocks after the deadline and scheduled-or-deferred-with-reason):
`plan-creation-blockers.test.ts` (5 deadline cases and the half-used window),
`a18-capacity.test.ts`, `topic-plan-model.test.ts` "keeps the full queue..."
(split into first-passes and no-window refusal), two `generate/route.test.ts`
cases (now 422 `schedule_capacity`, no provider call), `revision-integrity`
(title and the after-deadline assertion). Three fixtures whose subject is not
the deadline got a longer deadline: provider fill beyond 24 envelopes,
session-cap topics, and the 28-block living-plan proposal. `plan-rubric.ts`
no longer exempts topic plans. `retired-cases.json` renames point at the new
e2e titles.

**Carried to later root causes.**
- RC6 (finding 26): the composer catch *consumes* the plan allowance on a
  capacity refusal (`consumeFailedPlanClaim`). More deadlines are now refused
  instead of producing a useless queue, so this matters more.
- RC3: `refreshTopicPlanMetadata` rebuilds constraints after an edit and drops
  the composer's "practice left out" notes.
- RC4: the personalization sentence can read "Blocks are spread across your
  available days" next to "Practice returns sooner than usual"; it is still
  stitched from every fired rule.

## Root cause 3 - Editing disagrees with itself (findings 16, 17, 18)

**Causes found.**
1. **Undo hung, then the plan was not restored (16).** `apply_plan_revision`,
   the single writer for every saved change and every Undo, raised its
   deterministic refusals (obsolete preview, changed/missing session, saved
   work, expired source, changed capacity, changed retry) as SQLSTATE 40001.
   The stack in front of the database retries 40001 indefinitely - the same
   mechanism #97 proved for completions in CI #420, whose BACKLOG entry left
   these writers as an open question. Nothing commits, so a reload shows the
   plan unchanged. The client request also had no timeout, and the inline
   receipt/Undo lived only in React state, so a reload lost the Undo button.
2. **A move renamed and re-methoded the block; its Undo restored more than the
   move (17).** Moving a block, and every schedule change, rebuilt the block
   through the plan composer and provider copy: new title ("Retrieve ATP..."
   became "Practice ATP..."), method re-routed. Undo then reversed that whole
   rebuild, and restored deadline/availability/materials wholesale from the
   old snapshot.
3. **Receipts claimed "everything else unchanged" (18).** The receipt was
   the fixed delta line ("Change selected study blocks") plus a hard-coded
   "; everything else unchanged." whatever the rebuild did.
4. **A deadline change rewrote blocks to Concept Mapping (18).** A deadline
   change rebuilt every block that no longer fitted, and the revision preview
   gave the composer neither the learner's onboarding answers (sizing) nor
   the baseline answers (method), which plan generation always passes - so
   rebuilt blocks got the default method, Concept Mapping, at the default
   length.

**Fix.**
- Migration `20260919100001_plan_revision_refusals_answer.sql` raises every
  `plan_revision_*` refusal as PT409 (HTTP 409) and advances the readiness
  contract to `20260919100001` (`planRevisionRefusalsAnswer`), so a database
  that would still hang is not reported ready. The app maps PT409 to 409.
- Deadline and availability changes re-date the blocks that no longer fit
  into free study time before the deadline, keeping each topic's order; a
  move changes only that block's date. Neither rebuilds the block or calls
  the provider. A block that cannot fit is a capacity blocker with the
  learner's choices.
- Receipts are computed from the saved before/after plans
  (`revision-receipt.ts`): every changed block is named with what changed
  (moved from/to, renamed, method, minutes, added, removed), so the closing
  "everything else unchanged" is true by construction. Undo's receipt is
  computed the same way.
- Undo restores a plan-level field (deadline, availability, materials) only
  if that revision changed it.
- The inline receipt and Undo are kept per account in the browser and shown
  after a reload while the plan is still at that revision (spec section 5:
  "until the next change"). Revision requests time out after 45 s with an
  instruction to reload and check.
- The revision preview passes the learner's onboarding answers to sizing
  and method routing, as generation does.

| Test | Red before fix | Green after |
|---|---|---|
| pgTAP `20260919100001_plan_revision_refusals.test.sql`: no `plan_revision_*` refusal raised as 40001 | main's writer source has seven (`grep "errcode='40001',message='plan_revision_" supabase/migrations`) | CI (migrated database) |
| `living-plan-route.migrated.test.ts` "answers a refusal only the database can see instead of hanging Undo" (session changes between the route's check and the writer) | not run red: on main it is the 40001 retry path #97 showed never returns | CI (migrated database) |
| `revision-dates-only.test.ts` earlier deadline: only dates change, nothing after it, no provider call | `Retrieve Photosynthesis: only its date may change` | green |
| `revision-dates-only.test.ts` move: only the date changes, others byte-identical | `expected 'Practice ATP and energy transfer' to be 'Retrieve ATP and energy transfer'` | green |
| `living-plan-route.test.ts` move -> receipt names the move only -> Undo restores exactly it | `expected {...} to match object {...}` (title/method changed) | green |
| `living-plan-route.test.ts` rebuilt block uses the learner's onboarding answers (10-15 min) | `expected 23 to be less than or equal to 15` | green |
| `signed-in-generation-readiness.test.ts` fails closed without `planRevisionRefusalsAnswer` | - | green |
| e2e `moving a block changes only its date; Undo restores it after a reload with the method untouched` | - | local run: pass; CI |
| e2e `inline Mark covered keeps its Undo across a reload, and the restored plan survives the next reload` | - | CI |

Byte-identical coverage of the other sessions now spans every inline action:
Mark covered and Attach material (`living-plan-route.test.ts`), Change
method (`revision-integrity.test.ts`), move a block (`revision-dates-only`
and the route test above).

**Founder action.** Apply migration `20260919100001` to production Supabase
before deploying; Production builds fail readiness until it is applied, by
design.

**Residual.** When a saved plan's `schedulePreferences.availability` is empty
(legacy plans), the client derives windows from the first 14 sessions for the
inline "same availability" line and the server may read that as a schedule
change; after this fix that re-dates rather than rebuilds. Legacy plans are
being deleted (brief).

## CI decision - reviewer canary FLAKY (founder, 19 Sept 2026)

Run 35439495392 (cc34ee8), step 20: the new `test-goal-teaches-first.live`
test passed 2/2; the CI410 reviewer canary caught the retained bad question in
1 of 5 reviews (`{"badQuestionCaught":1,"badQuestionMissed":4,
"soundReplacementAccepted":5,"soundReplacementWronglyRejected":0,
"unusableReplies":0}`), against 5 of 5 in run 432. The reviewer, prompt and
fixture have no diff against 843f7ee, so this is the reviewer's variance, not
a Brief 2.5 change. Founder decision: FLAKY, keep reporting. The canary moved to
its own `continue-on-error` step, its hit-rate file is uploaded as an artifact,
it is FLAKY in `scripts/live-gate/policy.json`, and reviewer reliability is in
`docs/audits/BACKLOG.md`. The 32-question and test-goal live checks stay
blocking.

## Root cause 4 - Personalization text is canned (findings 20, 21, 72, 75, 78, 106, 107, 109)

**Causes found.**
1. **The plan's why-text (20, 21, 72, 75, 78)** was `[...rules.values()].join(" ")`
   in `topic-plan-model.ts`: every fired rule's fixed reason. Several fired
   without being enacted: "Dense topics stop at three learning blocks" fired
   on topic weight even when the topic had no learning block; P8 "Blocks are
   spread..." and P9 "first practice check brought forward" regardless of the
   placement; P10 "one extra practice block" even when the deadline left it
   out. "a 11-minute" came from `sets a ${ceiling}-minute ceiling` with the
   shorter-sections ceiling (15 x 0.75 = 11).
2. **Home read the retired questionnaire (106).** With the baseline questions
   on (production), Home's "Personalized today" chips, energy card and
   "Deepen your profile" prompt came from the old position-indexed profile
   slots, which the ten baseline answers do not update.
3. **Two questionnaires and developer notes on You (106, 107).** You rendered
   the ten-question baseline editor and, always, the eleven-question canonical
   profile. The baseline editor printed each question's internal `routesTo`
   ("Layer 4: timer one band down..."), despite its comment "Shown nowhere".
4. **Q6/Q7 "not answered" (109).** An account created from the public Study
   Profile was marked onboarded without the baseline questions; the Study
   Profile never asks Q6 or Q7, and they have no legacy slot to fall back on.

**Fix.**
- `personalization-sentence.ts` generates the why-text from the fired rule
  IDs only: one "Because you said X, YOVA did Y." per rule, X from the
  learner's own answer, Y what the composer enacted; deadline rules read
  "Because your deadline is <date>, ...". Rules not about the learner
  (sizing, workload grouping) are not in it.
- The composer fires the guardrail only when a topic was actually capped at
  three learning blocks, and P8, P9 frequent check-ins and P10 extra practice
  only from the accepted placement when they changed it.
- With the baseline questions on, Home no longer shows the old profile's
  chips, energy card or "Deepen your profile" prompt; You shows one
  questionnaire and no developer notes. (The weekly review, from real
  completions, is unchanged.)
- A new account from the Study Profile is asked exactly the required baseline
  questions the profile left unanswered, before onboarding counts as complete.

| Test | Red before fix | Green after |
|---|---|---|
| `personalization-sentence.test.ts` no learning-block claim on a plan with none | `expected 'Dense topics stop at three learning b...' not to match` | green |
| same: learner's own ceiling, no "a 11-minute" | `expected 'Dense topics stop at three learning b...' not to match /\ba 11-minute\b/` | green |
| same: no extra-practice claim when the deadline left it out | `expected false to be true` | green |
| same: one because-you-said sentence per enacted rule | `expected 1 to be greater than 2` | green |
| e2e `baseline-study-profile-onboarding` "an account created from the Study Profile is asked Q6 and Q7, and saves them" (flag on) | no question shown; went straight to the summary | local pass; CI |
| e2e same file "You shows one questionnaire with no developer notes, and Home does not send the learner to the old one" | `getByText('Deepen your profile')`: expected 0, received 1 | local pass; CI |

Note: the main browser suite runs with `YOVA_BASELINE_SESSION_SHAPES=false`
to keep the pre-baseline flows covered; production runs with it on, so the
new cases are `baseline-*` specs. The flag-off import test ("skips duplicate
onboarding") is unchanged, because the flag-off flow has no Q6/Q7.

**Founder action.** Existing accounts (including yours) keep whatever was
saved: answer Q6 and Q7 on You, where the single questionnaire now shows
them. I did not force every returning account through questions on its next
load.

**Residual (design pass / later).** `buildPlanProfileSummary`, the prose
profile summary sent to plan and Study Now generation, is still built from
the old slots and omits Q6/Q7; plan structure and method routing use the
baseline answers directly, so this affects provider wording only.

## Root cause 5 - Source assignment defaults wrong (findings 14, 22, 23)

**Causes found.**
1. **Study guide pre-selected for every topic (14).** `initialSetupCorrections`
   pre-filled each topic's source with the first `sourceReferences` entry,
   ignoring its role; the map model usually lists the study guide first. On
   Continue, `applySetupCorrections` then kept only that material's
   references, deleting the content PDF's excerpts, so every topic took the
   scope-outline (no-source) path.
2. **Section labels became topics (22).** The per-chunk mapper returned
   document headings ("Unit 6 test scope", "Unit 6 concept explanations"), the
   coverage check forced the map to keep every material topic, and only a
   prompt line asked for knowledge titles. The 7 Sept change removed one copying
   path (the deterministic material fallback); no code rejected such titles.
3. **Rule 2 not enforced (23).** No generation path rejected
   document-referential questions in code; the practice reviewer's issue codes
   do not include it, and every other guard is a prompt instruction.

**Fix.**
- The default source is a material that can teach the topic; a study guide is
  chosen only when nothing else covers the topic (spec rule 1: it then takes
  the no-source path).
- `document-referential.ts` detects questions about a document, unit or
  guide. The practice quality loop rejects them whatever the reviewer says and
  repairs them like any other rejection (a still-referential replacement is
  dropped, never delivered); the placement check refuses them before its
  validation call.
- `document-label.ts` detects titles that name a part of a document; map
  generation renames them from their own description and subtopics in one
  bounded repair call, and refuses the map if a label survives.
- Spec section 8's permanent live test: `study-guide-rules.live.test.ts`
  (study guide whose sections are titled as in the audit -> real map -> real
  lesson questions; no document-label topic, no referential question). Runs
  in the blocking per-push live step and the nightly gate.

| Test | Red before fix | Green after |
|---|---|---|
| `setup-corrections.test.ts` content source pre-selected over the study guide; Continue keeps its excerpts | `expected '5555...' (guide) to be '6666...' (PDF)` | green |
| `shape-slot-quality.test.ts` "fits the notes" question replaced even when the reviewer accepts it | delivered unchanged | green |
| `map-diagnostic.test.ts` placement question about "the goals of Unit 6" refused | `promise resolved ... instead of rejecting` | green |
| `generate-plan-map.test.ts` "Unit 6 test scope" / "Unit 6 concept explanations" renamed | `expected [ 'Unit 6 test scope', ... ] to deeply equal [ 'Transcription', 'Translation' ]` | green |
| `document-referential.test.ts`, `document-label.test.ts` (positive and negative phrasings) | - | green |
| `study-guide-rules.live.test.ts` | live | CI |

**Residual (not changed; recorded).** Rule 1 is still breached on the
pre-baseline paths: scheduled-review generation (`session-generator.ts`) and
the streamed lesson route (`lesson-brief.ts` -> `/api/sessions/lesson`) pass
`scope_outline` excerpts to the model. The baseline session shapes (the
production session path) already exclude them (`source-context.ts`).
`active-plan-attachment.ts` still copies a newly attached material's topic
titles verbatim as deferred topics.

## Root cause 6 - Infrastructure (findings 24, 25, 26, 113)

**What the code shows (and what it cannot).**
- **`/api/errors` 503 (113, and in 25's network log).** The route has no 503 path (every branch answers
  204), and the invite-only proxy lists `/api/errors` as public, so it passes
  before the tester-access RPC. Production answers an unauthenticated POST
  with 204 today (checked 19 Sept). A 503 on this route therefore came from
  the platform in front of the function, not from YOVA code; Vercel's runtime
  logs for the audit window are needed to name it. The only YOVA-generated
  503 in front of every non-public API route is the tester-access check
  (`inviteAccessUnavailableResponse`, when `claim_yova_tester_access` errors),
  which would also produce a Study Now 503.
- **Study Now 503 (25).** Study Now's slot handler answers 503 when the
  provider is unavailable or the AI allowance cannot be verified
  (`shape-slot-handler.ts:96, 118, 129`); with the platform cause above, these
  are the candidates.
- **Placement "unavailable" (24).** The plan creator shows "The placement
  check is unavailable right now" for any placement failure, including the
  validator rejecting a single question (which discards the whole check).
- **Allowance exhausted at 5 plans (26) - found.** Invite-only accounts get
  20 `plan_generation` units a day and 5 a minute
  (`202609040001_expand_ai_usage_cost_controls.sql`). One plan creation
  reserves a unit per step - topic map, topic map again after setup
  corrections, placement check, plan - so four steps: 20 / 4 = 5 plans a day.
  When it ran out on the topic-map step, the learner was told to "Skip the
  placement check" (wrong step). A plan refused because nothing fits before
  the deadline also spent a unit, with no AI call made.

**Fixed.**
| Test | Red before fix | Green after |
|---|---|---|
| `generate/route.test.ts` allowance exhausted on the topic-map step names that step | `expected 'This account has reached its planning...' to match /topic map/i` | green |
| `generate/route.test.ts` an accepted map that cannot fit before the deadline refunds the reservation | `no provider was called, so nothing is consumed: ... called 1 times` | green |

**Allowance counts plans, not steps (founder decision, 19 Sept 2026: "a
learner shouldn't be punished for correcting their topic list").** Only a
plan's first topic-map request reserves a unit. Every later step carries the
map's signed receipt (bound to the exact map and learner, 24 h) and is not
charged: setup corrections, map corrections, the placement check and the plan.
The per-minute planning rate limit still applies to every step. Trade-off:
follow-up steps on one map are bounded by that rate limit and the receipt's
24-hour life, not by the daily count.

| Test | Red before fix | Green after |
|---|---|---|
| `generate/route.test.ts` "charges the first topic map once and not the plan's later steps" (first map, then a map correction, then the plan) | `expected "vi.fn()" to be called 1 times, but got 2 times` | green |

Four allowance tests (fallback on unknown reservation status, exhausted
allowance, consumption on provider failure, the capacity refund) now use a
request without a map receipt, which is the case that is still charged.

**Founder actions.**
1. Allowance policy: decided (above).
2. To settle "one cause or four", run in the Supabase SQL editor (read-only):
   ```sql
   select date_trunc('hour', occurred_at) as hour,
          event_data->>'generationType' as step,
          event_data->>'finalOutcome' as outcome,
          event_data->>'failedValidator' as failed_validator,
          count(*)
   from public.product_events
   where event_name = 'generation_observed' and occurred_at >= '2026-09-17'
   group by 1, 2, 3, 4 order by 1 desc, 5 desc;

   select action, window_kind, window_started_at, request_count
   from public.ai_usage_windows
   where window_started_at >= '2026-09-17' order by window_started_at desc;
   ```
   and pull Vercel's runtime logs for the audit window filtered to status 503
   (`/api/errors`, Study Now's `/api/sessions/shape`). One provider or
   platform cause would show as a burst across all three at the same time.

---

## Finding map - all 114 findings of the 18 Sept production audit

Source: `docs/audits/2026-09-18-brief-2-production-audit.md` (843f7ee,
copied unchanged from the founder's Downloads; findings 1-114, none
skipped). Each finding is in exactly one category:

- **Fixed** - the root cause and the test that proves it. A finding is Fixed
  only if every non-UI part of it is fixed and tested; tests marked "CI" have
  been written and pass locally where they can run, and run in PR #99's CI
  (browser, migrated-database and live tests).
- **Design pass** - UI or wording the brief excludes (sections 4-6 UI items).
- **Founder action** - legacy plan deletion, migration, allowance policy.
- **Not yet addressed** - with the root cause that should cover it, or
  "nothing covers it". A partly fixed finding is here, with the fixed part
  named.

Corrections to the per-root-cause sections above (which used the brief's
summary): RC3 did not address finding 64 (that is the edit panel's
placement, a design item; the deadline rewrite is 18). RC4 did not address
72, 75 or 78 (72 is covered by RC2; 75 and 78 are the session hub's copy,
untouched). In RC6 the allowance is finding 26, Study Now 25, `/api/errors`
113.

| # | Finding (short) | Category | Root cause / test, or why |
|---|---|---|---|
| 1 | No learn blocks exist | Fixed | RC1. `learning-intent.test.ts` "teaches first when only the goal mentions a test or review"; `generate/route.test.ts` "gives every untouched topic a learn block for a test-prep goal"; `test-goal-teaches-first.test.ts`; live `test-goal-teaches-first.live.test.ts` (passed 2/2 in CI run 35439495392) |
| 2 | Blocks named "Learn" are closed-book quizzes | Fixed | RC1. Untouched topics now open with a learn block (`learningMode: "learn"`, Shape A): same tests as 1; a scope-only topic routes to the no-source teaching path (`test-goal-teaches-first.test.ts`, `learnPath: "ai_explanation"`) |
| 3 | Attached material never pointed at | Not yet addressed | Partly fixed (RC1): at creation a notes-backed topic routes `learnPath: "source"` and its direction reads "Review Chapter 12 notes.pdf..." (`test-goal-teaches-first.test.ts`). Attaching notes to an **active** plan (the audit's nitrogen case) has no test; RC1/RC5 should cover it |
| 4 | Block length fixed by profile, not computed from content | Not yet addressed | Nothing in 2.5 covers it (content-derived sizing) |
| 5 | Fill-to-capacity inverted (32 easy questions under a 48-min timer) | Not yet addressed | Nothing in 2.5 covers it |
| 6 | Method not routed from Q6 | Not yet addressed | The brief put it in RC1, but RC1 does not fix it: a block's method comes from `initialPlanProfileMethod`, which reads the old canonical-profile signals, never Q6. Q6 only shapes the learn session's produce step. Nothing in 2.5 covers the block method |
| 7 | Contrasting profiles give the same plan shape | Not yet addressed | Depends on 4, 5 and 6. RC1 adds learn blocks and RC4 makes the text profile-specific, but no test shows two profiles getting a different *kind* of plan |
| 8 | Scheduler spills past the deadline | Fixed | RC2. `deadline-enforcement.test.ts` 3-day and 8-day (red: 9 and 6 blocks after the deadline); `plan-creation-blockers.test.ts`; e2e `plan-schedule-date` "a 1-/3-day deadline places nothing after it..." (3-day local pass; CI) |
| 9 | First passes do not outrank returns near the deadline | Fixed | RC2. `deadline-enforcement.test.ts` (every scheduled topic is taught before the deadline); `topic-plan-model.test.ts` "puts first passes first under a close deadline..." (asserts the first block is a learn block and the rule fired; ordering beyond the first block is not asserted) |
| 10 | No priority card; the time in "tonight at 10:27pm" ignored | Not yet addressed | Partly fixed (RC2): a deadline under ten minutes away with no study window now gets the card (`deadline-enforcement.test.ts` 9-minute case, red first; e2e "a deadline nine minutes away..." CI). The goal sentence's **time** is still dropped (the deadline becomes a date), so the audit's exact input would not reach the card. RC2 should cover time parsing |
| 11 | Q8 "starts late" first block not within 24h | Fixed | RC1 + RC2. Cause was no learn blocks plus the missing Monday/Thursday. `study-schedule.test.ts` "offers every day for Most days" (red: `[0,1,2,4,5]`); `deadline-enforcement.test.ts` "Q8 starts late: ... within 24 hours, with no banner" (this case was already green with learn blocks present) |
| 12 | "Most days" hard-coded to Fri/Sat/Sun/Tue/Wed | Fixed | RC2. `study-schedule.test.ts` "offers every day for Most days" |
| 13 | No feasibility check at setup; "5 windows available", "15-15 blocks" | Not yet addressed | RC2 per the brief; the setup preview and estimate are unchanged |
| 14 | Study guide pre-selected for every topic | Fixed | RC5. `setup-corrections.test.ts` "pre-selects the content source over the study guide when a topic has both" (red: guide id) |
| 15 | Topic extraction non-deterministic, invents scope | Not yet addressed | Nothing in 2.5 covers it |
| 16 | Undo hung, did not survive reload; restored the wrong change | Fixed | RC3. Migration 20260919100001 + `living-plan-route.migrated.test.ts` "answers a refusal only the database can see instead of hanging Undo" (CI); pgTAP `20260919100001_plan_revision_refusals.test.sql` (CI); e2e `living-plan` "inline Mark covered keeps its Undo across a reload..." (CI) and "moving a block changes only its date; Undo restores it after a reload..." (local pass; CI); `living-plan-route.test.ts` "moves a block's date only ... Undo restores exactly that" (red: title/method changed) |
| 17 | Receipts lie ("everything else unchanged") | Fixed | RC3. Receipts computed from the before/after diff (`revision-receipt.ts`); `living-plan-route.test.ts` "moves a block's date only, says so in the receipt..." asserts the receipt names exactly the move, for apply and Undo |
| 18 | Changing the deadline rewrites the whole plan (all Concept Mapping) | Fixed | RC3. `revision-dates-only.test.ts` "an earlier deadline moves only the blocks that no longer fit, and only their dates" (red: block rebuilt); `living-plan-route.test.ts` "rebuilds a changed block with the learner's own onboarding answers" (red: 23 min for a 10-15 min learner). The header counts ("Test in 4 days", "12 blocks") are 58 and 35 |
| 19 | "Already covered" has no visible effect | Fixed | RC1. Untouched topics now teach (tests under 1) while a covered topic is practice-only (`topic-plan-model.test.ts` "never splits a topic without subtopics or a practice placeholder", covered case) |
| 20 | Personalization paragraph is canned | Fixed | RC4. `personalization-sentence.test.ts` (4 cases, all red with the audit's own sentences: "Dense topics stop at three learning blocks", "a 11-minute") |
| 21 | Home personalization driven by the legacy questionnaire | Not yet addressed | Partly fixed (RC4): with the baseline flag on, Home no longer shows the legacy chips, energy card or "Deepen your profile". Only "Deepen your profile" is tested (e2e `baseline-study-profile-onboarding` "You shows one questionnaire...", red: received 1); the "Personalized today" chips the audit quotes have no test |
| 22 | Section labels became topics ("Unit 6 test scope") | Fixed | RC5 (not reproducible). `generate-plan-map.test.ts` "renames topics that name parts of a document instead of knowledge" (red: labels kept); `document-label.test.ts`; live `study-guide-rules.live.test.ts` (CI). The existing plan is founder deletion (86). Its "Trace-Code-Test" method on a biology topic is not addressed |
| 23 | Document-referential questions ("fits the notes") | Fixed | RC5. `shape-slot-quality.test.ts` "replaces a document-referential question even when the reviewer accepts it" (red: delivered); `map-diagnostic.test.ts` "refuses a placement question about a unit's goals..." (red: resolved); `document-referential.test.ts`; live `study-guide-rules.live.test.ts` (CI) |
| 24 | Placement check fails ("unavailable", no retry) | Not yet addressed | RC6. Not reproduced. The "unavailable" screen covers every placement failure, including the validator rejecting one question. Cause pending the founder's `product_events` query |
| 25 | Study Now down; 503 on `/api/plans/generate`, `/api/errors`, `/api/events` | Not yet addressed | RC6. Not reproduced. The 503 on `/api/errors` cannot come from YOVA's route (no 503 path; public in the invite proxy; production answers 204 today). Pending Vercel logs |
| 26 | Allowance hit on the 5th plan; wrong step named; "Skip for now" dead end | Not yet addressed | Partly fixed (RC6): allowance now counts plans (founder decision), `generate/route.test.ts` "charges the first topic map once and not the plan's later steps" (red: charged twice); the topic-map step names itself, "names the topic-map step when the allowance runs out..." (red). "Skip for now" skipping the whole screen into a failing build is not addressed |
| 27 | Q4 exact vs learner_choice difference is cosmetic | Not yet addressed | Nothing in 2.5 covers it (a date chooser for learner_choice) |
| 28 | Q1 energy only sets availability; no learn-peak split | Fixed | RC1. With learn blocks present, learn goes to the peak window: `topic-plan-model.test.ts` "enacts each plan-level adaptation..." (learn block at 19:00 for evening); learn blocks exist for test-prep goals (tests under 1) |
| 29 | Q3 "never back to back" unhelpful, skips available days | Not yet addressed | Nothing covers it (product decision on focus spacing) |
| 30 | Q5 concrete_example has no visible effect | Not yet addressed | Nothing covers it. RC4 only stops claiming it when not enacted |
| 31 | Q9 frequent_check_ins could not be verified | Not yet addressed | Not reproducible by the audit (allowance). RC4 writes a sentence only when enacted; no sentence test for Q9 |
| 32 | Two conflicting dates in one row (text vs date input) | Not yet addressed | RC2 per the brief; the date input still uses an uncontrolled `defaultValue` |
| 33 | "Ahead of schedule" modal on first session; its action errors on the deadline | Not yet addressed | Nothing in 2.5 covers it |
| 34 | Exiting a session mid-way leaves no trace on the plan | Not yet addressed | Nothing in 2.5 covers it |
| 35 | Block count excludes practice; goes stale after edits | Not yet addressed | Practice now exists in every plan (RC1), but the stale count after edits is untested; RC3 should cover it |
| 36 | Date order not monotonic with queue order; duplicate names after edits | Not yet addressed | RC2/RC3 per the brief. A deadline change no longer renames blocks (RC3), but re-dated blocks keep their queue sequence, so date order can still differ; no test |
| 37 | No topic checkmark/note/drag/remove on the plan screen | Design pass | UI |
| 38 | Step 2 is a mode chooser; duplicate skip | Design pass | UI |
| 39 | Upload rejects DOCX | Not yet addressed | Nothing covers it (a file-type capability, not layout) |
| 40 | Goal-type pills render as grey text | Design pass | UI |
| 41 | Empty band on the goal step | Design pass | UI |
| 42 | Steps open mid-scroll | Design pass | UI |
| 43 | Flow logo differs from app logo | Design pass | UI |
| 44 | Material chip copy redundant; no summary | Design pass | UI |
| 45 | Only the second upload's status visible while uploading | Not yet addressed | Nothing covers it (upload state bug) |
| 46 | Text-only PDF fails the private reader; warning is loose text | Not yet addressed | Nothing covers the reader failure (the warning's placement is design) |
| 47 | Study guide / Notes toggle overlaps, no selected state | Design pass | UI |
| 48 | Topics as `<ol>` with native selects | Design pass | UI |
| 49 | Added topic title glued to the next label | Design pass | UI |
| 50 | "Roughly 15-15 blocks" | Design pass | Copy (the estimate's accuracy is 13) |
| 51 | Availability recommendation is a non-sequitur | Not yet addressed | Canned "because" text on the setup screen (`recommendStudySchedule`); RC4 should cover it, untouched |
| 52 | Custom timetable layout | Design pass | UI |
| 53 | No-materials path shows single-option source selects | Design pass | UI |
| 54 | Placement offer "Back" alone | Design pass | UI |
| 55 | Build progress steps, then a plan without teaching | Design pass | UI (the missing teaching is 1) |
| 56 | "Add material"/"Edit plan" on an unsaved plan | Design pass | UI |
| 57 | Two plans saved with the identical name | Not yet addressed | Nothing covers it |
| 58 | "Test in 8 days" off by one | Not yet addressed | Nothing covers it (day-count calculation) |
| 59 | Learning header and archive button above the plan | Design pass | UI |
| 60 | Raw `<details>` rows, glued labels | Design pass | UI |
| 61 | US-format date inputs | Design pass | UI |
| 62 | Stacked "after the deadline" warning boxes | Fixed | RC2. No block is placed after the deadline, so these notes are not generated: `deadline-enforcement.test.ts` asserts no "after the deadline" constraint; e2e `plan-schedule-date` asserts no "after the deadline" text on the plan (CI). Box styling is design |
| 63 | Receipt/Undo placement inconsistent | Design pass | UI |
| 64 | "Edit plan" panel appended at the bottom, no scroll | Design pass | UI |
| 65 | Edit panel raw labels | Design pass | UI |
| 66 | Raw ISO timestamps in preview | Design pass | UI (named in the brief) |
| 67 | Remove-topic control labels | Design pass | UI |
| 68 | Method dropdown lists 12 methods; unselectable label | Design pass | UI (method eligibility mismatch noted) |
| 69 | "Add material" is the generic change builder | Design pass | UI |
| 70 | Inline actions grey the plan 10-20 s, no progress | Design pass | UI (moves and schedule edits no longer rebuild blocks, RC3) |
| 71 | "Created by YOVA" on a plan built from uploads | Not yet addressed | Nothing covers it (wrong source claim) |
| 72 | False banners: ">24 hours away", "full queue remains available" | Fixed | RC2 + RC4. `deadline-enforcement.test.ts` Q8 case asserts no ">24 hours" constraint with every evening available; the "full queue" text is gone and every sentence is "Because ..." (`personalization-sentence.test.ts` "is one because-you-said sentence per enacted rule") |
| 73 | "I've already covered this" on a practice block; "not proof" | Design pass | UI/copy |
| 74 | "a 8-minute" session copy; 8 vs 11 mismatch | Not yet addressed | Session-side copy (`rule-evidence.ts`); RC4 should cover it, untouched |
| 75 | Hub shows internal labels and "chosen because" pills | Not yet addressed | RC4 per the brief; the session hub was not changed |
| 76 | Timer runs during generation and on the completion screen | Not yet addressed | Nothing covers it |
| 77 | Round 2 header regresses to "Step 1 of 3" | Design pass | UI |
| 78 | "Why this session ran" is 13 lines | Not yet addressed | RC4 per the brief; session-side text untouched |
| 79 | Weak question quality (easy distractors, answer position, giveaway stem) | Not yet addressed | Nothing covers it (reviewer reliability backlogged, 19 Sept) |
| 80 | 32-question repetition and topic bleed | Not yet addressed | Nothing covers it |
| 81 | Repair round labelled differently from the hub | Not yet addressed | Nothing covers it |
| 82 | Finish -> Home worked on double-click | Cannot place | Records something that works; no action |
| 83 | Desktop cards in a mobile column | Design pass | UI (named in the brief) |
| 84 | "Up next" shows last Thursday's overdue block without an overdue label | Not yet addressed | Nothing covers it |
| 85 | Home card claims an example-led start on a practice block | Not yet addressed | Canned method reason on Home; RC4 should cover it, untouched |
| 86 | Junk legacy plans active across Home/Calendar | Founder action | Delete legacy plans (brief) |
| 87 | Three different counts for today | Not yet addressed | Nothing covers it (legacy plans may contribute; not verified) |
| 88 | Today/Calendar ignore plans created today | Not yet addressed | Not reproduced; nothing covers it. Likely tied to 8 (those plans' blocks were after their deadlines), unverified |
| 89 | Today rows show "AM" with no time | Design pass | UI |
| 90 | Lower-cased week subtitle | Design pass | Copy |
| 91 | Weekly review copy | Design pass | Copy |
| 92 | "Where you stand" shows two random 0% plans | Founder action | Legacy plans (brief) |
| 93 | Plan subtitles look like timestamps; typos title-cased | Design pass | UI/copy |
| 94 | Milestone card layout | Design pass | UI |
| 95 | Duplicate "Add plan"/"Study now" cards | Design pass | UI |
| 96 | "Active 8" vs "17 active" | Not yet addressed | Nothing covers it |
| 97 | Next session dated yesterday, no overdue state | Not yet addressed | Nothing covers it (same class as 84) |
| 98 | Passed session with no overdue state | Not yet addressed | Nothing covers it |
| 99 | Calendar copy | Design pass | Copy |
| 100 | Stale "session still waiting" card from an old plan | Founder action | Legacy plans (brief) |
| 101 | "Next up" lists overdue items from junk plans | Founder action | Legacy plans (brief) |
| 102 | Two items at 9:00 today overlap | Not yet addressed | Nothing covers it (cross-plan overlap); not reproduced |
| 103 | Calendar quick-add keeps typos in the event title | Not yet addressed | Nothing covers it |
| 104 | Jump-to-date shows week start; "⌘K" hint on mobile | Design pass | UI |
| 105 | Calendar Add -> event form with "Start a learning plan instead" | Cannot place | Records something that works; no action |
| 106 | Two questionnaires on You | Fixed | RC4. e2e `baseline-study-profile-onboarding` "You shows one questionnaire with no developer notes..." (local pass; CI) |
| 107 | Developer notes under questions | Fixed | RC4. Same e2e asserts no "Layer N:" / "Nothing in v1" text (local pass; CI) |
| 108 | You page intro copy | Design pass | Copy |
| 109 | Q6/Q7 not captured at onboarding; no save confirmation | Fixed | RC4. e2e `baseline-study-profile-onboarding` "an account created from the Study Profile is asked Q6 and Q7, and saves them" (red: went straight to the summary; local pass; CI). The save confirmation is a design item. Existing accounts answer on You (founder done for his) |
| 110 | "held the scaffolding one level higher" session copy | Not yet addressed | Session-side "because" text; RC4 should cover it, untouched |
| 111 | URL never changes, no deep links | Not yet addressed | Nothing covers it |
| 112 | Console "Access to storage is not allowed" on every load | Not yet addressed | Nothing covers it; not reproduced here |
| 113 | `/api/errors` returns 503 | Not yet addressed | RC6. Cannot reproduce: no 503 path in the route, public in the invite proxy, production answers 204 today. Pending Vercel logs |
| 114 | Bottom nav tap sometimes swallowed | Design pass | UI |

**Totals (counted from the table).** Fixed 20: 1, 2, 8, 9, 11, 12, 14, 16,
17, 18, 19, 20, 22, 23, 28, 62, 72, 106, 107, 109. Of these, 16, 106, 107 and
109 rest partly on browser or migrated-database tests that only CI can run.
Design pass 40. Founder action 4: 86, 92, 100, 101. Not yet addressed 48, of
which 3, 10, 21 and 26 are partly fixed. Cannot place 2: 82 and 105 record
things that work. The migration `20260919100001` (applied) and the allowance
policy (decided) are release actions, not audit findings.

## Production incident, 19 Sept 2026 - database at 100% CPU (explains findings 25 and 113's window; see below)

**Found with the founder, read-only, in production Supabase.**
- Observability: database CPU at 100% for the whole 3-hour window viewed,
  almost all user CPU.
- `pg_stat_activity`: every busy connection was a PostgREST call to
  `complete_plan_session_with_route`, restarting every few milliseconds, most
  waiting on the per-user advisory lock, one "idle in transaction (aborted)".
- Postgres error log: `40001 study_route_planned_minutes_conflict`, many times
  a second, continuously.
- `product_events` for the audit window: every map, material mapping and plan
  generation succeeded; the one placement failure is `diagnostic_structure`
  (finding 24 is the validator discarding the whole check, not an outage);
  no Study Now generation was recorded at all, so its 503s happened before
  YOVA's route code ran.

**Cause.** A baseline completion sent `plannedMinutes: route.timerMinutes`
(the session router's timer, e.g. 8) while the session's committed route
planned `timing.activeMinutes` (e.g. 11 - finding 74 shows the same
mismatch). The routed-minutes guards (`guard_routed_attempt_minutes_v1`,
`guard_routed_event_minutes_v1`) refuse any such completion - permanently -
but raised it as SQLSTATE 40001, which the stack in front of the database
retries without end. Every mismatched save looped, held the advisory lock and
consumed the CPU; the learner saw "could not save this session".

**Fix.**
- Migration `20260919110001_planned_minutes_conflict_answers.sql` raises the
  refusal as PT409 (HTTP 409). **Founder ran the same SQL in production on 19
  Sept.** Postgres log: `40001 study_route_planned_minutes_conflict` many
  times a second until 14:39:49; at 14:39:50 the same refusal answered as
  PT409 five times (the in-flight retries ending); no error after it, only a
  routine checkpoint at 14:40:46. The loop stopped.
- The completion now sends the committed route's minutes
  (`selectSessionTerminalPlannedMinutes`), so the save is accepted.
- The client lists the refusal (40001 and PT409) as permanent for completions
  and interruptions, so a queued save with the old minutes stops retrying.

| Test | Red before fix | Green after |
|---|---|---|
| `selectors.test.ts` "plans a terminal write with the committed route's minutes, not the session timer" | `selectSessionTerminalPlannedMinutes is not a function` (the completion used the timer) | green |
| `baseline-completion.migrated.test.ts` "answers a planned-minutes conflict with PT409 instead of retrying it" | not run red (on main it is the 40001 retry loop seen in production) | CI (migrated database) |

**Not recovered.** Completions already refused this way were never saved;
sessions finished on this build show as not done. Readiness was not advanced
for this migration (it was applied by hand in production).

## CI run 35446615227 - the two regressions versus main

The comparator blocked on one browser case in two projects:
`core-learning-loop.spec.ts` "a multi-session plan carries one clear source
decision from Add to Learning" (desktop and mobile; main 1 pass, branch 0/3).
Reproduced locally: its reviewed edit moves every study window to Sunday
evening, after the frozen-clock deadline (Fri 4 Sept). On main that was
accepted by queuing blocks after the deadline (audit finding 8); on this
branch the preview correctly refuses it ("does not fit before the deadline.
Move a block, shorten scope or add time."), so "Confirm changes" stays
disabled. The case is about a reviewed schedule edit keeping its method
contract, so the edit now widens window 1 to every evening, which fits before
the deadline. Local run: pass.

Step 20 in the same run: the new `study-guide-rules.live.test.ts` shared one
50-second provider budget across two lessons; the second timed out twice (no
rule broken; the first lesson's six questions passed review). Each lesson now
gets its own provider, as the app does.

The comparator's other rows were pre-existing on main, established flaky, or
no regression (e.g. outside-teaching and Rayleigh now pass where main failed).

## CI run 35451033390

- **Release comparison: No regressions versus main.** The multi-session
  journey case now passes; every remaining red row is pre-existing on main
  or established flaky.
- Step 20: `study-guide-rules.live.test.ts` failed on its own extra word
  check, not on the rule. The question "Which strand is used directly by RNA
  polymerase as the guide for building the RNA strand?" is legitimate biology;
  the test's `\bthe guide\b` pattern was too broad, and
  `documentReferentialReason` correctly passed it. The test now names only
  "Unit 6" and "study guide" beyond the rule checker.
- Steps 29 (core learner journey) and 35 (full live gate: 51 pass, 5 fail, 24
  flaky, 2 unavailable) fail as they do on main; the comparator accounts for
  every failure.
