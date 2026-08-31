# YOVA Study Profile setup

The public funnel lives at `/study-profile`. It does not require YOVA authentication or OpenAI.

## Production configuration

Apply every checked-in Supabase migration through `202608310002_study_profile_waitlist_double_opt_in.sql`. The Study Profile sequence is:

1. `202608110001_study_profile_lead_funnel.sql`
2. `202608310001_study_profile_revamp_waitlist.sql`
3. `202608310002_study_profile_waitlist_double_opt_in.sql`

Do not skip an earlier repository migration just because it is unrelated to Study Profile. The local and remote migration histories must match before deployment.

Then add these server-only variables to the Vercel project:

```text
SUPABASE_SECRET_KEY=sb_secret_...
RESEND_API_KEY=re_...
STUDY_PROFILE_FROM_EMAIL=YOVA <reports@updates.yovaapp.com>
STUDY_PROFILE_REPLY_TO=optional-monitored-address@yovaapp.com
SITE_URL=https://www.yovaapp.com
```

`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` remain required by the existing app. `SUPABASE_SECRET_KEY` must never use the `NEXT_PUBLIC_` prefix.

Without the Supabase secret key, production submissions fail closed instead of pretending that a lead was saved. In local development and Playwright, the feature uses a process-local repository so the complete flow can be tested without cloud credentials. That fallback is not used as production persistence.

Without the Resend variables, the report still appears immediately and its private link still works; report email delivery is marked as skipped. A waitlist request cannot be completed without its confirmation email, so Resend is required for a working production waitlist.

## Production readiness contract

Production deployment checks call the service-role-only `study_profile_public_readiness_v1` database function. It must return this exact contract:

```json
{
  "contractVersion": "202608310002",
  "ready": true,
  "pendingConfirmationColumns": true,
  "confirmationRpcs": true,
  "reportEmailCooldown": true,
  "serviceRoleBoundary": true
}
```

The deployment must stop if the function is unavailable, the version is stale, a key is missing, or any capability is false. Production readiness also validates the shape of the Resend key and transactional sender configuration. It cannot prove that a message reaches an inbox or that Vercel Firewall rules are published, so both must still be verified with the deployed smoke test.

## Resend without disturbing Google Workspace

Use a dedicated sending subdomain such as `updates.yovaapp.com` for Study Profile mail.

1. Add `updates.yovaapp.com` as the sending domain in Resend.
2. Add only the DNS records Resend supplies for that subdomain.
3. Do not remove or replace any existing root (`@`) or Google Workspace MX records.
4. Do not add a second SPF TXT record at the same hostname. A dedicated subdomain normally avoids this conflict entirely.
5. After Resend verifies the subdomain, use an address such as `reports@updates.yovaapp.com` for `STUDY_PROFILE_FROM_EMAIL`.
6. Use an existing monitored Google Workspace mailbox as `STUDY_PROFILE_REPLY_TO` if replies should be accepted.

The report and waitlist confirmation emails are transactional responses to a user request. Joining the waitlist is a separate explicit action at the email gate, on the report, or in the landing-page waitlist form. The user must affirm that they are at least 13, request a confirmation email, open its private page, and select the confirmation button. Opening the link alone does not join the waitlist.

Do not send marketing waitlist campaigns until every marketing email has a working unsubscribe control and Resend bounce and complaint suppression is in place and tested. A confirmed waitlist record is not permission to skip those controls.

## Required public-traffic protection

The application rejects cross-origin or non-JSON browser writes, bounds streamed request bodies, applies an in-process rate limit, and enforces database-backed cooldowns for waitlist confirmation and report delivery. The in-process limiter is scoped to one server instance, so it is not enough for public traffic.

Before launch, configure and verify Vercel Firewall rate limits for the Study Profile write routes. Distributed edge limiting is required for public traffic. This is an operational release step, not an application setting, and the readiness contract cannot verify it. Recommended starting rules per IP are:

