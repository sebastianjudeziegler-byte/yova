# Outside tester email setup

YOVA already supports entering a six-digit email code. The remaining work is operational: give Supabase a production email provider, put the code in the hosted email template, enable the UI flag in Vercel, and redeploy.

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
  <p style="font-size:14px;line-height:1.6;color:#667085">Or use the secure sign-in link below in the browser where you requested it.</p>
  <p><a href="{{ .ConfirmationURL }}" style="display:inline-block;background:#0B1020;color:#FFFFFF;text-decoration:none;padding:13px 18px;border-radius:10px;font-weight:700">Open YOVA</a></p>
  <p style="font-size:13px;line-height:1.5;color:#98A2B3">If you did not request this email, you can ignore it.</p>
</div>
```

5. Save the template.

`{{ .Token }}` is the Supabase-provided six-digit one-time password. `{{ .ConfirmationURL }}` preserves the secure-link alternative.

## Part 4: enable the YOVA code box in production

1. In Vercel, open the YOVA project.
2. Open **Settings → Environment Variables**.
3. Add or edit:

```text
AUTH_EMAIL_CODE_VERIFICATION=true
```

4. Apply it to Production, Preview, and Development.
5. Redeploy the latest production deployment.

Do not set this flag to true before the Supabase template includes `{{ .Token }}`. Otherwise YOVA will show a code box while emails contain only a link.

## Part 5: founder reliability access

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

## Verification checklist

Run this only after all four parts above are complete:

1. Use a private window in Chrome and request a code with a new outside-test email.
2. Open the email in a different browser, copy the six-digit code, and enter it in the original Chrome private window.
3. Confirm YOVA opens onboarding and keeps the authenticated session after a refresh.
4. Sign out.
5. Repeat in Safari, requesting and entering the code entirely there.
6. Confirm Resend shows both delivered messages and Supabase Auth logs show successful OTP verification.

