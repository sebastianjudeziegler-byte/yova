# Invite-only tester email setup

YOVA supports founder-sent invitations, passwordless sign-in links, and six-digit sign-in codes. Complete every section below before sharing the private alpha. The database and UI alone do not make access invite-only; Supabase must also stop public account creation.

## Recommended provider: Resend

Resend is the simplest fit for the current Supabase setup. It can connect directly to a hosted Supabase project and provides the SMTP credentials Supabase Auth needs.

You need a domain that you own. A `vercel.app` address cannot be used as your sending domain. Use a subdomain such as `auth.yourdomain.com` so authentication email reputation stays separate from future marketing email.

## Part 1: verify the sending domain in Resend

1. Create or sign in to a Resend account at `resend.com`.
2. Open **Domains** and choose **Add Domain**.
3. Enter a subdomain you own, for example `auth.yova.app`.
4. Resend will show DNS records. Open the DNS manager where the domain is registered and add every record exactly as shown.
5. Return to Resend and choose **I've added the records**.
6. Wait until the domain status is **Verified**. This commonly takes several minutes, but DNS can take longer.
7. In Resend, turn off email link tracking for this authentication sender. Supabase recommends this because rewritten links can interfere with authentication links.

## Part 2: connect Resend to Supabase

Preferred route:

1. In Resend, open **Integrations**.
2. Choose **Supabase** and select **Connect to Supabase**.
3. Sign in to Supabase if asked.
4. Select the YOVA project.
5. Select the verified sending domain.
6. Choose **Add API Key**.
7. Set the sender name to `YOVA` and the sender address to something like `sign-in@auth.yova.app`.
8. Choose **Configure SMTP Integration**.
9. Open the Supabase dashboard link that Resend provides and confirm custom SMTP is enabled.

If the integration does not populate the fields automatically, use these values in Supabase **Authentication → SMTP Settings**:

```text
Sender name: YOVA
Sender email: sign-in@auth.yourdomain.com
Host: smtp.resend.com
Port: 465
Username: resend
Password: the Resend API key that begins with re_
```

Port 465 uses implicit TLS. Port 587 with STARTTLS is also supported.

## Part 3: make the Supabase email show the six-digit code

1. In Supabase, open **Authentication → Email Templates**.
2. Select **Magic Link**. This is the template used by YOVA's passwordless `signInWithOtp` request.
3. Set the subject to:

```text
{{ .Token }} is your YOVA sign-in code
```

4. Replace the message body with:

```html
<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:32px;color:#0B1020">
  <h1 style="font-size:28px;margin:0 0 12px">Sign in to YOVA</h1>
  <p style="font-size:16px;line-height:1.6;color:#667085">Enter this temporary code in YOVA:</p>
  <div style="font-size:34px;font-weight:700;letter-spacing:8px;margin:24px 0;color:#346BFF">{{ .Token }}</div>
  <p style="font-size:14px;line-height:1.6;color:#667085">Or use the secure sign-in button below.</p>
  <p><a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&amp;type=email" style="display:inline-block;background:#0B1020;color:#FFFFFF;text-decoration:none;padding:13px 18px;border-radius:10px;font-weight:700">Open YOVA</a></p>
  <p style="font-size:13px;line-height:1.5;color:#98A2B3">If you did not request this email, you can ignore it.</p>
</div>
```

5. Save the template.

`{{ .Token }}` is the Supabase-provided six-digit one-time password. The secure-link alternative must keep `{{ .TokenHash }}` and `type=email` exactly as written. The generic email type safely handles both a returning tester's magic-link token and an unconfirmed tester's confirmation token. YOVA first shows a confirmation button and consumes the one-time token only after the tester presses it, so an automatic email preview cannot use the link first. This also lets a founder-approved tester who already had a Supabase Auth account sign in without depending on a PKCE verifier in the founder's browser.

## Part 4: configure the founder invitation email

1. In Supabase, open **Authentication → Email Templates → Invite user**.
2. Set the subject to:

```text
You're invited to test YOVA
```

3. Replace the message body with the template below. Keep `{{ .TokenHash }}` exactly as written.

