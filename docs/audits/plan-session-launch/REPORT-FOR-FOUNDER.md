# Brief 2 and session quality

**Work in progress on PR #97; nothing merged, nothing deployed.** The separate
Undo fix is merged and deployed, and a fresh production plan was verified
through change, confirmation, receipt, Undo and reload.

This report replaces the earlier hand-over version. It covers what Codex left
behind, what was done with it, and what is still open.

## Codex's unfinished hour, now committed

Codex ran out of credits with about an hour of work uncommitted. It typechecks
and its tests pass, so it is preserved in three commits rather than rewritten:

- **A sharper, batched question reviewer.** The independent check now reads at
  most eight questions per call, sees the earlier ones as context so it can
  still catch repeats, and must judge whether a question's setup states the
  conditions its answer needs and whether the question really demands the kind
  of thinking it claims.
- **The learner's own ten answers now always apply.** They were being forwarded
  to session sizing only when an internal rollout flag was switched on for that
  learner. That flag was the cause of the bug below.
- **One unfinished experiment, kept red on purpose.** Codex's last edit asserts
  that a particular database conflict code is treated like its sibling. Nothing
  in YOVA produces that code today, so the test fails; it is committed with that
  written on it rather than thrown away, and the completion work below either
  proves it or removes it.

## 1. Two profiles, two different session sizes

**The bug you hit.** A 10–15 minute learner and a 45–60 minute learner got
different methods but the identical 22 minutes and six questions, and the
shorter learner's receipt still said the session used "a shorter workload
allowance".

**Cause.** Session size was computed from the requested Study Now duration
instead of the learner's answers, because those answers were withheld behind the
rollout flag. Personalization of method and tips did not go through that flag,
which is why the session *looked* personalized while its size was not.

**Now**, on the same topic and the same 25-minute Study Now request:

| Profile | Allowance | Session | Questions | Method |
| --- | --- | --- | --- | --- |
| 10–15 min, loses focus very often, shorter sections | 11 min | 11 min | 3 | Concept Mapping |
| 45–60 min, rarely loses focus | 25 min | 22 min | 10 | Feynman Technique |

**And the receipt only claims what happened.** A sentence that tells the learner
their session was shortened for them now appears only while the session's own
estimate stays inside the allowance that rule set. When it does not, the rule is
still named, with the real numbers: "your allowance for this block is 15
minutes, but its content is estimated at 22 minutes." Both halves have a test
that failed before and passes now.

**The delta test was testing the wrong thing.** It compared rule identifiers and
tip wording, which differed while the sessions were the same size. It now reads
the size the server actually saved, checks the visible timer matches it, checks
the questions the session really generated match the saved count, and requires
the two profiles to differ by at least five minutes and two questions. Different
tip copy can no longer pass for personalization.

## 2. The stalled completion, narrowed to one step

The segmented completion case hangs on exactly one thing. Everything it is
actually about — two topics' results written once, the duplicate Finish
coalesced, the receipts reloaded and re-read — finishes in under four-tenths of
a second. What never returns is the deliberately tampered retry, the one call
the database answers by refusing.

The single database sample taken at 25 seconds showed nothing blocked and the
statement barely started, which suggests the request is being sent again rather
than being stuck — but one sample cannot prove that. Two additive probes now
answer it in one run, with the stalled case's assertions and deadline untouched:
a separate case that drives the simplest version of that same refusal and
asserts it comes back, and repeated sampling that shows whether the work keeps
restarting. If even the simple refusal never comes back, that is also a
candidate explanation for the unexplained production completion timeout.

## 3. The 32-question session: not slow, too strict to ship

Not the time budget. Every model call returned; 46.9 seconds against a 50-second
allowance. What happened: the reviewer rejected 6 of 32 questions — five of them
genuinely the same "osmosis needs a selectively permeable membrane" point
reworded — YOVA rewrote those six, and on the re-check **one** still disagreed
with its own answer key. That single question threw away all 32 and the learner
saw "YOVA couldn't build this".

