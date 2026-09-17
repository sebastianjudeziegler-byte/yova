# Production deployment verification — 17 September 2026

The live domain `https://www.yovaapp.com/` was serving deployment `dpl_GxijDPgEkxpXbfsPQK8arPnWmv8Q` during this audit. GitHub's Vercel commit status associates that exact deployment with commit **`b75ec8d3da25695e6b008aa3e5f82855d415298e`**.

## Evidence chain

1. The connected GitHub `get_commit_combined_status` tool was called for repository `sebastianjudeziegler-byte/yova` and the full SHA above. It returned:

   ```json
   {
     "statuses": [
       {
         "context": "Vercel",
         "state": "success",
         "target_url": "https://vercel.com/yova/yova/GxijDPgEkxpXbfsPQK8arPnWmv8Q"
       }
     ]
   }
   ```

2. A direct, unauthenticated HTTPS GET to `https://www.yovaapp.com/`, requesting `Cache-Control: no-cache`, returned these relevant response values:

   ```text
   HTTP 200
   Date: Thu, 17 Sep 2026 12:16:14 GMT
   Age: 0
   Server: Vercel
   X-Vercel-Cache: MISS
   X-Matched-Path: /
   X-Vercel-Id: lhr1::iad1::m84pd-1789647374775-3dea43ef2bfe
   ```

   Its HTML contained `dpl_GxijDPgEkxpXbfsPQK8arPnWmv8Q`. A second direct GET at **12:17:49 GMT** also returned HTTP 200, `Age: 0`, and `X-Vercel-Cache: MISS`; its exact opening HTML was:

   ```html
   <!DOCTYPE html><html data-dpl-id="dpl_GxijDPgEkxpXbfsPQK8arPnWmv8Q" lang="en"><head><meta charSet="utf-8"/>
   ```

This establishes the chain **commit SHA → Vercel deployment ID → deployment ID in the live domain's uncached response**. It is stronger than merely finding a successful deployment: the currently served domain response carries the same deployment identifier. Confidence is high for the times of these observations; aliases may change after the audit. No claim is made about later deployment state.

The dashboard URL also returned HTTP 200 with title `yova – Deployment Overview – Vercel`, but its public HTML did not expose a Git commit SHA. The SHA link therefore comes from GitHub's Vercel integration status, not an independently authenticated Vercel control-plane read.

## Live capability status

A direct GET to `https://www.yovaapp.com/api/system/status` returned HTTP 200 at **12:16:15 GMT**, `Age: 0`, `X-Vercel-Cache: MISS`, and the following body:

```json
{
  "planGeneration": "openai",
  "guidedSessions": "openai",
  "signedInGeneration": "ready",
  "launchAbuseProtection": "ready",
  "personalizationRollout": {
    "policyVersion": "personalization_rollout_v1",
    "status": "baseline",
    "percent": 0
  },
  "studyProfilePublic": "ready",
  "studyProfileEmail": "resend",
  "tutor": "openai",
  "materials": "private-supabase",
  "persistence": "supabase",
  "authentication": "supabase-email",
  "testerAccess": "invite-only",
  "testerInvitations": "founder-managed",
  "emailVerification": "code-and-link",
  "passwordAccounts": "disabled",
  "captchaClient": "turnstile",
  "publicSignup": "disabled",
  "accountDataExport": "enabled",
  "accountDeletion": "enabled"
}
```

These values establish configured capabilities, not learning quality or successful completion. The `personalizationRollout` value must not be interpreted as proof that the Brief 1/1.5 baseline profile router is disabled; it names the separate `personalization_rollout_v1` policy.

## Source boundary

The audit's source review uses the exact commit above, accessed with `git show b75ec8d:<path>`. The ordinary working checkout is a different branch (`codex/brief-c-source-first-practice`) with uncommitted changes and is not used as production-code evidence. The live main SHA and merged PR #92 (`e44b03d`) were separately checked through the GitHub connector by the lead audit agent. Brief 2 implementation and unmerged Brief C code are outside the audit scope.

The deployment verification used only public GET requests and connected read-only GitHub metadata. It did not read secrets, create accounts, change deployment settings, or alter application code.

## End-of-audit deployment change

A final check during report preparation found a newer release. GitHub main is now `eeb1ff9745d57efd55656ff24128e2a30ca7c626`, the merge of [PR #94](https://github.com/sebastianjudeziegler-byte/yova/pull/94), “Fix Undo on a saved plan change: compare session times as moments,” merged at **13:20:40 UTC** on 17 September. The production HTML now contains `dpl_126d3npDKpj87HMWRYhcRAWH4oC1`; the successful Vercel status for `eeb1ff9` points to the matching deployment. This change was confirmed before 13:28:42 UTC.

The complete GitHub comparison from `b75ec8d` to `eeb1ff9` lists only six changed files:

- `docs/audits/BACKLOG.md`
- `docs/audits/brief-2/EVIDENCE.md`
- `scripts/live-gate/policy.json`
- `src/app/api/plans/adjust/living-plan-route.migrated.test.ts`
- `src/lib/plan-revision/revision-patch.test.ts`
- `src/lib/plan-revision/revision-patch.ts` (seven added lines)

No session runtime, routing, generation, grading or completion source changed in that comparison. The tested session code remains applicable to the newer release, but the four journeys are not described as rerun against it. Brief 2's rewritten plan model still is not implemented by this narrow Undo fix. Earlier deployment observations and source line references remain pinned to `b75ec8d`.
