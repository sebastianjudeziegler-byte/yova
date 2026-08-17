# Public password account setup

YOVA supports public email-and-password accounts behind feature flags. Keep the current invite-only setup active until every section below is complete. Turning on Supabase signup before the app, email templates, and abuse controls are ready creates a public Auth endpoint even if YOVA still hides its create-account button.

## 1. Deploy the password-capable code with the feature off

Use these production values first:

```text
AUTH_PASSWORD_ACCOUNTS=false
AUTH_INVITE_ONLY=true
AUTH_EMAIL_CODE_VERIFICATION=true
AUTH_CAPTCHA_ENABLED=false
NEXT_PUBLIC_TURNSTILE_SITE_KEY=
```

Existing invited testers continue using their six-digit code or secure link. Do not enable public Supabase signup yet.

## 2. Configure password security in Supabase

In **Authentication → Settings / Password Security**:

1. Keep **Confirm email** on.
2. Set the minimum password length to at least 10 characters.
3. Enable leaked-password protection if the project plan supports it.
4. Enable password-changed and email-changed security notifications.
5. Keep the signup and recovery resend cooldown at 60 seconds or longer.

## 3. Install scanner-safe signup and reset templates

Email security systems can open links before the learner does. The links below intentionally open YOVA's inert confirmation page. The one-time token is used only after the learner presses the confirmation button.

In **Authentication → Email Templates → Confirm signup**, use a clear subject such as `Confirm your YOVA account`, and use this button URL:

```html
<a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&amp;type=signup">Confirm my YOVA account</a>
```

In **Authentication → Email Templates → Reset password**, use a clear subject such as `Reset your YOVA password`, and use this button URL:

```html
<a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&amp;type=recovery">Reset my YOVA password</a>
```

Keep link tracking off in Resend. Do not replace these links with `{{ .ConfirmationURL }}`.

## 4. Configure Cloudflare Turnstile

1. Create a Turnstile widget for YOVA in Cloudflare.
2. Add the production YOVA domain and any separate preview domain you intentionally test.
3. Copy the public site key into Vercel as `NEXT_PUBLIC_TURNSTILE_SITE_KEY`.
4. Set `AUTH_CAPTCHA_ENABLED=true` in Vercel and redeploy the CAPTCHA-capable YOVA code. Supabase safely ignores the extra token while its own CAPTCHA switch is still off.
5. After that deployment is ready, open Supabase **Authentication → Bot and Abuse Protection**, choose Turnstile, and enter the secret key.
6. Confirm `/api/system/status` reports `captchaProtection: "turnstile"` before opening signup.

At this stage, invited testers will see the same small security check before YOVA sends an email code. This keeps their existing passwordless sign-in working while Supabase CAPTCHA is enabled.

The Turnstile secret belongs only in Supabase. Never put it in a `NEXT_PUBLIC_` variable.

## 5. Protect AI spend

Turnstile reduces automated account creation, but it is not a spending limit. Public-account mode therefore starts with conservative daily per-account limits: 5 plans, 10 guided sessions, 20 streamed lessons, 40 answer checks, 30 tutor messages, and 3 teaching visuals. Before marketing the public signup page:

1. Set an OpenAI project budget alert and a conservative project limit.
2. Review YOVA's per-account AI allowances.
3. Watch generation volume and failed-generation logs during the first cohort.
4. Keep Supabase Auth email and OTP limits conservative.

## 6. Switch YOVA to public accounts

After the email and CAPTCHA journeys pass, set these Vercel Production values and redeploy:

```text
AUTH_PASSWORD_ACCOUNTS=true
AUTH_INVITE_ONLY=false
AUTH_EMAIL_CODE_VERIFICATION=true
AUTH_CAPTCHA_ENABLED=true
NEXT_PUBLIC_TURNSTILE_SITE_KEY=YOUR_PUBLIC_SITE_KEY
```

Keep `SUPABASE_SECRET_KEY` configured so the founder tester console can still invite and track a testing cohort. Finally, turn **Allow new users to sign up** on in Supabase. This dashboard toggle is the last public-launch switch.

## 7. Verify the real journey

Use a new outside email address and complete all of these:

1. Create account with first name, email, password, terms acknowledgement, and Turnstile.
2. Confirm that signing in before email verification is rejected without revealing technical details.
3. Open the confirmation email, press YOVA's confirmation button, and reach onboarding.
4. Sign out, sign in with the password, and confirm existing cloud learning data returns.
5. Request a reset for both a real and an unknown email. Both screens must show the same generic response.
6. Reset the real account, confirm the old password fails, and confirm the new password works.
7. Sign in to an existing passwordless tester with a six-digit email code, then use password recovery to add a password without changing the account or learning data.
8. Repeat the flow on a phone-sized browser.
9. Run `pnpm smoke:production -- https://YOUR-YOVA-DOMAIN`.

## Rollback

1. Turn **Allow new users to sign up** off in Supabase.
2. If rolling back to code without CAPTCHA support, turn Supabase CAPTCHA off before deploying the older code. The current release supports CAPTCHA in both invite-only and public-account modes.
3. Restore `AUTH_INVITE_ONLY=true` and `AUTH_PASSWORD_ACCOUNTS=false` in Vercel and redeploy.
4. Do not delete public accounts. Their data remains intact while access is temporarily limited.
