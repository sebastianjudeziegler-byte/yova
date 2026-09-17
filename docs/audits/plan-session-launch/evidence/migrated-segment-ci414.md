# CI #414: segmented completion diagnostic follow-up

Candidate: `e3dfd97`. Run: [35254727222](https://github.com/sebastianjudeziegler-byte/yova/actions/runs/35254727222).

The parent inspected the running job's GitHub UI logs: the migrated integration step reported **13 passed, 1 failed**. The new `persists both checked origins once and reloads the exact segment receipts after a terminal retry` case failed at its unchanged **30-second test timeout**. The passing cases include authorized segment hydration, the 12 malformed or incomplete receipt variants, legacy omitted/null replay, and delayed-reply recovery. Passing those cases does not establish that a valid segmented completion and reload work.

Static review did not identify a proven SQL loop or shared test-state hang. `dropReply` clears before its intentional delay, `offline` is reset, and the account mutation lane releases in `finally`. Completion writes and the authenticated receipt probe each have existing 12-second application deadlines; activation, direct PostgREST reads, full reload and the diagnostic Docker count are separate stages. The timeout alone does not identify which stage stalled.

The test now logs fixed stage names before and after each await, with elapsed time. If still pending at 25 seconds, it attempts a two-second read-only PostgreSQL wait diagnostic showing only activity state, wait events, blocking PIDs, elapsed query time and a fixed RPC classification. It does not print raw SQL, request arguments, credentials, auth headers or learner text. The 30-second test timeout and all persistence, retry, scope and reload assertions remain unchanged. These diagnostics require the next CI run; no local database or browser execution was performed.
