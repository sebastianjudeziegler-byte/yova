**Natural-language calendar series — 6 September 2026**

Click **Add**, describe a recurring commitment, and choose **Organize this**. YOVA opens an editable calendar preview with the title, first date/time, duration, repeat days and first four occurrences. The preview is a focused modal on desktop and a bottom sheet on phones, with the save action kept visible while scrolling. **Save to calendar** creates the series. Calendar Quick Add uses the same parser and preview.

Examples supported:

- “I have a class on communications from 11:30 to 12 every Monday and Wednesday.”
- “Review vocabulary every two days starting tomorrow at 6pm for 20 minutes.”
- “Communications class every other week on Mon and Wed from 11:30 to 12 until December 18.”
- “Walk weekdays at 7am for 12 occurrences.”

The repeat editor supports daily intervals, selected weekdays, intervals of several weeks, an inclusive last date, or a total occurrence count. Classes default to fixed time. Missing times and unsupported repeat patterns require correction in the preview. Unqualified clock ranges use 24-hour time; a supplied am/pm disambiguates the other end. The natural-language parser is deterministic and does not require an AI request or a generation allowance.

One saved series generates occurrences for the visible week and the upcoming scheduling window, including years ahead. It retains its original IANA time zone and local start time across daylight saving. A local clock time that does not exist during the spring transition is skipped; ambiguous autumn times resolve deterministically through the existing calendar date utility.

Moving, shortening, completing or cancelling an occurrence changes only that occurrence. **Edit → Apply changes to → Entire series** edits the shared timetable; the delete scope also offers the entire series. Previously customized occurrences retain their overrides. Both scopes have Undo, use the existing cross-tab storage lock and reject stale edits while preserving the draft. Recurring commitments participate in workload and conflict checks, including a Move destination beyond the current week.

Manual calendar data remains account-scoped on this browser/device. This feature does not add cross-device sync. The repeat model covers daily and weekly patterns for classes, personal items and free blocks. Monthly/yearly rules, holiday exclusions, recurring exams/deadlines, and multiple different events in one description are outside this implementation. Use separate descriptions for different events or different times.

**Verification**

**98 distinct browser checks passed**, including 18 recurring-calendar journeys, the existing Add and calendar suites, and navigation/narrow-phone checks. The final affected-suite rerun passed all 36 Add and recurring checks after correcting a mobile test's wait for Week rendering. **210 unit tests passed** across 21 files, including 31 recurrence tests. TypeScript, lint on the changed TypeScript files and `git diff --check` passed. Desktop and mobile form/preview screenshots were visually reviewed, and the save button is checked for full containment inside the dialog.

Browser journeys use isolated preview accounts, desktop Chromium and Pixel 7 emulation, Europe/London and a fixed Wednesday, 2 September 2026. They exercise the global Add handoff, exact communications example, two-day intervals with a finite count, reloads and 2028 navigation, single-occurrence exceptions, entire-series edit/delete/Undo, daylight saving, missing or unsupported inputs, future conflicts and simultaneous-tab edits. Unit coverage also checks validation, clock ranges, date parsing, interval/count/end-date semantics and workload projection. Final commands and results are recorded in `evidence/recurrence-validation.json`.
