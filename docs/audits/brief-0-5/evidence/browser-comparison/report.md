# Ordinary browser comparison

Main: `e03a082`; branch source: `e978f36`. Same existing tests, restored lockfile dependencies, isolated local preview, zero retries. No Calendar or browser assertion/timeout changes.

| Test | Main | Branch |
| --- | --- | --- |
| two simultaneous tabs preserve both new events and each tab refreshes (desktop-chromium) | FAIL | FAIL |
| two simultaneous tabs preserve both new events and each tab refreshes (mobile-chromium) | PASS | PASS |
| concurrent edits to a recurring series preserve the second tab's unsaved draft (desktop-chromium) | PASS | PASS |
| concurrent edits to a recurring series preserve the second tab's unsaved draft (mobile-chromium) | PASS | PASS |
| finishing a quick-add plan replaces the manual deadline with one linked authoritative outcome (desktop-chromium) | PASS | PASS |
| finishing a quick-add plan replaces the manual deadline with one linked authoritative outcome (mobile-chromium) | PASS | PASS |
| a confident misconception is repaired now without a duplicate follow-up (desktop-chromium) | FAIL | PASS |
| a new topic is taught before YOVA asks for independent performance (desktop-chromium) | PASS | PASS |
| a confident misconception is repaired now without a duplicate follow-up (mobile-chromium) | PASS | PASS |
| a new topic is taught before YOVA asks for independent performance (mobile-chromium) | PASS | PASS |

The desktop cross-tab Calendar failure is reproduced unchanged and remains open outside this PR. Main’s desktop misconception-repair timeout is retained; the branch comparison passes it. The remaining initially failed Calendar/teaching-first cases pass this comparison. No failure was quarantined or expectation weakened.
