**YOVA calendar audit — realistic user journeys**

Audited 6 September 2026 against commit `fa801f5`. Product code was left unchanged. The calendar has useful foundations: explicit confirmation before adding work, linked preparation plans, reversible manual changes, and recovery flows that protect learning progress. My recommendation is to fix persistence, date interpretation, and scheduling consistency before expanding the number of calendar views.

**What was tested**

Local Next.js development preview, isolated browser accounts, Chromium desktop (1280 × 720) and Pixel 7 emulation (412 × 839). Audit scenarios used Europe/London and a fixed Wednesday, 2 September 2026, 11:00 BST to make date interpretation reproducible. The existing schedule-date suite also runs in Europe/London. No production accounts, real emails, paid AI generation, or live cloud writes were used.

The browser tests use normal clicks, form entry, reloads, and a second browser tab. Existing fixture helpers provide a saved learning plan and suggestions for states that would otherwise need generated content. The original resize regression uses dispatched drag events; it does not establish that touch dragging works. The new interaction checks use real Playwright pointer actions.

Validation: **32 existing browser regressions passed**, **22 distinct audit characterization cases were exercised** (all latest checks passed), and **100 calendar/scheduling unit tests passed**. The six extra regression cases covered missed-session splitting into runnable work and continuing saved work after allowance exhaustion. Audit files passed ESLint and the project passed TypeScript checking. The [validation summary](/Users/sebastianziegler/Documents/YOVA/docs/audits/2026-09-06-calendar/evidence/validation-summary.json) records the latest result per case and the source reports. A pointer-access assertion in the overlap check was narrowed after repeat runs showed variable access; identical event geometry and missing overlap diagnosis were consistently reproduced. The audit tests are characterizations: a pass means the documented behaviour was reproduced, including defects. They are kept outside the default regression suite.

**Journeys and findings**

**1. “I have YOVA open in two tabs while planning my week.” — P1, data loss**

Reproduction: open Calendar in two tabs of the same browser account; add “Read lab notes” in tab A; add “Meet study group” in tab B; reload A. Only “Meet study group” remains in saved calendar storage. The first event was saved successfully and is then lost.

The component updates its in-memory account snapshot and writes that complete snapshot back to storage. It does not reconcile changes from the other tab. Even UI state changes share this persistence path, increasing the scope of the problem. [Browser evidence](/Users/sebastianziegler/Documents/YOVA/docs/audits/2026-09-06-calendar/evidence/desktop-chromium-two-tab-loss.json); [calendar-screen.tsx:232](/Users/sebastianziegler/Documents/YOVA/src/components/calendar/calendar-screen.tsx:232); [persistence.ts:52](/Users/sebastianziegler/Documents/YOVA/src/lib/calendar/persistence.ts:52).

Recommendation: persist event-level mutations against a revision, refresh or merge concurrent changes, and subscribe to changes from other tabs. A browser `storage` listener alone is not sufficient protection against concurrent stale writes. Establish a single durable account repository for manual events, availability and suggestions. The current UI explicitly says manual events remain on this device, so cross-device absence is a disclosed product limitation, separate from the reproduced two-tab data-loss bug.

Acceptance: add/edit different events in two tabs, refresh both, and retain both changes; concurrent edits to the same event produce a recoverable conflict. Once cloud persistence ships, repeat across laptop and phone and verify offline retry without duplication.

**2. “My chemistry class is Friday at 2pm.” — P1, incorrect dates and times**

On Wednesday, the phrase “Chemistry class Friday at 2pm for 60 minutes” produces Wednesday 2pm. “Meet tutor next Monday at 10am” also becomes Wednesday, already in the past. “Review biology September 10 at 6pm” becomes September 2. “Biology exam due Friday at 2pm” produces Wednesday 2pm as Calendar time and Friday 11:59pm as Due time.

The confirmation step is valuable but cannot compensate for confidently misreading ordinary date phrases. The block parser understands tonight/tomorrow and a clock, but does not resolve the other date expressions into the block date. [Browser evidence](/Users/sebastianziegler/Documents/YOVA/docs/audits/2026-09-06-calendar/evidence/desktop-chromium-weekday-parsing.json); [quick-add.ts:94](/Users/sebastianziegler/Documents/YOVA/src/lib/calendar/quick-add.ts:94).

Recommendation: share one date/time interpretation model between Quick Add and plan creation. Explicitly distinguish an event time, a deadline, and an optional preparation block. Display a plain-language summary such as “Fri 4 Sep, 2–3pm · repeats: never”. When a date or time cannot be interpreted, request the missing field rather than substituting today. Apply supplied clock times to the relevant deadline.

