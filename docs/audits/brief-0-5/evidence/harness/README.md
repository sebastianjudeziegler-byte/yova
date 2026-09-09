# Reproduce the serial scoped sample

Copy the capture/config/runner/sanitizer `.txt` files to ignored `tmp/brief-0-5/`, removing the final `.txt` suffix. Use the existing local `.env.local` (never commit its contents), Node 24, and installed lockfile dependencies.

```sh
node tmp/brief-0-5/run-final-cases.mjs tmp/brief-0-5/reproduction 3
node tmp/brief-0-5/save-baseline.mjs tmp/brief-0-5/reproduction docs/audits/brief-0-5/evidence/reproduction
```

The main sample ran on detached `e03a082`, before any product changes. The final branch sample runs at `e978f36`. The new grader file did not yet exist during the ten-case main sample; its separate three-run red canary logs are retained. No test runner retries, provider/model overrides, dependency installs, or concurrent suite runs are used. The capture wrapper forwards every argument and return/error unchanged, recording only synthetic fixture inputs/outputs for review. Do not keep its temporary TypeScript files in the source tree during lint/typecheck.

Full gate:

```sh
pnpm_config_verify_deps_before_run=false pnpm test:live --output docs/audits/brief-0-5/evidence/full-live-gate
```

The process-only pnpm flag avoids this host's automatic reinstall attempt; it does not change dependencies, test flags, or provider settings. Full-gate logs are redacted by the checked-in runner. Unavailable attempts remain separate from pass/fail.

The final runner includes the ten scoped cases, nine new grader canaries, and the osmosis/finance comparison cases (21 tests per run). The browser runner uses a fresh isolated development server for each unchanged ordinary suite, with zero retries. The Brief A script temporarily applies only its source diff, runs both delta canaries, and restores every source byte in a `finally` block; its manifest records both revisions and restoration.