- `/api/study-profile/responses`: 5 requests per 10 minutes.
- `/api/study-profile/waitlist`: 5 requests per 10 minutes.
- `/api/study-profile/waitlist/confirm`: 10 requests per 10 minutes.
- Request paths beginning with `/api/study-profile/interest/`: 10 requests per 10 minutes.
- Request paths beginning with `/api/study-profile/`: 150 requests per 10 minutes as a broad ceiling that also covers analytics and private-report API reads.
- Request paths beginning with `/study-profile/report/`: 120 requests per 10 minutes to limit repeated private-report reads.
- `/api/system/status`: 60 requests per 10 minutes so public status checks cannot create unbounded database readiness work.

Keep the existing application and database limits in place as additional layers. Review real traffic and adjust edge thresholds if legitimate users are blocked. Add a low-friction challenge such as Turnstile only if abuse continues.

## Data and security boundary

- `study_profile_leads` holds one normalized-email lead record and consent/interest state.
- `study_profile_responses` holds every retake and its immutable model/report state.
- `study_profile_waitlist_confirmations` holds pending and completed confirmation evidence. Only a SHA-256 confirmation-token hash is stored while a request is usable; raw tokens are never stored.
- `study_profile_events` holds bounded anonymous funnel events; it does not accept email, answer values, free text, or report tokens.
- Row-level security is enabled with no `anon` or `authenticated` policies.
- Validated Next.js route handlers use the server-only Supabase secret client.
- Report URLs contain a 256-bit random token. Only its SHA-256 hash is stored.
- Confirmation URLs put a separate one-time token in the URL fragment, which is not sent in the page request. Confirmation requires a visible user action that sends the token in a protected POST request.
- Private report and confirmation responses are uncached, use a no-referrer policy, and send `noindex` directives.

## Analytics

No external analytics provider is required. Funnel events are written to `study_profile_events`, and captured responses provide profile-distribution data. The public event schema is closed and privacy-bounded.

The browser creates the Study Profile visitor ID in page memory. It does not write that ID or first-touch attribution to `localStorage` or `sessionStorage`. A new page load creates a new browser-side visitor ID. The bounded identifier sent with accepted events may still be stored in the database with those event records and associated with a response or waitlist request created from the same page.

Do not send public traffic until the distributed edge-protection step above is complete and verified.

## Manual verification

Local:

1. Run `pnpm dev` and open `http://localhost:3000/study-profile`.
2. Start the assessment, answer several questions, refresh, and confirm progress returns.
3. Use Back, change an answer, finish all 14 numbered steps, and confirm the sequence never switches to a separate context counter.
4. Submit an email, affirm that you are at least 13, and confirm the email is used to deliver the private report.
5. Confirm the full report appears even without Resend, and refresh the private `/study-profile/report/<token>` URL.
6. Request to join the waitlist and confirm the page says to check your email. Confirm that the lead is not marked as joined yet.
7. Open the confirmation email. Confirm that opening its private page does not join the waitlist, then select the confirmation button and confirm the joined state.
8. Submit the landing-page waitlist form without taking the quiz, including the 13-or-older affirmation, and complete the same confirmation flow.
9. Request another report email for the same normalized address inside the 15-minute delivery cooldown and confirm no second email is sent.
10. Create both share-image formats and confirm neither contains the private report URL.
11. Open an altered token and confirm the generic unavailable-link page.
12. Repeat at 360 and 390 CSS pixels wide and with a desktop viewport.

Deployed:

1. Apply all migrations through `202608310002`, set the Vercel variables, configure the Vercel Firewall rules, and redeploy.
2. Confirm the deployment readiness check reports the exact `202608310002` Study Profile database contract and all five fields are true.
3. Submit a fresh profile at `https://www.yovaapp.com/study-profile`.
4. Confirm one lead and one response were created, the report email was delivered, and its link opens the same stored report in a private browser window.
5. Retake with the same email and confirm one lead now owns two response rows and both old and new links work.
6. Request the waitlist confirmation, verify the pending state, and complete it using the explicit confirmation button.
7. Confirm event rows contain only supported names and bounded context.
8. Confirm Vercel Firewall logs show the intended rules and that a controlled excess request receives `429` without affecting normal use.
9. Confirm the Resend dashboard shows the report and confirmation messages as transactional mail. Do not start a marketing campaign during this check.
