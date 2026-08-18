# YOVA Study Profile setup

The public funnel lives at `/study-profile`. It does not require YOVA authentication or OpenAI.

## Production configuration

Apply the migration in `supabase/migrations/202608110001_study_profile_lead_funnel.sql`, then add these server-only variables to the Vercel project:

```text
SUPABASE_SECRET_KEY=sb_secret_...
RESEND_API_KEY=re_...
STUDY_PROFILE_FROM_EMAIL=YOVA <reports@updates.yovaapp.com>
STUDY_PROFILE_REPLY_TO=optional-monitored-address@yovaapp.com
SITE_URL=https://www.yovaapp.com
```

`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` remain required by the existing app. `SUPABASE_SECRET_KEY` must never use the `NEXT_PUBLIC_` prefix.

Without the Supabase secret key, production submissions fail closed instead of pretending that a lead was saved. In local development and Playwright, the feature uses a process-local repository so the complete flow can be tested without cloud credentials. That fallback is not used as production persistence.

Without the Resend variables, the report still appears immediately and its private link still works; email delivery is marked as skipped.

## Resend without disturbing Google Workspace

Use a dedicated sending subdomain such as `updates.yovaapp.com` for Study Profile mail.

1. Add `updates.yovaapp.com` as the sending domain in Resend.
2. Add only the DNS records Resend supplies for that subdomain.
3. Do not remove or replace any existing root (`@`) or Google Workspace MX records.
4. Do not add a second SPF TXT record at the same hostname. A dedicated subdomain normally avoids this conflict entirely.
5. After Resend verifies the subdomain, use an address such as `reports@updates.yovaapp.com` for `STUDY_PROFILE_FROM_EMAIL`.
6. Use an existing monitored Google Workspace mailbox as `STUDY_PROFILE_REPLY_TO` if replies should be accepted.

The report email is transactional. Joining the waitlist is a separate action on the report. Do not send waitlist email until an unsubscribe and suppression workflow is in place.

## Pre-broad-launch decisions

The immediate no-login funnel does not verify ownership of the submitted email address. A waitlist signup is therefore a self-asserted signal, not double-opt-in proof. Before using these records for broad marketing, choose and implement an email-only verification or double-opt-in flow that is not returned to the submitting browser. Keep the report itself immediately visible even if that verification email fails.

Treat durable bot and abuse protection as a second release decision before sending high-volume traffic. The application rejects cross-origin/non-JSON browser writes, bounds streamed request bodies, and applies an in-process rate limit, but the in-process limiter is scoped to one server instance. Configure Vercel Firewall rate limits or an equivalent distributed limiter, add a per-address delivery cooldown, and consider a low-friction challenge such as Turnstile if abuse appears.

## Data and security boundary

- `study_profile_leads` holds one normalized-email lead record and consent/interest state.
- `study_profile_responses` holds every retake and its immutable model/report state.
- `study_profile_events` holds bounded anonymous funnel events; it does not accept email, answer values, free text, or report tokens.
- Row-level security is enabled with no `anon` or `authenticated` policies.
- Validated Next.js route handlers use the server-only Supabase secret client.
- Report URLs contain a 256-bit random token. Only its SHA-256 hash is stored.
- Report pages are `noindex`, excluded from `robots.txt`, uncached, and use a no-referrer policy.

## Analytics

No external analytics provider is required. Funnel events are written to `study_profile_events`, and captured responses provide profile-distribution data. The public event schema is closed and privacy-bounded.

Before sending high-volume TikTok traffic, complete the durable edge-protection decision described above; the repository's current in-memory limiter is only a first layer.

## Manual verification

Local:

1. Run `pnpm dev` and open `http://localhost:3000/study-profile`.
2. Start the assessment, answer several questions, refresh, and confirm progress returns.
3. Use Back, change an answer, finish all 12 questions, and complete the two context screens.
4. Submit an email and confirm it is used only to deliver the private report.
5. Confirm the full report appears even without Resend, and refresh the private `/study-profile/report/<token>` URL.
6. Join the waitlist and confirm the success message remains after a refresh.
7. Open an altered token and confirm the generic unavailable-link page.
8. Repeat at 320, 375, and 390 CSS pixels wide and with a desktop viewport.

Deployed:

1. Apply the migration and Vercel variables, then redeploy.
2. Submit a fresh profile at `https://www.yovaapp.com/study-profile`.
3. Confirm one lead and one response were created, the report email was delivered, and its link opens the same stored report in a private browser window.
4. Retake with the same email and confirm one lead now owns two response rows and both old and new links work.
5. Confirm the waitlist choice updates the existing lead without asking for email again.
6. Confirm event rows contain only supported names and bounded context.
