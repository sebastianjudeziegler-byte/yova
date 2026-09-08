# Full live gate

The full gate discovers every `src/**/*.live.test.ts` and runs both desktop and mobile `e2e/plan-launch-live.spec.ts` journeys. It enables every live opt-in, clears case filters, disables runner retries, and executes suites serially. Launch producers run before consumers. Every run uses fresh fixtures, and the browser clock is frozen with `e2e/helpers/frozen-clock.ts`.

## Local run

Use Node 24 and the lockfile's pnpm version. Install dependencies with `pnpm install --frozen-lockfile` and Chromium with `pnpm exec playwright install chromium`. Put `OPENAI_API_KEY` in the local ignored `.env.local`, or supply it in the process environment. Never commit keys. Existing process variables take precedence over `.env.local`. The September 8 baseline used `gpt-5.6-sol` for plans/lessons and `gpt-5.4-mini` for sessions, which match the pinned main revision’s defaults. Model overrides are recorded in each result artifact.

```sh
pnpm test:live
# Repeated full sampling, with no concurrent suites:
pnpm test:live --runs 3 --output test-results/live-gate-three-runs
# The same entry point without the package-manager wrapper:
node scripts/run-live-gate.mjs
# Runner accounting checks require no provider:
pnpm test:live:runner
```

The live browser uses an isolated local preview on port 3100, with Supabase and email integrations disabled. It will not reuse an existing server or point at a deployed site. Ordinary browser journeys continue to use the existing Playwright configuration. The live test's standalone fixture paths remain compatible with earlier audit commands; the full gate always overrides them with its own temporary root.

`test-results/live-gate/report.md` and `report.json` are the single tabulated result; redacted per-suite logs, browser completion receipts, and completion screenshots sit alongside them in the same artifact directory. Reports are checkpointed after every suite. Temporary raw provider reports and generated fixtures are removed when the command finishes. Missing keys generate explicit unavailable rows for every collected case. Unexpected skips, collection failures, disappeared audited cases, and unknown semantic failures block. Checkpointed reports include unfinished cases as pending failures, so an interrupted run cannot masquerade as a completed green gate.

## Triage and gate result are different fields

| Baseline classification | Definition | Result on a new run |
| --- | --- | --- |
| STALE | A test contradicted established product behavior, with a dated code/test reference. Only its expectation or test setup may change. | Pass if corrected expectations pass; otherwise fail and block. |
| REAL | Reproduced learner defect, or a product-intent question that cannot be resolved without a decision. Product stays unchanged in Brief 0. | Pass if the case passes; otherwise fail and block. |
| FLAKY | A historically failing case passed at least once in three complete main runs. | Still executes; reports its actual pass/fail and baseline pass rate, without blocking. |
| UNAVAILABLE | A provider timeout/quota, missing key, or missing dependent fixture prevented evaluation. | Neither red nor green. Reports without blocking; a later semantic failure still blocks. |

A transport outage takes precedence for that individual attempt. A generic test timeout, UI locator timeout, invalid schema, or missing learner content is not proof of provider unavailability. A missing dependent fixture is unavailable for the consumer; the producer's failure remains separately visible and can block.

The audited inventory and quarantine are in `scripts/live-gate/policy.json`. Its 66 required case identities preserve the original 64 unit cases and two browser journeys; discovery also includes future live cases automatically. New failures are never automatically quarantined. To stabilize a flaky case later, retain the canary, attach repeated full-run evidence, and remove its FLAKY entry through a reviewed change. Brief 0 does not repair quarantined product defects.

For baseline classification, any pass among the three runs makes a historically failing case FLAKY, including 3/3 recovery. With no passes, semantic failures are STALE only when supported by the existing contract; otherwise REAL. Cases with only transport/dependency failures are UNAVAILABLE. Mixed semantic and unavailable attempts retain both counts; unavailable attempts are not scored as failures. If one case hits a stale assertion and a separate unresolved product failure, it remains REAL, with both reasons recorded.

## CI

`.github/workflows/live-gate.yml` schedules the full set nightly at 03:17 UTC on `main`. A maintainer can also use **Actions → Full live gate → Run workflow**, leaving the PR field blank for main or entering a same-repository PR number. The workflow resolves and checks out that exact head commit, rejects fork code before exposing provider credentials, uploads one `full-live-gate-<run-id>` artifact, and attaches **Full live gate** status to the tested commit. REAL/STALE/unknown failures make the command and status fail; flaky/unavailable results are explicitly non-blocking.

Set the repository Actions secret `OPENAI_API_KEY` through the existing GitHub secret settings. This PR does not copy or modify production credentials or settings. If the secret is absent, the artifact says unavailable rather than claiming live coverage. GitHub only enables scheduled and manually dispatched workflows after the workflow exists on the default branch; this PR does not merge itself. No branch-protection settings are changed. If the founder wants this status required for merging later PRs, they can require **Full live gate** after choosing how on-demand runs should be requested.

GitHub references: [workflow events](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows), [Actions secrets](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets).
