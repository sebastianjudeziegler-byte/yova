# YOVA founder operations for the private alpha

This is the small operating loop behind the product. It is intentionally simple enough to use before YOVA needs a dedicated administrator dashboard.

## Error review

Open the Supabase Table Editor and select `error_reports`.

1. Filter `status` to `open`.
2. Sort `occurred_at` from newest to oldest.
3. Look for repeated combinations of `surface` and `error_code`.
4. If a row has a `request_id`, search that value in the corresponding Vercel function logs.
5. Reproduce the journey locally before changing code.
6. After confirming the outcome, set the row to `resolved` or `ignored` in the Supabase dashboard.

The fields mean:

- `surface`: which broad product area failed;
- `error_code`: a stable label written by YOVA's code;
- `route_path`: which screen was open, without query-string data;
- `request_id`: a bridge to a specific server request when one exists;
- `error_digest`: Next.js's opaque reference for a render failure;
- `occurred_at`: when it happened;
- `status`: whether it still needs review.

YOVA deliberately does **not** store raw error messages, stack traces, goals, source material, questions, tutor messages, or learner answers in this table. If more context is needed, ask the tester through the support workflow instead of expanding the monitoring payload.

## Support review

Open `support_requests` in the Supabase Table Editor.

1. Filter `status` to `open`.
2. Review account and session blockers before ordinary feedback.
3. Update the status to `in_progress`, then `resolved` or `closed`.
4. Never copy uploaded material or tutor conversations into a separate tracking tool unless the tester knowingly supplies it for support.

## Private-alpha rhythm

- **Before an invite:** run the production smoke test and complete one real sign-in → plan → session journey.
- **Daily during testing:** check open errors, open support requests, and Vercel deployment health.
- **Twice weekly:** inspect the onboarding → plan → session funnel in `product_events`.
- **After every release:** verify the newest GitHub commit is the commit Vercel deployed.

This is the operational difference between a demo and an alpha: the product does not merely work on the founder's laptop; there is a repeatable way to notice, investigate, and close problems experienced by real testers.
