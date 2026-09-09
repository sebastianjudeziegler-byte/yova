# Release rule — effective 9 September 2026

The founder explicitly replaced the prior merge rule for this and every future brief.

The live gate blocks a merge only on a regression versus main: a case that passed on main and fails on the branch, or a scoped case that passes fewer runs than it did on main. Compare the retained main and branch evidence, including unavailable attempts and the source revision of each run. Do not hide an earlier regression behind a quarantine; a recorded correction must have its own red/green evidence.

A case at 2/3 that was worse on main is an improvement. Under Brief 0, a case that passes at least one of three samples is FLAKY: quarantine it in `scripts/live-gate/policy.json`, keep executing and reporting it, and backlog its failure with the capture. Do not chase it in that release. Three consecutive passes is the bar for claiming a scoped fix, not the bar for merging. Provider timeout, quota, missing environment and unfinished execution are unavailable, neither red nor green.

Known REAL failures remain failures in reports. A raw nonzero live-runner exit or a historical statement requiring every canary to pass does not replace the main-versus-branch release comparison. Preserve the complete report and publish pass/fail/flaky/unavailable counts with their sample basis. Static and browser results remain evidence; never claim an unrun gate passed.

For PR #84, the founder directed use of the existing artifacts and the last completed full run, with no further full gate before merge and no wait for the Chromium follow-up. See [the decision and complete comparison](audits/brief-0-5/EVIDENCE.md#release-decision-under-the-founders-regression-rule). After merge, confirm Vercel production Ready, its commit, invitation-only access and personalization 0%, and run the ordinary public deployment smoke once. Do not change production settings. Then stop; Brief B and further validator work are not part of this task.
