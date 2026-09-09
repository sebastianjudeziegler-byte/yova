# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: calendar-recurring.spec.ts >> concurrent edits to a recurring series preserve the second tab's unsaved draft
- Location: e2e/calendar-recurring.spec.ts:156:5

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: locator.click: Test timeout of 30000ms exceeded.
Call log:
  - waiting for getByRole('button', { name: 'Calendar', exact: true })

```

# Page snapshot

```yaml
- generic [ref=e1]:
  - button "Open Next.js Dev Tools" [ref=e7] [cursor=pointer]
  - alert [ref=e11]
  - generic [ref=e12]:
    - link "Skip to main content" [ref=e13] [cursor=pointer]:
      - /url: "#main-content"
    - banner [ref=e14]:
      - generic [ref=e15]: "Y"
      - navigation "Main navigation" [ref=e17]:
        - button "Home" [ref=e18] [cursor=pointer]
        - button "Learning" [ref=e20] [cursor=pointer]
        - button "Calendar" [ref=e22] [cursor=pointer]
        - button "Ask YOVA" [ref=e24] [cursor=pointer]
        - button "You" [ref=e26] [cursor=pointer]
      - generic [ref=e28]:
        - button "Add to YOVA" [ref=e29] [cursor=pointer]:
          - generic [ref=e31]: Add
        - generic [ref=e32]:
          - generic "Learner · Private alpha" [ref=e33]: L
          - button "Sign out on this device" [ref=e34] [cursor=pointer]
    - main [ref=e38]:
      - generic [ref=e39]:
        - generic [ref=e40]:
          - generic [ref=e41]:
            - text: CALENDAR
            - heading "Plan the work that gets you there" [level=1] [ref=e42]
            - paragraph [ref=e43]: 1 open blocks · 0 upcoming outcomes · manual changes stay under your control.
          - button "Add to YOVA" [ref=e44] [cursor=pointer]
        - generic [ref=e46]:
          - complementary "Calendar tools and today" [ref=e47]:
            - region [ref=e48]:
              - generic [ref=e49]:
                - generic [ref=e50]:
                  - text: QUICK ADD
                  - heading "Put something on your calendar" [level=2] [ref=e51]
                - generic [ref=e52]: ⌘K
              - generic [ref=e53]:
                - textbox "Quick add a calendar item" [ref=e54]:
                  - /placeholder: Communications class every Mon and Wed, 11:30–12
                - button "Parse quick add" [ref=e55] [cursor=pointer]
              - generic [ref=e58]: Describe the item in your own words. YOVA shows what it understood before saving. Manual items stay on this device; learning plans and deadlines keep their existing sync.
            - dialog [ref=e59]:
              - region [ref=e60]:
                - generic [ref=e61]:
                  - generic [ref=e62]: Class
                  - button "Close calendar detail" [ref=e63] [cursor=pointer]
                - heading "Communications Class" [active] [level=2] [ref=e67]
                - status [ref=e68]:
                  - generic [ref=e69]: Added the Communications Class repeating series.
                  - button "Undo calendar change" [ref=e70] [cursor=pointer]
                  - button "Dismiss calendar confirmation" [ref=e71] [cursor=pointer]
                - paragraph [ref=e75]: Wed, Sep 2, 11:30 AM · 30 min fixed
                - generic [ref=e83]: I Have A
                - paragraph [ref=e85]: Every week on Monday and Wednesday · no end date. Move, resize and Mark done apply to this occurrence.
                - generic [ref=e86]:
                  - generic [ref=e87]:
                    - term [ref=e88]: Why here
                    - definition [ref=e89]: Added manually. YOVA has not inferred a placement reason.
                  - generic [ref=e90]:
                    - term [ref=e91]: Flexibility
                    - definition [ref=e92]: Marked fixed by you. You can still correct or move it manually.
                - generic [ref=e93]:
                  - text: Delete applies to
                  - combobox "Delete applies to" [ref=e94]:
                    - option "This occurrence only" [selected]
                    - option "Entire series"
                - generic [ref=e95]:
                  - button "Edit" [ref=e96] [cursor=pointer]
                  - button "Mark done" [ref=e97] [cursor=pointer]
                  - button "Move" [ref=e98] [cursor=pointer]
                  - button "Delete" [ref=e104] [cursor=pointer]
            - region [ref=e108]:
              - generic [ref=e109]:
                - generic [ref=e110]:
                  - text: YOUR DAY
                  - heading "Wednesday, Sep 2" [level=2] [ref=e111]
                - generic [ref=e112]: 1 open
              - article [ref=e114]:
                - generic [ref=e118]:
                  - generic [ref=e119]: 11:30 AM · Fixed
                  - strong [ref=e120]: Communications Class
                  - generic [ref=e121]: Up next
                - button "Details" [ref=e123] [cursor=pointer]
            - generic [ref=e124]:
              - generic [ref=e125]: NEAREST DEADLINE
              - heading "No open outcome yet" [level=3] [ref=e126]
              - paragraph [ref=e127]: Add a due date when you want the calendar to connect work to a result.
            - group [ref=e128]:
              - generic "Adjust today’s available time Opt in, review the safe change, then approve it." [ref=e129] [cursor=pointer]:
                - generic [ref=e134]:
                  - strong [ref=e135]: Adjust today’s available time
                  - generic [ref=e136]: Opt in, review the safe change, then approve it.
            - region [ref=e139]:
              - generic [ref=e141]:
                - text: NEXT UP
                - heading "Your order of business" [level=3] [ref=e142]
                - paragraph [ref=e143]: What to do next, most urgent first.
              - paragraph [ref=e144]: Nothing waiting right now. Add a plan or a deadline and YOVA will queue the work here.
          - generic [ref=e145]:
            - region [ref=e146]:
              - generic [ref=e147]:
                - generic [ref=e148]:
                  - text: SCHEDULE
                  - heading "Aug 31 – September 6, 2026" [level=2] [ref=e149]
                - generic [ref=e150]:
                  - button "Agenda" [pressed] [ref=e151] [cursor=pointer]
                  - button "Week" [ref=e152] [cursor=pointer]
              - generic [ref=e153]:
                - button "Previous calendar period" [ref=e154] [cursor=pointer]
                - button "Today" [ref=e157] [cursor=pointer]
                - button "Next calendar period" [ref=e158] [cursor=pointer]
                - generic [ref=e161]:
                  - text: Jump to date
                  - textbox "Jump to date" [ref=e162]: 2026-09-02
              - generic "Agenda" [ref=e163]:
                - generic [ref=e164]:
                  - heading "Today" [level=3] [ref=e165]
                  - button "Communications Class, 11:30 AM, Class" [ref=e166] [cursor=pointer]:
                    - generic [ref=e167]: 11:30 AM
                    - generic [ref=e168]:
                      - strong [ref=e169]: Communications Class
                      - generic [ref=e170]: Class · 30 min · I Have A
            - region [ref=e173]:
              - paragraph [ref=e174]: Your week is on track.
            - region [ref=e177]:
              - generic [ref=e178]:
                - generic [ref=e179]:
                  - heading "Coming up" [level=2] [ref=e180]
                  - paragraph [ref=e181]: Major outcomes and the preparation blocks that lead to them.
                - generic [ref=e182]: 0 open
              - generic [ref=e183]:
                - generic [ref=e184]:
                  - text: Search deadlines
                  - searchbox "Search deadlines" [ref=e185]
                - generic [ref=e186]:
                  - text: Deadline status
                  - combobox "Deadline status" [ref=e187]:
                    - option "Open" [selected]
                    - option "Complete"
                    - option "All"
              - paragraph [ref=e188]: Add an exam, paper, or deadline to connect this week’s work to an outcome.
            - region [ref=e189]:
              - generic [ref=e191]:
                - heading "Why this week looks like this" [level=2] [ref=e192]
                - paragraph [ref=e193]: Only stored profile, completion, availability, plan-order, and deadline evidence appears here.
              - list [ref=e197]:
                - listitem [ref=e198]:
                  - text: Your profile
                  - paragraph [ref=e199]: You told YOVA that afternoons usually offer the most usable energy, so that period may be recommended for flexible work but nothing moves without your approval.
                - listitem [ref=e200]:
                  - text: Your profile
                  - paragraph [ref=e201]: You described 20–30 minutes as a realistic session length, so YOVA should keep optional work near that range unless the task or deadline requires a different size.
              - button "Show all" [ref=e202] [cursor=pointer]
              - group [ref=e205]:
                - generic "Profile evidence available to YOVA" [ref=e206] [cursor=pointer]
              - button "Ask YOVA to adjust" [ref=e207] [cursor=pointer]
              - group [ref=e211]:
                - generic "Recent schedule changes 1" [ref=e212] [cursor=pointer]:
                  - text: Recent schedule changes
                  - generic [ref=e217]: "1"
    - contentinfo [ref=e218]:
      - navigation "Trust and support" [ref=e219]:
        - link "Support" [ref=e220] [cursor=pointer]:
          - /url: /support
        - link "Privacy" [ref=e221] [cursor=pointer]:
          - /url: /privacy
        - link "Terms" [ref=e222] [cursor=pointer]:
          - /url: /terms
