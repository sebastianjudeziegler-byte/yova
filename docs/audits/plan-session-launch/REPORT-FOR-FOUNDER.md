# Brief 2 and session quality

**Work in progress on PR #97; not deployed.** The separate Undo fix is merged and deployed. I verified a fresh production plan through change, confirmation, receipt, Undo and reload; the original six sessions stayed restored.

The latest review found real problems, beyond the original examples:

- **More questions did not automatically mean better practice.** A 24-question biology set had an invalid MCQ with no fully correct option, plus repeated reasoning disguised as new questions. The short introductory set was suitable for its simpler goal. The generator now has a separate answer/quality check, bounded repair and richer application instructions; fresh live output and latency still need to pass review.
- **Partial placement could stop plan creation.** A completed prefix of a placement test was rejected as if no placement had happened. The fix keeps the same evidence validation while accepting valid partial results.
- **Editing one session could change others.** Sessions scheduled beyond a deadline were incorrectly swept into an unrelated method edit. The new regression checks every unaffected session remains unchanged.
- **The preview did not consistently use the short-session profile.** It could show 22 minutes while claiming to respect short sessions. Profile transport is fixed for the preview; signed-in plans continue to use the saved account profile.
- **Long ordinary blocks could still be underfilled.** The original candidate stopped at 32 questions on one topic, sometimes showing 33 minutes under a 60-minute allowance. The resumed work is adding a second independently ready topic with its own source, saved work and result attribution. It cannot count the whole block complete after only the first part.

The guided visual map uses stable concepts, selectable relationship endpoints and deterministic layout. Drafts and corrections survive exit/reload. Revised answers are rechecked and retained separately from the original answer. In the live osmosis sample, a still-wrong revision remained flagged and the corrected one received no remaining incorrect claims.

Personalization remains a core requirement. Methods, question mix, workload, spacing and support come from the effective profile route. The next live run must demonstrate contrasting profiles on the same topic; the earlier run stopped on a test selector before that comparison finished.

My current product judgement: these are meaningful improvements, but I would not call the candidate paid-launch ready from test counts alone. The mobile briefing still puts a long list of instructions and reasons before the task, and needs usability attention. Automated videos help inspect flows; they cannot replace learning and engagement feedback from real people.

Verification so far: the integrated unit checkpoint passed 4,534 tests, full lint and25 runner checks; the two-activity resume journey passed with a verified recording. Final scoped routing checks and typecheck also pass. Full CI, real database replay, fresh generated-content review and final recordings remain required. Eleven earlier live-test videos were verified to decode; their index states which journeys passed and where testing stopped.
