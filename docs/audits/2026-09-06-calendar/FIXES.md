**Calendar audit fixes — 6 September 2026**

Implemented the six groups of changes accepted after the audit. The original `AUDIT.md` and its characterization scripts describe the previous behaviour at `fa801f5`; they are historical evidence. The regression tests in `e2e/calendar-journeys.spec.ts` and `e2e/calendar-safety.spec.ts` now assert the corrected behaviour.

| Accepted change | Result |
| --- | --- |
| Prevent two-tab data loss | Browser writers share a Web Lock and merge only changed entities into the latest saved account state. Other tabs refresh automatically. Conflicting edits to the same event are rejected without discarding the open draft. Failed writes keep the draft available for retry. Each tab retains its own navigation state. |
| Interpret ordinary date phrases correctly | Quick Add and intake share date and clock parsing. Weekdays, next weekdays, named and ISO dates retain their intended local dates; deadline and preparation clocks stay distinct. Unsupported dates, past inferred starts and nonexistent DST times require correction. The confirmation displays the interpreted time range. |
| Make adjustment proposals respect the calendar | Zero availability stays zero. Manual workload, fixed commitments, overlaps, destination availability, plan order and linked outcome deadlines constrain proposals. Reviews show the exact source and destination times and workloads. Approval rechecks the proposal against the latest local calendar. Manual work gets an actionable Move option when one automatic plan change cannot fit the day. Overnight workload is divided between the actual days, including DST changes. |
| Make phone journeys usable | New mobile calendars default to Agenda, placed before secondary tools. Event details open in a native modal bottom sheet on phones and a visible inspector on desktop. Focus enters the details, Escape closes them, and focus returns to the original event. Week remains available. |
| Provide full manual editing and immediate Undo | The event editor supports title, type, date/time, duration, due time, course and fixed status. A deadline can be saved without inventing a preparation block. Undo is available in the immediate confirmation, including while event details remain open. |
| Make the calendar complete and navigable | Overlapping events get separate lanes and named conflicts. The week grid covers 24 hours and shows overnight continuations. All deadlines can be revealed, searched, filtered and inspected. Jump to date avoids repeated week navigation. The inline suggestion Move button opens the same working editor as other entry points. |

**Scope and remaining limits**

Manual events, availability and suggestion decisions remain account-scoped on this browser/device; this change fixes concurrent tabs, not cross-device cloud persistence. Existing learning plans and authoritative deadlines retain their existing repositories. Live signed-in cloud writes were not exercised in the preview browser tests.

Automatic capacity adjustment proposes one safe session move. It does not automatically rebuild multiple sessions into shorter blocks without a complete placement preview. Explicit missed-session recovery and its content-preserving split remain available and have separate regression coverage. Manual conflicts can be resolved through the event's Move editor; the system does not yet offer a ranked list of free slots.

Browser coverage uses isolated preview accounts, Chromium at 1280 × 720 and Pixel 7 emulation at 412 × 839, Europe/London and a fixed Wednesday, 2 September 2026. It includes real clicks, form edits, reloads and simultaneous browser tabs. Seeded learning plans and availability settings make the scheduling cases deterministic; browser storage failure is injected for the retry case. Touch dragging, other browser engines and physical devices were not tested. The editor provides a touch and keyboard alternative to dragging.

**Verification**

**66 browser checks passed** (58 calendar journeys and regressions plus 8 recovery/narrow-screen checks). **171 unit tests passed** across Calendar, scheduling and intake. TypeScript, lint on changed TypeScript files, and `git diff --check` passed. Final commands and results are recorded in `evidence/fix-validation.json`. Screenshot evidence is saved as `*-fixed-agenda.png`, `*-fixed-editor.png`, and `*-fixed-week.png` in the evidence directory.
