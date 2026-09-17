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