Acceptance: weekdays, next weekdays, explicit dates, date plus clock, past times, and daylight-saving boundaries preserve the learner’s intended local date and time.

**3. “I cannot study today; help me move the work.” — P1, invalid recommended schedule**

A saved 40-minute session was due Wednesday at 6pm. Thursday had a fixed lab at 6–7pm and a saved availability of zero minutes. Entering zero minutes for Wednesday produced a proposal showing **10 minutes available**. Its copy claimed to avoid another crowded day, but did not disclose the exact destination. After approval, the session moved to Thursday at 6pm, overlapping the lab and violating Thursday’s zero-minute availability. Calendar then reported the conflict and overload it had just created.

A second check added a manual 90-minute essay-writing block and set today’s availability to 30. “Needs attention” correctly reported 90 planned minutes, while the adjustment preview said **“Nothing is scheduled today”** and **0 minutes planned**.

These are related inconsistencies: the adjustment engine considers plan sessions, while the calendar workload model includes more types of work; destination selection lacks fixed events and availability overrides; and the engine clamps capacity to 10–180 minutes while the UI accepts 0–720. [Browser evidence](/Users/sebastianziegler/Documents/YOVA/docs/audits/2026-09-06-calendar/evidence/desktop-chromium-capacity-before.json); [Browser evidence](/Users/sebastianziegler/Documents/YOVA/docs/audits/2026-09-06-calendar/evidence/desktop-chromium-capacity-after.json); [Browser evidence](/Users/sebastianziegler/Documents/YOVA/docs/audits/2026-09-06-calendar/evidence/desktop-chromium-manual-capacity.json); [calendar-screen.tsx:632](/Users/sebastianziegler/Documents/YOVA/src/components/calendar/calendar-screen.tsx:632); [agenda-insights.ts:142](/Users/sebastianziegler/Documents/YOVA/src/lib/scheduling/agenda-insights.ts:142); [agenda-insights.ts:276](/Users/sebastianziegler/Documents/YOVA/src/lib/scheduling/agenda-insights.ts:276).

Recommendation: use the same calendar constraints for overload detection, candidate selection, and final validation. Respect zero as zero. Include all occupied intervals, destination availability, session order, and deadlines. The review should name the block, show old and proposed dates/times, explain why the slot is feasible, and show both days’ resulting workload. Revalidate on approval. If manual work cannot be adjusted automatically, say that explicitly and offer its Move action.

Acceptance: an approved change must not introduce a new conflict or capacity violation. “No time today” never leaves a mandatory ten-minute allocation. The preview and calendar agree on workload totals and item scope.

**4. “I’m on my phone; tap this afternoon’s block to change it.” — P1 for the mobile journey**

With one saved event, the week board begins 1,280 CSS pixels down the page, beyond the first 839-pixel viewport. After tapping the Thursday event, its details appear entirely above the visible area: top −1,273px, bottom −847px. Focus remains outside the details. Desktop also opens the details partly above the viewport after scrolling to the event.

Containment tests pass because nothing overflows the page horizontally. That does not establish that the user can see the result of a tap. [Browser evidence](/Users/sebastianziegler/Documents/YOVA/docs/audits/2026-09-06-calendar/evidence/mobile-chromium-select-visibility.json); [Screenshot](/Users/sebastianziegler/Documents/YOVA/docs/audits/2026-09-06-calendar/evidence/mobile-chromium-select-visibility.png); [calendar-screen.tsx:358](/Users/sebastianziegler/Documents/YOVA/src/components/calendar/calendar-screen.tsx:358); [calendar.css:1649](/Users/sebastianziegler/Documents/YOVA/src/app/calendar.css:1649).

Recommendation: open event details in a focused mobile bottom sheet, with the event title and Edit/Move/Done immediately visible. Restore focus to the event on close. Default phone users to a compact Today/Agenda list, with the week grid available as a secondary view. Move explanatory content below the next actionable item. On desktop, keep the inspector in view or explicitly reveal it.

Acceptance: tapping an event reveals its title and primary actions inside the viewport without additional scrolling; keyboard and screen-reader focus follow the same interaction.

**5. “The lecture is longer now; fix its title and duration.” — P2, incomplete event editing**

Manual event details expose Mark done, Move and Delete, plus Build plan for items with deadlines. There is no edit form for title, type, due time, fixed status or numeric duration. Manual duration is available through a grid drag handle, which is not a sufficient editing method for keyboard and phone users. The UI nevertheless describes some manual events as “Fully editable”.