Per your decision, a question that still fails the re-check is now dropped and
the rest are delivered, as long as the round keeps at least three sound
questions. The quality check itself is untouched: every question must still be
reviewed, and a review that fails or is unavailable still refuses the session.

Worth your judgement, not changed here: the repetition finding says 32 questions
on one three-subtopic topic is over-filled at source. The plan model's own answer
is to bring in the next ready topic, which the two-part blocks on this branch
already do.

## 4. The phone Practice Test was the same refusal

It reads like a phone problem, and it isn't. In the next run both phone cases
that had failed passed untouched, while the desktop six-question case failed for
the first time. The failures move between phone and desktop and between question
counts, and every one is the same refusal from item 3 — a short round simply has
the least room to lose a question. Nothing phone-specific was changed, because
no phone-specific cause is supported.

One consequence was fixed: the Practice Test case checked that the counter read
"QUESTION 1 OF 8" exactly. It now checks the counter matches the questions the
round actually delivered, so the learner is never counting toward questions that
do not exist.

## What the full run says

The run on the final commit confirms items 1 and 4 and refuses to sign the
branch off. Details in EVIDENCE.md; in short:

- **Confirmed live.** Both profile journeys and the comparison between them
  passed against the real model — the two profiles now get genuinely different
  session sizes. Both phone cases passed too, untouched.
- **Item 2, answered.** My probe hung exactly like the original case, so it is
  not the tampered retry: every refusal this completion writer raises leaves the
  request hanging. One request goes out, no reply ever comes back, the database
  shows the same work restarting every few seconds, and eventually two of those
  retries block each other. The cause is that the writer marks permanent
  refusals with the code Postgres reserves for "temporary clash, retry me".
  Fixing it means changing that code in the database and teaching the app the
  new one — Codex's red test is exactly that second half. It is a migration to
  the locked completion writer, so I stopped for your decision.
- **Still failing, and honest about it.** The three session-quality cases and the
  synthetic 32-question trace fail for two reasons: one gate of ours still
  demands an exact question count, which a dropped question now breaks, and the
  generation gives up after a review reply comes back unusable twice — most
  likely the new, stricter reviewer being squeezed into too small an output
  allowance. The second is a hypothesis from the failure site, not a trace.
- **Against main.** Of nine core-journey failures, five also fail on main's own
  run. Four do not: a quick-add deadline whose type reads "class", and the
  founder journey's missing source link, both on desktop and phone. Neither
  belongs to items 1–4; they come from this branch's earlier work.
- **The release gate is blocked**, and 50 of its 60 cases are simply renamed
  tests: Brief 2 rewrote intake, scheduling and the inline topic actions, and the
  comparator matches old titles exactly. They need listing as renamed, one by
  one, before anyone can read that gate. The saved main baseline is also older
  than main and due a refresh.

## Your four decisions, done

1. **Finish now answers.** The database marked permanent refusals with the code
   Postgres reserves for "temporary clash, retry me", so the request was retried
   until nothing came back. Those ten refusals now answer as a plain 409
   Conflict; genuine temporary clashes keep the old code and stay retryable. The
   app knows both spellings, so a database that has not taken the migration yet
   still behaves. Codex's red test is green. Readiness now refuses to call a
   deployment ready while its database still hangs on these refusals.
2. **The exact-count gate** now checks what the round delivered rather than the
   number originally asked for.
3. **The reviewer's allowance — measured first, as you asked.** The trace shows
   the fourth review batch, the one comparing eight questions against 24
   earlier ones, stopping at its output limit twice in the same place, with 13
   seconds of time budget still unused. It was the allowance, not the clock. It
   now grows with the questions and the context the reviewer has to compare
   against: 3,160 tokens where that batch had 1,230. Nothing else about the
   review changed.
