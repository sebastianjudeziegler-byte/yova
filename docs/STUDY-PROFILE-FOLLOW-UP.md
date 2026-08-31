# Study Profile follow-up

This file records launch follow-ups that are intentionally outside the current
deployment scope.

## Legacy waitlist rows

The production audit on 2026-08-31 found two leads whose legacy
`waitlist_status` is `joined` but which have no confirmed double-opt-in record.
The new application reads report membership from response-scoped confirmation
records, so these rows are not treated as confirmed by the public report UI.

Before using Study Profile data for a marketing send:

1. Select recipients only from leads with a matching
   `study_profile_waitlist_confirmations.status = 'confirmed'` row.
2. Reconfirm or administratively quarantine the two legacy rows.
3. Rerun the legacy audit and require a result of zero.

Do not export or contact the two legacy rows as confirmed waitlist members.

## Traffic controls

Before paid or high-volume promotion, configure and verify the rate limits
listed in `docs/STUDY-PROFILE-SETUP.md`, including the broad Study Profile API,
private report routes, and `/api/system/status`.