Deleting a class and restoring it through Recent schedule changes works, but this requires discovering a separate lower-page disclosure. [Browser evidence](/Users/sebastianziegler/Documents/YOVA/docs/audits/2026-09-06-calendar/evidence/desktop-chromium-manual-edit.json); [Screenshot](/Users/sebastianziegler/Documents/YOVA/docs/audits/2026-09-06-calendar/evidence/desktop-chromium-manual-edit.png); [calendar-screen.tsx:1691](/Users/sebastianziegler/Documents/YOVA/src/components/calendar/calendar-screen.tsx:1691); [calendar-screen.tsx:2052](/Users/sebastianziegler/Documents/YOVA/src/components/calendar/calendar-screen.tsx:2052).

Recommendation: provide one consistent event editor for manual items and deadline items, with labelled date/time, duration, due date, fixed/flexible, and course fields. Keep learning-session duration changes distinct because they can rebuild several sessions. Show an immediate Undo action after deletion, moving, and completion, backed by the existing history.

Acceptance: correct every user-entered event field using a mouse, keyboard, or touch, without deleting and recreating the item.

**6. “I have a doctor’s appointment and a study group at the same time.” — P2, collisions are hard to see or resolve**

Two non-fixed personal commitments at Thursday 2–3pm receive identical grid rectangles. Pointer access varied between runs, so permanent unclickability is not established; the overlap itself and missing conflict diagnosis are reproducible. There is an overload message for their combined 120 minutes but no overlap-specific conflict. The conflict detector handles fixed/fixed and fixed-manual/YOVA pairs, leaving other occupied overlaps unreported. [Browser evidence](/Users/sebastianziegler/Documents/YOVA/docs/audits/2026-09-06-calendar/evidence/mobile-chromium-overlap.json). Fixed/flexible should describe whether an item can move; it should not imply that simultaneous attendance is possible. [insights.ts:405](/Users/sebastianziegler/Documents/YOVA/src/lib/calendar/insights.ts:405); [calendar.css:1027](/Users/sebastianziegler/Documents/YOVA/src/app/calendar.css:1027).

Recommendation: lay overlapping events out in separate columns or a clearly marked stack with an accessible list. Detect overlaps across all occupied work, including different learning plans, and offer a concrete resolution. Treat free-time blocks separately from commitments.

Acceptance: both overlapping items remain individually discoverable and selectable; the conflict names both items and shows alternative times.

**7. “I study before class or late at night.” — P2, misleading grid placement**

A 6:30am event renders at the grid’s 8am top edge. An 11pm event is placed at 98% of the 8am–10pm grid and receives a negative calculated height, then falls back to the minimum display height. The text labels retain the real times, but spatial placement is inaccurate. [Browser evidence](/Users/sebastianziegler/Documents/YOVA/docs/audits/2026-09-06-calendar/evidence/desktop-chromium-outside-hours.json); [calendar-screen.tsx:1880](/Users/sebastianziegler/Documents/YOVA/src/components/calendar/calendar-screen.tsx:1880).

Recommendation: support the full day with a configurable visible window, automatically reveal out-of-window events, and split overnight blocks at the day boundary. Never clamp a saved time to a different visual time without a clear overflow indicator.

Acceptance: 6:30am, 11pm, and overnight events render at their real times and can be selected on each relevant day.

**8. “I need to see everything due across my courses.” — P2, incomplete overview**

With seven saved assignments, Coming up shows “7 open” but renders only five rows and provides no Show all action. Week navigation is the only complete calendar view; there is no date jump, search or full outcomes list in this surface. This is a problem once students have more than a handful of deadlines. [Browser evidence](/Users/sebastianziegler/Documents/YOVA/docs/audits/2026-09-06-calendar/evidence/desktop-chromium-outcome-overview.json); [calendar-screen.tsx:1515](/Users/sebastianziegler/Documents/YOVA/src/components/calendar/calendar-screen.tsx:1515).

Recommendation: first add “View all 7” leading to a searchable, filterable chronological list, with open/complete and course filters. Then add a month overview and a direct date picker. The all-outcomes list is more useful immediately than several partially developed calendar views.

Acceptance: every open deadline is reachable from the overview and by title/course search, including outcomes several months away.

**9. “Move the suggestion shown under Your Day.” — P2, non-working control**

