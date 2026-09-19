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
- RC6 (finding 113): the composer catch *consumes* the plan allowance on a
  capacity refusal (`consumeFailedPlanClaim`). More deadlines are now refused
  instead of producing a useless queue, so this matters more.
- RC3: `refreshTopicPlanMetadata` rebuilds constraints after an edit and drops
  the composer's "practice left out" notes.
- RC4: the personalization sentence can read "Blocks are spread across your
  available days" next to "Practice returns sooner than usual"; it is still
  stitched from every fired rule.

## Root cause 3 - Editing disagrees with itself (findings 16, 17, 18, 64)

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
4. **A deadline change rewrote blocks to Concept Mapping (64).** A deadline
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
- **`/api/errors` 503 (25).** The route has no 503 path (every branch answers
  204), and the invite-only proxy lists `/api/errors` as public, so it passes
  before the tester-access RPC. Production answers an unauthenticated POST
  with 204 today (checked 19 Sept). A 503 on this route therefore came from
  the platform in front of the function, not from YOVA code; Vercel's runtime
  logs for the audit window are needed to name it. The only YOVA-generated
  503 in front of every non-public API route is the tester-access check
  (`inviteAccessUnavailableResponse`, when `claim_yova_tester_access` errors),
  which would also produce a Study Now 503.
- **Study Now 503 (26).** Study Now's slot handler answers 503 when the
  provider is unavailable or the AI allowance cannot be verified
  (`shape-slot-handler.ts:96, 118, 129`); with the platform cause above, these
  are the candidates.
- **Placement "unavailable" (24).** The plan creator shows "The placement
  check is unavailable right now" for any placement failure, including the
  validator rejecting a single question (which discards the whole check).
- **Allowance exhausted at 5 plans (113) - found.** Invite-only accounts get
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
   select date_trunc('hour', created_at) as hour,
          event_data->>'generationType' as step,
          event_data->>'finalOutcome' as outcome,
          event_data->>'failedValidator' as failed_validator,
          count(*)
   from public.product_events
   where event_name = 'generation_observed' and created_at >= '2026-09-17'
   group by 1, 2, 3, 4 order by 1 desc, 5 desc;

   select action, window_kind, window_started_at, request_count
   from public.ai_usage_windows
   where window_started_at >= '2026-09-17' order by window_started_at desc;
   ```
   and pull Vercel's runtime logs for the audit window filtered to status 503
   (`/api/errors`, Study Now's `/api/sessions/shape`). One provider or
   platform cause would show as a burst across all three at the same time.