```

# Test source

```ts
  76  |       kind: "test",
  77  |       deadline: "2026-09-05T18:00:00.000Z",
  78  |       status: "active",
  79  |       sourceMode: "yova_generated",
  80  |       studyMode: "inside_yova",
  81  |       learningIntent: "study",
  82  |       creationIntent: "plan",
  83  |       sessionArchitectureVersion: "streamed_teaching_v1",
  84  |       rationale: "Preserve the learning sequence before the midterm.",
  85  |       createdAt: "2026-09-01T10:00:00.000Z",
  86  |       materials: [],
  87  |       sessions: [{
  88  |         id: "causal-map-session",
  89  |         sequence: 1,
  90  |         title: "Causal map review",
  91  |         objective: "Explain how alliance commitments raised escalation risk.",
  92  |         method: "Concept Mapping",
  93  |         methodReason: "A cause map exposes missing links before retrieval.",
  94  |         scheduledFor: "2026-09-02T17:00:00.000Z",
  95  |         estimatedMinutes: 40,
  96  |         amountLabel: "One causal map and evidence check · about 40 min",
  97  |         learningMode: "study",
  98  |         topicIds: ["alliances-topic"],
  99  |         contentTargets: ["Alliance escalation"],
  100 |         completionEvidence: ["Explain two linked causes without notes"],
  101 |         status: "ready",
  102 |       }],
  103 |     });
  104 |     snapshot.deadlineMilestones = [{
  105 |       id: "unplanned-term-paper",
  106 |       title: "Unplanned term paper",
  107 |       description: "Submit a sourced argument about industrialization.",
  108 |       dueAt: "2026-09-04T20:00:00.000Z",
  109 |       status: "open",
  110 |       linkedLearningItemId: null,
  111 |       createdAt: "2026-09-01T10:00:00.000Z",
  112 |     }];
  113 |     snapshot.updatedAt = new Date().toISOString();
  114 |     window.localStorage.setItem("yova.preview.v1", JSON.stringify(snapshot));
  115 |   });
  116 | }
  117 | 
  118 | export async function seedMovableCalendarState(page: Page) {
  119 |   await page.evaluate(() => {
  120 |     const raw = window.localStorage.getItem("yova.calendar.prototype.v1");
  121 |     if (!raw) throw new Error("Expected account-scoped Calendar storage.");
  122 |     const envelope = JSON.parse(raw) as {
  123 |       accounts: Record<string, {
  124 |         manualEvents: unknown[];
  125 |         suggestions: unknown[];
  126 |         updatedAt: string;
  127 |       }>;
  128 |     };
  129 |     const account = Object.values(envelope.accounts)[0];
  130 |     if (!account) throw new Error("Expected a Calendar account bucket.");
  131 |     const localDate = (day: number, hour: number, minute = 0) => (
  132 |       new Date(2026, 8, day, hour, minute, 0, 0).toISOString()
  133 |     );
  134 |     account.manualEvents = [{
  135 |       id: "editable-study-block",
  136 |       title: "Editable study block",
  137 |       eventType: "personal",
  138 |       startsAt: localDate(2, 10),
  139 |       endsAt: localDate(2, 10, 30),
  140 |       dueAt: null,
  141 |       fixed: false,
  142 |       done: false,
  143 |       courseId: null,
  144 |       courseLabel: "International Relations",
  145 |       outcomeId: null,
  146 |       createdAt: new Date().toISOString(),
  147 |       updatedAt: new Date().toISOString(),
  148 |     }];
  149 |     account.suggestions = [{
  150 |       id: "suggested-source-review",
  151 |       title: "Suggested source review",
  152 |       startsAt: localDate(3, 17),
  153 |       durationMinutes: 25,
  154 |       planId: null,
  155 |       planSessionId: null,
  156 |       courseId: null,
  157 |       outcomeId: null,
  158 |       status: "pending",
  159 |       flexibility: "movable",
  160 |       reason: {
  161 |         text: "This open period avoids the fixed class while keeping the source review optional.",
  162 |         source: "suggestion",
  163 |         evidenceRefs: ["learner-visible-suggestion"],
  164 |       },
  165 |       createdAt: new Date().toISOString(),
  166 |       updatedAt: new Date().toISOString(),
  167 |     }];
  168 |     account.updatedAt = new Date().toISOString();
  169 |     window.localStorage.setItem("yova.calendar.prototype.v1", JSON.stringify(envelope));
  170 |   });
  171 | }
  172 | 
  173 | 
  174 | 
  175 | export async function openCalendar(page: Page, week = false) {
> 176 |   await page.getByRole("button", {name: "Calendar", exact: true}).click();
      |                                                                   ^ Error: locator.click: Test timeout of 30000ms exceeded.
  177 |   await expect(page.locator(".calendar-workspace")).toHaveAttribute("aria-busy", "false");
  178 |   if (week) await showWeek(page);
  179 | }
  180 | export async function openPreviewCalendar(page: Page) {
  181 |   await page.clock.setFixedTime(FIXED_NOW);
  182 |   await createPreviewAccount(page);
  183 |   await completeOnboarding(page);
  184 |   await openCalendar(page);
  185 | }
  186 | export async function closeDetail(page: Page) {
  187 |   const button = page.getByRole("button", {name:"Close calendar detail"});
  188 |   if (await button.isVisible()) await button.click();
  189 | }
  190 | export async function quickDraft(page: Page, phrase: string) {
  191 |   await closeDetail(page);
  192 |   const input = page.getByLabel("Quick add a calendar item");
  193 |   await input.fill(phrase);
  194 |   await input.press("Enter");
  195 |   const dialog = page.getByRole("dialog", {name:"Confirm quick add"});
  196 |   await expect(dialog).toBeVisible();
  197 |   return dialog;
  198 | }
  199 | export async function addManual(page: Page, title: string, time: string, duration = "30", type = "personal", due?: string) {
  200 |   const form = await quickDraft(page, `${title} tomorrow for 30 minutes`);
  201 |   await form.getByLabel("Title", {exact:true}).fill(title);
  202 |   await form.getByRole("combobox", {name:"Type"}).selectOption(type);
  203 |   await form.getByLabel("Calendar time", {exact:true}).fill(time);
  204 |   await form.getByLabel("Duration", {exact:true}).fill(duration);
  205 |   await form.getByLabel("Fixed time", {exact:true}).setChecked(type === "class" || type === "exam");
  206 |   if (due) await form.getByLabel("Due time", {exact:true}).fill(due);
  207 |   await form.getByRole("button", {name:"Save to calendar", exact:true}).click();
  208 |   await expect(page.locator(".calendar-block-detail h2")).toHaveText(title);
  209 | }
  210 | 
  211 | export async function showWeek(page: Page) {
  212 |   await page.getByRole("button", { name: "Week", exact: true }).click();
  213 |   await expect(page.locator(".calendar-week")).toBeVisible();
  214 | }
  215 | 
```