# YOVA Vercel and authentication checklist

Use this after Vercel has imported the GitHub repository. It separates **deployment** (the site exists online) from **production configuration** (the online site can safely use Supabase and OpenAI).

## 1. Confirm Vercel environment variables

In the YOVA Vercel project, open **Settings → Environment Variables**. Production needs:

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
AUTH_EMAIL_CODE_VERIFICATION
OPENAI_API_KEY
OPENAI_PLAN_MODEL
OPENAI_SESSION_MODEL
OPENAI_LESSON_MODEL
SITE_URL
```

`SITE_URL` should be the final public `https://` address with no path. The OpenAI key must never be named `NEXT_PUBLIC_OPENAI_API_KEY`; that prefix would expose it to browsers.

Keep `AUTH_EMAIL_CODE_VERIFICATION` set to `false` until custom SMTP is active and the Supabase Magic link or OTP template displays `{{ .Token }}`. Then set it to `true` and redeploy.

Use these model values unless a tested deployment intentionally overrides them:

```text
OPENAI_PLAN_MODEL=gpt-5.6-sol
OPENAI_SESSION_MODEL=gpt-5.4-mini
OPENAI_LESSON_MODEL=gpt-5.6-sol
```

`OPENAI_TUTOR_MODEL` is optional and uses `OPENAI_PLAN_MODEL` when blank. Guided-session skeletons use `gpt-5.4-mini` when `OPENAI_SESSION_MODEL` is blank. Full streamed lessons use `OPENAI_PLAN_MODEL` when `OPENAI_LESSON_MODEL` is blank.

After adding or changing variables, redeploy the latest Git commit. A deployment that happened before the variables were added does not automatically gain them.

YOVA deliberately fails closed in production when Supabase or OpenAI is missing. Localhost can still use preview mode, but a public deployment shows a setup screen instead of pretending that browser-only data is a durable account.

## 2. Configure Supabase redirect URLs

In Supabase, open **Authentication → URL Configuration**.

- Set **Site URL** to the final public YOVA address.
- Add `https://YOUR-YOVA-DOMAIN/auth/callback` to **Redirect URLs**.
- Keep `http://localhost:3000/auth/callback` for local development.

This tells Supabase which websites are allowed to receive a completed sign-in. A Vercel deployment can load perfectly while email sign-in still fails if this list is incomplete.

## 3. Configure reliable sign-in email

Supabase's included email service is suitable for setup testing but has restrictive limits. Before inviting testers, connect a custom transactional email provider under the Supabase authentication email settings.

The provider supplies:

- SMTP host and port
- SMTP username and password
- sender name and sender address

These values belong in Supabase, not in the YOVA repository. Once configured, test creating a new account, requesting another link, opening the newest email, and signing out and back in.

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
- system status is not cached;
- invalid authentication links recover safely.

## 5. Run one human journey

Automation cannot prove the complete learning experience. Use a fresh email address and complete:

```text
Account → email link → onboarding → learning goal → plan
→ generated session → completion → refreshed recommendation
```

Then repeat on a phone-sized browser. This catches interaction and email issues that a server-only smoke test cannot see.
