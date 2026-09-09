# Founder-operated invited-tester rollout

Prepared only. No flag, deployment, production setting, account, or invitation was changed by this task. Do not apply this change until the Brief A regression gate in [EVIDENCE.md](EVIDENCE.md) passes under the founder's baseline-comparison policy and the PR has been reviewed.

Use the existing [Vercel environment path](../../VERCEL-CHECKLIST.md): **YOVA project → Settings → Environment Variables**. The exact server-only variable is `YOVA_PERSONALIZATION_ROLLOUT_PERCENT`. Its repository example remains `0`.

1. Select only the dedicated tester environment (or its branch-scoped Preview environment), already configured with `AUTH_INVITE_ONLY=true` and the existing tester-invitation database/authentication prerequisites. Confirm `/api/system/status` reports `testerAccess: "invite-only"`. Use its separate tester Supabase project as described in the Vercel checklist.
2. After the required Brief A regression gates pass, change **only in that tester environment** `YOVA_PERSONALIZATION_ROLLOUT_PERCENT` from `0` to `100`. The founder then applies the environment change through the existing deployment process. This task does not deploy it.
3. Verify `/api/system/status` reports `personalizationRollout.status: "full"`, `personalizationRollout.percent: 100`, and `testerAccess: "invite-only"`. Check authenticated, invited P1 and P2 accounts with the same six-topic map, availability and deadline from the permanent delta fixture. Generate fresh plans and verify their different first methods, durations, ETC position, reasons and objectives; complete create → activate → open session → complete for each.
4. Verify a signed-out request to the protected plan API receives 401 and a signed-in, non-invited account receives 403. The existing middleware must deny access if invite verification is unavailable (503). Confirm each new session’s `studyRoute.provenance.routerVersion` contains `personalized_v1`. Existing committed routes intentionally retain their assignment.

The percentage variable is an issuance flag, **not an invite filter**. Do not set it to `100` on a mixed public/tester environment. Invite-only access is enforced separately by `src/lib/supabase/proxy.ts` and its `claim_yova_tester_access` RPC. If no isolated, already invite-only environment exists, leave the variable at `0` until the founder supplies one; this brief adds no new cohort system.

## Revert

In the same Vercel project and tester environment, set `YOVA_PERSONALIZATION_ROLLOUT_PERCENT=0` and apply it through the founder's deployment process. Verify status `"baseline"`, percent `0`, and tester access still `"invite-only"`. Generate a fresh plan and confirm its new routes contain `task_mastery_v1` in `studyRoute.provenance.routerVersion`. Existing versioned routes keep their original assignment; reverting the flag does not rewrite their sessions. Do not change `AUTH_INVITE_ONLY` as part of this revert.

## Local reproduction

Run the permanent deterministic and real-provider delta tests using the commands in EVIDENCE.md. They set a synthetic fixture's rollout decision to 100 in memory; they do not modify `.env.local`, `.env.example`, or deployed configuration. The real-provider canary uses the configured OpenAI credential with the synthetic P1/P2 fixture only.
