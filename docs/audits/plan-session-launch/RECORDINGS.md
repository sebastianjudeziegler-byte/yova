# Recording index

## Local recovery replay — passed

`baseline-session-launch.spec.ts`, desktop Chromium, 17 September 2026. Development preview with a seeded profile and deterministic slot transport. No live model or database. This establishes draft/retry/provenance behavior, not feedback accuracy or teaching quality.

Source: uncommitted implementation based on main `75ea40a8d87366b41c6308bb5189452d0b493435`, before the PR. The CI recordings will identify their exact committed source through the workflow run.

- File: founder workspace `artifacts/session-launch-review/guided-map-recovery.webm`.
- Playback verified in Chromium: 1280×900, 7.68 seconds, frames decoded successfully; final map frame visually inspected.
- About 4.3s after the scenario began: exact final keystroke and link restored after immediate exit and reload.
- About 6.5s: failed correction restored after another reload, retried successfully, original and revised maps preserved separately.
- `journey-index.json` contains the measured scenario offsets; video includes a short setup lead-in. The replay is fast automation: pause or slow playback to inspect individual screens.

The earlier production audit was not recorded. This video is a new implementation test, not a recreation of that audit.

## CI evidence to inspect

Successful and failed videos are retained for map recovery, setup and live baseline journeys. The workflow uploads `yova-quality-evidence-<run-id>`; live generated samples are attached to `baseline-session-quality.live.spec.ts` results. Its endpoint-only checks have JSON samples rather than browser videos.

Review actual live questions and feedback before release. Automated elapsed time does not measure a learner's pacing or retention, and recordings cannot establish those outcomes.


## Reviewed CI #410 live-session artifact

Run `35239918714`, PR head `8fc64ce065f74767db8fa8a7b2654326efe36e21`; development preview, real model, no production database. The artifact `session-launch-live-35239918714` is available on the [workflow run](https://github.com/sebastianjudeziegler-byte/yova/actions/runs/35239918714). All 11 WEBMs were fully decoded successfully with FFmpeg on 17 September; screenshots of the P1 study screen and mobile missed-point screen were visually inspected. Local extracted copies: `/private/tmp/yova-pr97-sessions410/baseline-live-practice/`; machine-readable playback results: `/private/tmp/yova-pr97-sessions410/playback-check.json`.

| Journey | Recordings | Outcome in that candidate |
|---|---|---|
| One missed point → targeted retry → complete | Desktop + phone | Passed |
| Two missed points → targeted retry → complete | Desktop + phone | Passed |
| Outside study → return to practice | Desktop + phone | Passed |
| Practice Test | Desktop + phone | Passed |
| Interleaved Review | Desktop + phone | Passed |
| Contrasting-profile P1 | Desktop | Failed at an ambiguous test selector after study/example; P2 and delta did not execute |

The 6- and 24-question quality checks and revised-answer comparisons are endpoint calls with JSON attachments, not browser videos. Their retained outputs are in `samples/`. The 24-question output failed human-style content review despite passing its old structural test. These recordings precede the resumed fixes and cannot certify the final candidate. The separate production Undo check was not recorded.


## Local two-activity resume replay — passed

17 September, resumed candidate after main0ce2292 integration, before its final commit. One desktop Chromium case from `baseline-session-launch.spec.ts`; deterministic plan/workload and model transport fixtures, no live provider or database. The first activity's completed work remained in the checkpoint; the exact second map draft survived immediate exit/reload; the final single completion retained both topic origins and ordered receipts. The test passed in13.1s. Video: `/private/tmp/yova-pr97-review/two-activity-resume.webm` (1280×900), fully decoded with FFmpeg and an8s map frame visually inspected.

The local Next development server reported `Router action dispatched before initialization` during load; the asserted journey still passed. This is not evidence of a clean browser console or a production build. Fresh CI replays must be inspected. CI now uploads the recovery videos separately as `session-launch-recovery-<run-id>` so they remain practical to review without the entire large quality artifact.