```html
<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:32px;color:#0B1020">
  <h1 style="font-size:28px;margin:0 0 12px">You're invited to YOVA.</h1>
  <p style="font-size:16px;line-height:1.6;color:#667085">Sebastian invited you to try YOVA's private alpha. YOVA builds a study plan, guides each session, and adjusts based on your goals and results.</p>
  <p style="font-size:16px;line-height:1.6;color:#667085">YOVA is still being tested, so you may run into unfinished features. Your feedback will help shape it.</p>
  <p><a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&amp;type=invite" style="display:inline-block;background:#0B1020;color:#FFFFFF;text-decoration:none;padding:13px 18px;border-radius:10px;font-weight:700">Open YOVA</a></p>
  <p style="font-size:13px;line-height:1.5;color:#98A2B3">This invitation is for {{ .Email }}. YOVA's private alpha is for testers age 13 or older. Testers under 18 should have a parent or guardian's permission. If you were not expecting this invitation, you can ignore it.</p>
</div>
```

4. Save the template.

The invite opens a YOVA confirmation screen first. The tester must press the confirmation button before the one-time token is used, so an email scanner cannot accidentally accept the invitation for them.

## Part 5: apply the tester-access database migration

Apply `supabase/migrations/202608140002_tester_invites.sql` to the linked production Supabase project before enabling invite-only mode. From a clean checkout, dry-run the migration first and confirm that `202608140002` is the only pending migration for this release.

Do not use `--include-all` from a working copy that contains other unfinished migrations.

After applying it, confirm the remote migration list includes `202608140002`. The founder tester page depends on the private invitation ledger and access-check functions created by this migration.

## Part 6: make Supabase invite-only

1. In Supabase, open **Authentication → Providers → Email**.
2. Turn off **Allow new users to sign up**.
3. Keep email sign-in enabled.
4. Review **Authentication → Users** once. Remove or ban any account that should not have alpha access.

YOVA also checks its invitation ledger after sign-in, but the dashboard setting is still required. Hiding YOVA's create-account button is not enough because Supabase's public Auth API can otherwise create users directly.

## Part 7: enable tester access in Vercel

1. In Vercel, open the YOVA project.
2. Open **Settings → Environment Variables**.
3. Add the server-only Supabase secret as `SUPABASE_SECRET_KEY`. Use the current `sb_secret_...` key from the Supabase project API settings. Never prefix it with `NEXT_PUBLIC_`.
4. Add or edit:

```text
AUTH_EMAIL_CODE_VERIFICATION=true
AUTH_INVITE_ONLY=true
```

5. Apply these values to Production. Only add the secret to Preview if Preview uses a separate Supabase project and separate tester list.
6. Redeploy the latest production deployment.

Do not set either auth flag to true until its matching email template and database migration are ready. Otherwise YOVA can advertise an access path that is not usable yet.

## Part 8: founder access

After applying migration `202608070002_generation_reliability_dashboard.sql`, open Supabase **Authentication → Users**, copy the UUID for the founder account, then run this in **SQL Editor**:

```sql
insert into public.founder_accounts (user_id)
values ('PASTE_FOUNDER_USER_UUID_HERE')
on conflict (user_id) do nothing;
```

The private aggregate dashboard is then available at:

```text
https://yova-roan.vercel.app/founder/reliability
```

The tester invitation console is available to the same founder account at:

```text
https://yova-roan.vercel.app/founder/testers
```

## Verification checklist

Run this only after every part above is complete:

1. Open `/founder/testers` with the founder account and invite a new outside-test email.
2. Confirm Resend shows the delivered invitation and the founder console shows **Invite sent**.
3. Open the invitation in a private browser, press the explicit confirmation button, and confirm YOVA opens onboarding. If the link has expired, use **Send again** from the founder page.
4. Refresh and confirm the authenticated session remains active. The founder console should show **Joined**.
5. Sign out. Use **Sign in** with the same email and enter the six-digit code from the newest email. Also test the email button and confirm it shows YOVA's confirmation screen before signing in.
6. Confirm the returning account restores its existing cloud data instead of restarting onboarding.
7. Try an email that was never invited and confirm Supabase does not create an Auth user.
8. Repeat the invitation and returning-sign-in journey on a phone-sized browser.