The suggestion’s inline Move button does not show the New time editor. It sets the move-panel state without selecting the block; that editor only renders inside the selected block’s details. The Details → Move route is available as a workaround. This check used a seeded pending suggestion, so it proves the control’s behaviour when that state is present, not how frequently suggestions are generated. [Browser evidence](/Users/sebastianziegler/Documents/YOVA/docs/audits/2026-09-06-calendar/evidence/desktop-chromium-suggestion-move.json); [calendar-screen.tsx:1324](/Users/sebastianziegler/Documents/YOVA/src/components/calendar/calendar-screen.tsx:1324).

Recommendation: use one shared action that selects the event and opens its move editor, regardless of whether the user starts from Your Day, the grid, or an attention message.

Acceptance: every Move entry point shows the same editor with the current event and time populated.

**10. “I just learned that an essay is due Friday.” — P2, unnecessary capture friction**

Quick Add understands the due date but disables both Save to calendar and Save and build plan until a separate Calendar time is filled. The user must invent a study commitment merely to remember a deadline. [Browser evidence](/Users/sebastianziegler/Documents/YOVA/docs/audits/2026-09-06-calendar/evidence/desktop-chromium-deadline-only.json); [Screenshot](/Users/sebastianziegler/Documents/YOVA/docs/audits/2026-09-06-calendar/evidence/desktop-chromium-deadline-only.png); [calendar-screen.tsx:1579](/Users/sebastianziegler/Documents/YOVA/src/components/calendar/calendar-screen.tsx:1579).

Recommendation: allow deadline-only capture with an optional due time, display it in the due-date rail and outcomes list, and offer “Schedule preparation” afterward. Keep “Essay due Friday” and “Write essay tonight” as distinct linked objects. Converting to a plan already has useful deduplication behaviour that should be retained.

Acceptance: a deadline can be captured, edited, and later expanded into preparation work without creating a fake time block or duplicate outcome.

**What to preserve**

The existing browser suite verifies Quick Add confirmation and persistence, undo, cancellation of plan creation without losing the manual deadline, conversion to one linked plan/outcome, exact session targeting, refusal of invalid past/unchanged session moves, opt-in adjustments, and recovery from an overfull plan. These are meaningful strengths. Keep the explicit control over automatic changes, evidence-based preparation progress, and protection of saved learning work while repairing the surrounding calendar experience. The additional recovery browser checks also confirmed that missed inside/outside sessions split into runnable ten-minute parts and saved sessions remain resumable after generation allowance is spent.

**The user experience I would build next**

A student should be able to capture “Essay due Friday” in one step, optionally connect it to a plan, and see concrete preparation blocks around existing classes. Each morning, Today should answer “What should I do next?” with Start/Continue and the next deadline. When the day changes, entering “0 minutes today” should produce a named, conflict-free before/after proposal. Tapping any item should open the same editable details; completing or deleting it should produce an immediate Undo action. The week and all-deadlines list should agree across tabs and devices.

After those essentials, support repeating weekly classes with term end dates and exceptions, then calendar import/export. Recurrence is absent from the current manual-event schema and editor; this is a workflow enhancement, not a failed recurrence test. It would remove repeated manual entry for a realistic university timetable. Avoid prioritizing additional decorative views ahead of these daily tasks.

Suggested implementation sequence: (1) prevent data loss and wrong dates; (2) make adjustment proposals use a single constraints model; (3) repair mobile selection and add full event editing; (4) improve collision rendering, time-range coverage, and deadline-only capture; (5) add a full outcomes list and recurring timetable support.

**Limits of the audit**

This validates local browser behaviour and inspects the relevant implementation. It does not certify production authentication, real cross-device sync, backend persistence under network failure, actual iOS Safari, native touch dragging, daylight-saving transitions, notifications, or large-account performance. Cross-device manual-event limitations were verified from the implementation and the UI disclosure, rather than a real signed-in two-device test. The browser checks for suggested adjustments and pending suggestions use representative fixtures.

**Re-run**

From the repository root:

```sh
pnpm exec playwright test e2e/calendar-tab.spec.ts e2e/agenda-scheduling.spec.ts e2e/plan-schedule-date.spec.ts
pnpm exec playwright test e2e/core-learning-loop.spec.ts --grep 'an overdue outside teaching-first|an overdue arbitrary inside|spent allowance still permits'
pnpm exec playwright test --config docs/audits/2026-09-06-calendar/playwright.config.ts
pnpm exec vitest run src/lib/calendar src/lib/scheduling src/components/calendar/calendar-interaction-contract.test.ts
```

The audit-specific config uses the existing isolated preview server configuration. JSON observations, full-page images, viewport images and the final Playwright result are in the adjacent `evidence` directory.
