# YOVA Vercel and authentication checklist

Use this after Vercel has imported the GitHub repository. It separates **deployment** (the site exists online) from **production configuration** (the online site can safely use Supabase and OpenAI).

## 1. Confirm Vercel environment variables

In the YOVA Vercel project, open **Settings → Environment Variables**. Production needs:

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
AUTH_EMAIL_CODE_VERIFICATION
AUTH_INVITE_ONLY
AUTH_PASSWORD_ACCOUNTS
AUTH_CAPTCHA_ENABLED
NEXT_PUBLIC_TURNSTILE_SITE_KEY
SUPABASE_SECRET_KEY
CRON_SECRET
YOVA_DRAFT_RECEIPT_SECRET
OPENAI_API_KEY
OPENAI_PLAN_MODEL
OPENAI_SESSION_MODEL
OPENAI_LESSON_MODEL
SITE_URL
```

`SITE_URL` should be the final public `https://` address with no path. The OpenAI key must never be named `NEXT_PUBLIC_OPENAI_API_KEY`; that prefix would expose it to browsers.

`CRON_SECRET` must be a Production-only random value of at least 32 characters. Vercel uses it as the Bearer credential for the private account-export cleanup route. Do not enable account-data downloads in an environment where this secret, `SUPABASE_SECRET_KEY`, or scheduled functions are unavailable.

`YOVA_DRAFT_RECEIPT_SECRET` must be a Production-only random value of at least 32 characters. It signs generated plan drafts before activation. Signed-in plan generation is unavailable when it is absent, short, or padded with whitespace.

Keep `AUTH_EMAIL_CODE_VERIFICATION` set to `false` until custom SMTP is active and the Supabase Magic link or OTP template displays `{{ .Token }}`. Then set it to `true` and redeploy.

Keep `AUTH_INVITE_ONLY` set to `false` until migration `202608140002_tester_invites.sql` is applied, the founder invitation route is deployed, `SUPABASE_SECRET_KEY` is configured server-side, the Invite user template points to `/auth/confirm`, and Supabase **Allow new users to sign up** is disabled. Then enable it and redeploy. Keep the production secret out of Preview unless Preview uses a separate Supabase project.

For public password accounts, follow `docs/PUBLIC-PASSWORD-ACCOUNTS.md`. Keep `AUTH_PASSWORD_ACCOUNTS=false` until the signup and recovery templates, password policy, Turnstile, and real email journey are ready. Public mode uses `AUTH_PASSWORD_ACCOUNTS=true`, `AUTH_INVITE_ONLY=false`, `AUTH_CAPTCHA_ENABLED=true`, and a configured `NEXT_PUBLIC_TURNSTILE_SITE_KEY`. Supabase **Allow new users to sign up** is the final launch switch.

Use these model values unless a tested deployment intentionally overrides them:

```text
OPENAI_PLAN_MODEL=gpt-5.6-sol
OPENAI_SESSION_MODEL=gpt-5.4-mini
OPENAI_LESSON_MODEL=gpt-5.6-sol
```

`OPENAI_TUTOR_MODEL` is optional and uses `OPENAI_PLAN_MODEL` when blank. Guided-session skeletons use `gpt-5.4-mini` when `OPENAI_SESSION_MODEL` is blank. Full streamed lessons use `OPENAI_PLAN_MODEL` when `OPENAI_LESSON_MODEL` is blank.

After adding or changing variables, redeploy the latest Git commit. A deployment that happened before the variables were added does not automatically gain them.

YOVA deliberately fails closed in production when Supabase or OpenAI is missing. Localhost can still use preview mode, but a public deployment shows a setup screen instead of pretending that browser-only data is a durable account.

### Signed-in generation release order

Apply every pending Supabase migration through `202608300002_broad_recall_checkpoint_retry_containment.sql` **before** deploying this application version. Migration `202608300001_signed_in_generation_readiness.sql` exposes the read-only, service-only probe that verifies the `study_routes` schema, the `plan_sessions.committed_route_revision_id` pointer, and the exact activation/cache RPC signatures used by signed-in plan and session generation. The following `202608300002` migration repairs the checkpoint, attempt, and interruption-event guards and prevents deterministic checkpoint conflicts from being amplified by legacy PostgREST transaction retries. Apply it before the client deploy so already-open clients and marker-less Exit writes reach the corrected database boundary.

Then configure `SUPABASE_SECRET_KEY` and `YOVA_DRAFT_RECEIPT_SECRET`, and run:

```bash
pnpm readiness:production
```

This command contacts the configured Supabase project and fails unless the live database returns the current capability contract. It does not create an account, plan, session, or activation permit. `pnpm readiness:configuration` checks only non-secret configuration shapes for CI and is explicitly not release approval. Vercel Production builds run the same strict live gate automatically. Vercel Preview and ordinary local/CI builds remain compile checks, state that they make no production-readiness claim, and do not require Production secrets.

### Account-data export release order

Apply `supabase/migrations/202608170003_account_data_export.sql` to Production before deploying code that exposes **Download my YOVA data**. The migration creates the private bucket, account-bound export RPCs, durable quotas, Reset integration, and leased cleanup functions the route requires. Stale code fails safely after this migration; new code deployed before it cannot prepare a download.

Then set the Production `CRON_SECRET` and confirm the Vercel plan runs the `*/15 * * * *` cron in `vercel.json`. Deploy the application only after both are ready. During release verification, create one test export, confirm its signed link expires after five minutes, and confirm the private artifact is cleanup-eligible after 40 minutes. The 15-minute schedule bounds normal Storage deletion to about 55 minutes; cleanup receipts remain longer only to enforce the daily quota and contain no exported study content.

## 2. Configure Supabase redirect URLs

In Supabase, open **Authentication → URL Configuration**.

- Set **Site URL** to the final public YOVA address.
- Add `https://YOUR-YOVA-DOMAIN/auth/callback` to **Redirect URLs**.
- Add `https://YOUR-YOVA-DOMAIN/auth/confirm` to **Redirect URLs**.
- Keep `http://localhost:3000/auth/callback` for local development.
- Keep `http://localhost:3000/auth/confirm` for local invitation testing.

This tells Supabase which websites are allowed to receive a completed sign-in. A Vercel deployment can load perfectly while email sign-in still fails if this list is incomplete.

## 3. Configure reliable sign-in email

Supabase's included email service is suitable for setup testing but has restrictive limits. Before inviting testers, connect a custom transactional email provider under the Supabase authentication email settings.

The provider supplies:

- SMTP host and port
- SMTP username and password
- sender name and sender address

These values belong in Supabase, not in the YOVA repository. Configure both the Invite user and Magic Link templates to use YOVA's `/auth/confirm` token-hash URLs from `docs/TESTER-EMAIL-SETUP.md`. Once configured, test inviting a new tester, resending the invitation, opening the newest email, pressing the confirmation button, and signing out and back in.

## 4. Run the safe production smoke test

From the YOVA project folder:

```bash
pnpm smoke:production -- https://YOUR-YOVA-DOMAIN
```

This does not create an account or spend OpenAI credits. It checks:

- the site is publicly reachable;
- YOVA branding is present;
- security headers are active;
- the deployed app sees Supabase and OpenAI configuration;
- the deployed app can verify the current signed-in generation database contract and both server-only secrets;
- system status is not cached;
- invalid authentication links recover safely.

## 5. Run one human journey

Automation cannot prove the complete learning experience. Use a fresh email address and complete:

```text
Account → email link → onboarding → learning goal → plan
→ generated session → completion → refreshed recommendation
```

Then repeat on a phone-sized browser. This catches interaction and email issues that a server-only smoke test cannot see.
