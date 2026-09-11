# Standing Rules

These apply to every task on the baseline, regardless of which tool is doing
the work. They are the reason the 2026-09-07/08 releases shipped cleanly.

## Scope discipline

- Do only what the brief specifies. Unrelated bug found → one-line repro in
  `docs/audits/BACKLOG.md`, move on. Do not fix it.
- One branch, named in the brief. One PR. **Do not merge. Do not deploy. Do not
  touch production settings.** Stop when the PR is open and report.
- Never run parallel tasks against this repo.
- Anything not in `docs/redesign/` does not go in the codebase. It goes in the
  vision prototype.

## Evidence discipline

- Every behaviour change ships with a test that **FAILS before and PASSES
  after**. Record both in `docs/audits/<brief>/EVIDENCE.md`.
- Tests assert on what the learner sees, not only internal structure.
- **All verification runs in GitHub Actions.** Locally: unit, lint, typecheck,
  and at most one focused browser case. Never the full browser suite or the
  live gate on the founder's machine.
- **Live gate blocks a merge ONLY on a regression versus main** — a case that
  passed on main and fails on the branch, or a scoped case passing fewer runs
  than on main. Anything else intermittent is FLAKY: quarantine, backlog,
  move on. Never chase 3/3 on unscoped cases.
- Freeze the clock in any browser test touching scheduling
  (`e2e/helpers/frozen-clock.ts`).

## Product constraints

- **Personalization to the learner's profile**, not just the task. Two
  contrasting profiles must produce visibly different output. Delta test in
  `02-ROUTING.md`.
- **Low friction.** No confirmation steps beyond those specified.
- **No new bugs.** Current create → activate → open session → complete must
  pass unchanged.
- **The AI never rewrites sessions or plans directly.** Structure is code.
- **No client-asserted learning evidence** enters the record.

## Known pre-existing failures — not any brief's problem

Compare against `main` before calling anything a regression.

- Five legacy-material cases (A16, A19, A24, A30, A31, A33)
- Intermittent osmosis scope rejection
- A05 placement generator/verifier disagreement
- A17 broad-calculus intent question
- Desktop cross-tab Calendar timeout

## Reporting

What changed, red/green evidence, what is still open, what you deliberately did
not do. No "fixed" without failing-then-passing evidence.
