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

## What is still open

- The full CI run on this branch, and its comparison against main's own run.
  Main's run currently fails five browser cases of its own (a material drop
  zone, and three mobile calendar cases), which are not this branch's doing.
- Item 2's answer, which that run produces.
- Codex's earlier honest caveats still stand: test counts are not evidence of
  learning, the phone briefing still puts a long list of instructions before the
  task, and automated recordings cannot replace feedback from real learners.

## What I deliberately did not do

- No merge, no deploy, no production setting touched.
- No mobile-specific change, and no second repair attempt for generation, which
  would have pushed a 32-question block past its time budget.
- No local database or live-model run: the migrated database cases and the live
  gate run in CI only.
