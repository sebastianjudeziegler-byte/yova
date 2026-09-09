# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: calendar-journeys.spec.ts >> two simultaneous tabs preserve both new events and each tab refreshes
- Location: e2e/calendar-journeys.spec.ts:7:5

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: locator.fill: Test timeout of 30000ms exceeded.
Call log:
  - waiting for getByLabel('Quick add a calendar item')

```

# Page snapshot

```yaml
- generic [active] [ref=f1e1]:
  - generic [ref=f1e2]:
    - link "Skip to main content" [ref=f1e3] [cursor=pointer]:
      - /url: "#main-content"
    - banner [ref=f1e4]:
      - generic [ref=f1e5]:
        - generic [ref=f1e6]: "Y"
        - generic [ref=f1e7]: YOVA
      - navigation "Main navigation" [ref=f1e8]:
        - button "Home" [ref=f1e9] [cursor=pointer]
        - button "Learning" [ref=f1e11] [cursor=pointer]
        - button "Calendar" [ref=f1e13] [cursor=pointer]
        - button "Ask YOVA" [ref=f1e15] [cursor=pointer]
        - button "You" [ref=f1e17] [cursor=pointer]
      - generic [ref=f1e19]:
        - button "Add to YOVA" [ref=f1e20] [cursor=pointer]:
          - generic [ref=f1e22]: Add
        - generic [ref=f1e23]:
          - generic "Learner · Private alpha" [ref=f1e24]: L
          - button "Sign out on this device" [ref=f1e25] [cursor=pointer]
    - main [ref=f1e29]:
      - generic [ref=f1e30]:
        - generic [ref=f1e31]:
          - generic [ref=f1e32]: WEDNESDAY, SEPTEMBER 2
          - heading [level=1] [ref=f1e33]:
            - text: Good morning,
            - emphasis [ref=f1e34]: Learner
        - generic [ref=f1e35]:
          - generic [ref=f1e36]: START HERE
          - heading "Turn any goal into a clear next step." [level=2] [ref=f1e37]
          - paragraph [ref=f1e38]: Use your own materials, let YOVA create the content, or get a plan for studying somewhere else.
          - generic [ref=f1e39]:
            - button "Build my first plan" [ref=f1e40] [cursor=pointer]
            - button "Study something now" [ref=f1e41] [cursor=pointer]
        - generic [ref=f1e42]:
          - generic [ref=f1e43]:
            - textbox "Ask YOVA" [ref=f1e44]:
              - /placeholder: Ask YOVA about anything you're studying…
            - button "Send" [disabled] [ref=f1e45]:
              - generic [ref=f1e46]: Ask
          - button "Add plan Notes, syllabus, link" [ref=f1e47] [cursor=pointer]:
            - generic [ref=f1e48]: +
            - generic [ref=f1e49]:
              - strong [ref=f1e50]: Add plan
              - generic [ref=f1e51]: Notes, syllabus, link
            - generic [ref=f1e52]: ›
          - button "Study now Quick, off-plan" [ref=f1e53] [cursor=pointer]:
            - generic [ref=f1e54]: →
            - generic [ref=f1e55]:
              - strong [ref=f1e56]: Study now
              - generic [ref=f1e57]: Quick, off-plan
            - generic [ref=f1e58]: ›
    - contentinfo [ref=f1e59]:
      - navigation "Trust and support" [ref=f1e60]:
        - link "Support" [ref=f1e61] [cursor=pointer]:
          - /url: /support
        - link "Privacy" [ref=f1e62] [cursor=pointer]:
          - /url: /privacy
        - link "Terms" [ref=f1e63] [cursor=pointer]:
          - /url: /terms
  - button "Open Next.js Dev Tools" [ref=f1e69] [cursor=pointer]
  - alert [ref=f1e73]
```

# Test source

```ts
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
  176 |   await page.getByRole("button", {name: "Calendar", exact: true}).click();
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
> 193 |   await input.fill(phrase);
      |               ^ Error: locator.fill: Test timeout of 30000ms exceeded.
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