4. **Renamed cases and the baseline.** 13 cases are listed with the case that
   carries their coverage now, and the comparator says "renamed" rather than
   treating them as missing. Four have no replacement — three about the capacity
   maths and the "doesn't fit" refusal that Brief 2 deletes, and one about
   speech and presentation plans — and I left those blocking on purpose: they
   are a question for whoever rewrote those flows, not something to wave
   through. The baseline is now main's own run rather than a commit from before
   Brief 2 renamed anything.

Locally: 4,560 tests pass, nothing failing, lint and types clean. The migration,
the database cases and the live gates only run in CI, so the next run is the
real check.

## A behaviour change: the short-deadline priority card is back

Brief 2's plan-model work had quietly replaced it. When someone had only a few
minutes left before their deadline, YOVA had started showing the full list of
topics with a note that the work would land "after the deadline". That is the
wrong thing to show a learner with three minutes left, so on your decision it
is reversed: they get one quick, useful action again — focus on the first topic,
here is what to do in the minutes you have — with a clear line that this does
not count as a finished session or a learned topic. It is checked before any AI
usage is charged, as it was on main. Its five browser checks are back under
their original names, and the unit tests that assert it failed first and pass
now.

## Long sessions now come in parts of eight

Your option B. A long session is still one sitting, sized by the learner's
answers, but its practice arrives in parts of at most eight questions, built up
from recall to application and comparison. A 32-question session is four parts;
a short session looks exactly as before.

Why it fixes the failures: making and checking 32 questions in one go needed
five model steps in a row inside 50 seconds, and it only fitted when every step
was quick. Now each part is its own small job — about 25 to 30 seconds — and the
next part is prepared while the learner answers the current one, so there is
normally no wait. The counter reads "Part 2 of 3 · Question 1 of 8", the last
question of a part says "Next part", and missed points are still repaired after
the whole session, not after each part. If a part can't be built, the learner
sees that only when they reach it, keeps every answer, and can try again.

**For your approval — a wording change to the plan-model spec.** Section 1,
"Fill to capacity", still assumes one block can be filled with up to 32
questions in one go. I suggest adding, after that bullet:

> - **Delivery in parts.** A block's practice is delivered in parts of at most
>   eight questions, easiest first (recall, then application and comparison).
>   Each part is generated and independently reviewed on its own; the next part
>   is prepared while the learner answers the current one. The block's size and
>   timer are unchanged — the profile still decides how much practice a block
>   holds; parts only decide how it arrives. Missed-point repair follows the
>   whole block.

Approved on 18 Sept 2026 and added to `05-PLAN-MODEL.md` section 1 as written.

## The question reviewer: two fixes and an honest measurement

**Warm-up questions are no longer rejected for being warm-up.** With practice in
parts, the first part is mostly recall. The reviewer was judging those recall
questions against the session's goal of applying ideas and throwing most of
them out — 30 of 49 rejections in one run. It now judges each question against
the kind of question it was planned to be. Recall still has to be correct,
unambiguous and not answerable by matching wording, and nothing else about the
check changed. Approved by you.

**How reliable is the reviewer?** The canary — a real past question with no fully
correct answer — is now reviewed five times per CI run, alongside its corrected
version five times. It must catch the bad one at least four times out of five
and accept the good one at least four times out of five. You'll get the actual
numbers from the next run.

## What is still open

- The two browser regressions from earlier branch work: a quick-add deadline
  whose type reads "class", and the founder journey's missing source link.
- Codex's earlier honest caveats still stand: test counts are not evidence of
  learning, the phone briefing still puts a long list of instructions before the
  task, and automated recordings cannot replace feedback from real learners.

## What I deliberately did not do

- No merge, no deploy, no production setting touched.
- No mobile-specific change, and no second repair attempt for generation, which
  would have pushed a 32-question block past its time budget.
- No local database or live-model run: the migrated database cases and the live
  gate run in CI only.
