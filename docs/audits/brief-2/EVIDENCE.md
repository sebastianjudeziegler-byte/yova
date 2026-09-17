# Brief 2: evidence

## Precondition check: one revision on production (17 Sept 2026)

The brief requires one revision on production before building. It failed, so work stopped and was reported.

1. **Photosynthesis Test Preparation** (test the next day): three previews loaded with no server error. Each Confirm was disabled by the old planner's "… does not fit before the deadline", and each preview was cancelled. Nothing changed.
2. **Throwaway plan "Water Cycle Quiz Foundations"** (quiz 8 Oct, created by the founder):
   - Marking "Quiz Application and Review" learned elsewhere previewed, confirmed and showed its receipt. After a reload the change was saved.
   - **Undo failed** with "A changed session no longer matches this preview. Review its latest version." After a reload the change was still there.

### Cause

`applySessionRevisionPatches` (`src/lib/plan-revision/revision-patch.ts`) checks each live session against the copy stored with the change, comparing canonical JSON text.

- The database returns `scheduled_for` as `2026-09-19T08:00:00+00:00`.
- The stored proposal holds the same moment as `2026-09-19T08:00:00.000Z`.

Every Undo of a saved change on a plan read back from the database therefore refused. Apply was unaffected, because its preview is built from the same database read.

### Fix (branch `fix-revision-undo-dates`, founder-approved before Brief 2)

The canonical comparison treats a full ISO 8601 timestamp with a zone as a moment in time. A time that really changed still refuses, and text that only resembles a date is compared as text.

### Red, then green

| Test | Red | Green |
|---|---|---|
| `src/app/api/plans/adjust/living-plan-route.migrated.test.ts`, "saves a change and then undoes it" (real migrated database) | CI run 35211900847 on 36ae0c8. Apply passed, and the database wrote the time with `+00:00`. Then: `undo refused: A changed session no longer matches this preview. Review its latest version.` This is the production message. | CI on the fix commit (below) |
| `src/lib/plan-revision/revision-patch.test.ts` (4) | 2 failed without the fix (the same moment in two formats; nested timestamps and another zone) | 4 pass |

The unit test pushed with 36ae0c8 also failed for a second, unrelated reason: it built its two sessions from separate calls to a fixture that issues fresh route ids. The fixture now builds both from one plan. Red and green above were re-run locally against that corrected test, with and without the fix.
