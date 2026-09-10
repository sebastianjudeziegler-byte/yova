# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: core-learning-loop.spec.ts >> a 10-minute outside teaching-first session loads its built-in method lesson
- Location: e2e/core-learning-loop.spec.ts:1062:5

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('heading', { name: 'Here is how YOVA plans to start.' })
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 5000ms
  - waiting for getByRole('heading', { name: 'Here is how YOVA plans to start.' })

```

```yaml
- alert
- link "Skip to main content":
  - /url: "#main-content"
- banner:
  - text: YOVA
  - navigation "Main navigation":
    - button "Home"
    - button "Learning"
    - button "Calendar"
    - button "Ask YOVA"
    - button "You"
  - button "Add to YOVA": Add
  - text: L
  - button "Sign out on this device"
- main:
  - text: LEARNING
  - heading "What you’re working toward" [level=1]
  - paragraph: Every goal keeps its plan, materials, sessions, and progress in one place.
  - button "New plan"
  - navigation "Learning sections":
    - button "Active 0"
    - button "Recent 1"
    - button "Archive 0"
    - button "Methods 12"
  - button "All recent learning"
  - text: TOPIC · FLEXIBLE
  - heading "Understand How the Krebs Cycle Actually Produces NADH and FADH2" [level=2]
  - paragraph: How the Krebs cycle actually produces NADH and FADH2
  - text: Building understanding, then practice 0 of 1 sessions complete
  - button "Start next session"
  - button "Adjust"
  - button "Archive"
  - text: Plan state
  - strong: Unfinished work
  - text: Knowledge-check accuracy
  - strong: No data
  - text: Last session felt
  - strong: Not rated
  - text: KNOWLEDGE MAP
  - heading "What this plan is building" [level=3]
  - paragraph: Topics are ordered by prerequisite. Sessions below are how each topic moves from introduced to secure.
  - text: 0 of 1 secure OPTIONAL PLACEMENT CHECK
  - strong: Make the remaining plan more precise
  - paragraph: Answer a few map-based questions so YOVA can replace lessons on demonstrated topics with shorter verification checks. Skipping never marks a topic as known.
  - button "Take the placement check"
  - list:
    - listitem:
      - text: "1"
      - strong: How the Krebs cycle actually produces NADH and FADH2
      - text: Not started
      - paragraph: The knowledge and performance needed for I want to understand how the Krebs cycle actually produces NADH and FADH2.
      - text: Structured by YOVA for this goal
      - button "I already learned this"
      - button "Attach a source"
  - status:
    - paragraph: Change available study time; everything else unchanged.
    - button "Undo"
  - heading "Sessions in this study" [level=3]
  - paragraph: Completed sessions are checked. Unfinished sessions remain listed without being counted as completed.
  - text: 1 sessions
  - strong: Build I want to understand how the Krebs cycle actually produces NADH and FADH2
  - text: Teaching first · Feynman Technique · Wed 5:00 PM 10 min
  - heading "Learning source" [level=3]
  - button "Add file or link"
  - paragraph:
    - strong: Created by YOVA
    - text: . Teaching and practice for this goal. Attach a source to a topic to plan time for it; completed work stays saved.
  - heading "Study resources" [level=3]
  - paragraph: Reusable explanations and practice, attached to the session that needed them.
  - text: Created when relevant
  - strong: Nothing extra to browse yet
  - paragraph: YOVA creates the teaching and practice needed for a session when you first start it. Those resources will stay here afterward.
- contentinfo:
  - navigation "Trust and support":
    - link "Support":
      - /url: /support
    - link "Privacy":
      - /url: /privacy
    - link "Terms":
      - /url: /terms
- dialog "Start Build I want to understand how the Krebs cycle actually produces NADH and FADH2 now?":
  - text: YOU ARE AHEAD OF SCHEDULE
  - heading "Start Build I want to understand how the Krebs cycle actually produces NADH and FADH2 now?" [level=2]
  - paragraph: This session is planned for Wed, Sep 2, 5:00 PM. You can move forward now without skipping any unfinished content.
  - strong: "Recommended: pull the calendar forward"
  - paragraph: YOVA will move this session to now and shift the remaining 0 sessions by the same amount. The learning order and spacing stay intact.
  - button "Cancel"
  - button "Start now, keep dates"
  - button "Start and adjust calendar"
```

# Test source

```ts
  4009 |   await page.getByRole("button", { name: "Study something now", exact: true }).first().click();
  4010 |   await page.getByPlaceholder("Example: Help me understand the product rule and practice using it.").fill(
  4011 |     "Help me prepare for a World War I history test.",
  4012 |   );
  4013 |   await page.getByRole("button", { name: /Choose how YOVA should help/ }).click();
  4014 |   await page.getByRole("button", { name: /Use my materials/ }).click();
  4015 | 
  4016 |   const dropzone = page.getByLabel("Upload learning materials. Choose files or drag and drop them here.");
  4017 |   const transfer = await page.evaluateHandle(() => {
  4018 |     const dataTransfer = new DataTransfer();
  4019 |     dataTransfer.items.add(new File(["history notes"], "history-notes.docx", {
  4020 |       type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  4021 |     }));
  4022 |     return dataTransfer;
  4023 |   });
  4024 | 
  4025 |   await dropzone.dispatchEvent("dragenter", { dataTransfer: transfer });
  4026 |   await expect(dropzone).toHaveClass(/drag-active/);
  4027 |   await expect(dropzone).toContainText("Drop files to add them");
  4028 |   await dropzone.dispatchEvent("drop", { dataTransfer: transfer });
  4029 |   await expect(dropzone).not.toHaveClass(/drag-active/);
  4030 |   await expect(page.getByText("history-notes.docx is not supported. Use PDF, TXT, or Markdown.")).toBeVisible();
  4031 |   await transfer.dispose();
  4032 | 
  4033 |   await page.getByLabel("Choose learning materials").setInputFiles({
  4034 |     name: "teacher-guide.pptx",
  4035 |     mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  4036 |     buffer: Buffer.from("not a supported upload"),
  4037 |   });
  4038 |   await expect(page.getByText("teacher-guide.pptx is not supported. Use PDF, TXT, or Markdown.")).toBeVisible();
  4039 | });
  4040 | 
  4041 | async function openMobileSessionGuide(page: Page) {
  4042 |   const mobileGuide = page.locator(".session-guide-mobile");
  4043 |   if (await mobileGuide.isVisible()) await mobileGuide.locator(":scope > summary").click();
  4044 | }
  4045 | 
  4046 | async function openExistingStudyNowSetup(page: Page) {
  4047 |   if (await page.locator(".session-setup-shell").isVisible()) return;
  4048 |   await expect.poll(() => page.evaluate(() => {
  4049 |     const raw = localStorage.getItem("yova.preview.v1");
  4050 |     return raw ? JSON.parse(raw).plans?.length ?? 0 : 0;
  4051 |   })).toBeGreaterThan(0);
  4052 |   // These tests cover a returning learner changing setup. Seed an unstarted
  4053 |   // saved goal, rather than expecting Study Now to repeat three setup screens.
  4054 |   // Seed before React reads storage. Mutating a hydrated app's snapshot can
  4055 |   // race its persistence effect and bring the prepared resource back.
  4056 |   await page.addInitScript(() => {
  4057 |     if (sessionStorage.getItem("yova.e2e.seed-unstarted") !== "1") return;
  4058 |     sessionStorage.removeItem("yova.e2e.seed-unstarted");
  4059 |     const raw = localStorage.getItem("yova.preview.v1");
  4060 |     if (!raw) throw new Error("Expected the newly created goal.");
  4061 |     const snapshot = JSON.parse(raw);
  4062 |     const plan = snapshot.plans.at(-1);
  4063 |     for (const session of plan.sessions) delete session.resource;
  4064 |     snapshot.updatedAt = new Date().toISOString();
  4065 |     localStorage.setItem("yova.preview.v1", JSON.stringify(snapshot));
  4066 |     localStorage.removeItem("yova.active-session-checkpoints.v1");
  4067 |   });
  4068 |   await page.evaluate(() => sessionStorage.setItem("yova.e2e.seed-unstarted", "1"));
  4069 |   await page.reload();
  4070 |   await expect(page.getByRole("button", { name: "Start session", exact: true })).toBeVisible();
  4071 |   expect(await page.evaluate(() => {
  4072 |     const snapshot = JSON.parse(localStorage.getItem("yova.preview.v1") ?? "{}");
  4073 |     return snapshot.plans.at(-1).sessions.some((session: { resource?: unknown }) => Boolean(session.resource));
  4074 |   })).toBe(false);
  4075 |   await page.getByRole("button", { name: "Start session", exact: true }).click();
  4076 |   await expect(page.locator(".session-setup-shell")).toBeVisible();
  4077 | }
  4078 | 
  4079 | async function rebuildLatestStudyNowPlanForMinutes(page: Page, minutes: number) {
  4080 |   await openExistingStudyNowSetup(page);
  4081 |   await expect(page.getByRole("heading", { name: "Here is how YOVA plans to start." })).toBeVisible();
  4082 |   await page.getByRole("button", { name: "Not now", exact: true }).click();
  4083 |   await page.getByRole("button", { name: "Learning", exact: true }).click();
  4084 |   await page.locator(".tabs").getByRole("button", { name: /^Recent/ }).click();
  4085 | 
  4086 |   const latestPlan = page.locator(".learning-goal-card").last();
  4087 |   await latestPlan.getByRole("button", { name: "Open goal" }).click();
  4088 |   await page.getByRole("button", { name: "Adjust", exact: true }).click();
  4089 | 
  4090 |   const adjustmentPanel = page.getByRole("region", { name: "Plan change preview" });
  4091 |   await adjustmentPanel.getByLabel("Change type").selectOption("set_availability");
  4092 |   const savedWindow = await page.evaluate(() => {
  4093 |     const plan = JSON.parse(localStorage.getItem("yova.preview.v1")!).plans.at(-1);
  4094 |     if (plan.schedulePreferences?.availability?.[0]) return plan.schedulePreferences.availability[0];
  4095 |     const start = new Date(plan.sessions[0].scheduledFor);
  4096 |     const end = new Date(start.getTime() + 60 * 60_000);
  4097 |     const time = (date: Date) => date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
  4098 |     return { day: start.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" }), window: `${time(start)}–${time(end)}` };
  4099 |   });
  4100 |   const kept = adjustmentPanel.getByRole("checkbox", { name: /^Keep existing window/ });
  4101 |   for (let index = 0; index < await kept.count(); index += 1) await kept.nth(index).uncheck();
  4102 |   await adjustmentPanel.getByLabel("Day", { exact: true }).selectOption(savedWindow.day);
  4103 |   await adjustmentPanel.getByLabel("Time window", { exact: true }).fill(savedWindow.window);
  4104 |   await adjustmentPanel.getByLabel("Minutes", { exact: true }).fill(String(minutes));
  4105 |   await adjustmentPanel.getByRole("button", { name: "Preview change", exact: true }).click();
  4106 |   await adjustmentPanel.getByRole("button", { name: "Confirm changes" }).click();
  4107 |   await expect(adjustmentPanel).toHaveCount(0);
  4108 |   await page.getByRole("button", { name: "Start next session", exact: true }).click();
> 4109 |   await expect(page.getByRole("heading", { name: "Here is how YOVA plans to start." })).toBeVisible();
       |                                                                                         ^ Error: expect(locator).toBeVisible() failed
  4110 | }
  4111 | 
  4112 | async function beginPlanFromAdd(page: Page, description: string) {
  4113 |   await page.getByRole("button", { name: "Calendar", exact: true }).click();
  4114 |   await page.locator(".calendar-page-header").getByRole("button", { name: "Add to YOVA", exact: true }).click();
  4115 |   await page.getByRole("textbox", { name: "Describe what you want to add" }).fill(description);
  4116 |   await page.getByRole("button", { name: "Organize this" }).click();
  4117 |   await expect(page.getByRole("heading", { name: "Here is what YOVA understood." })).toBeVisible();
  4118 |   await page.getByRole("button", { name: "Choose what YOVA should do" }).click();
  4119 |   await page.getByRole("button", { name: /Create a plan/ }).click();
  4120 | }
  4121 | 
  4122 | async function expectNoHorizontalOverflow(page: Page, selector: string) {
  4123 |   const overflow = await page.locator(selector).first().evaluate((element) => ({
  4124 |     client: element.clientWidth,
  4125 |     scroll: element.scrollWidth,
  4126 |     offenders: Array.from(element.querySelectorAll<HTMLElement>("*")).map((child) => {
  4127 |       const rect = child.getBoundingClientRect();
  4128 |       return {
  4129 |         tag: child.tagName.toLowerCase(),
  4130 |         className: child.className,
  4131 |         client: child.clientWidth,
  4132 |         scroll: child.scrollWidth,
  4133 |         width: Math.round(rect.width),
  4134 |         right: Math.round(rect.right),
  4135 |       };
  4136 |     }).filter((item) => item.scroll > item.client + 1 || item.width > window.innerWidth + 1 || item.right > window.innerWidth + 1).slice(0, 12),
  4137 |   }));
  4138 |   expect(
  4139 |     overflow.scroll,
  4140 |     `Horizontal overflow in ${selector}: ${JSON.stringify(overflow.offenders)}`,
  4141 |   ).toBeLessThanOrEqual(overflow.client + 1);
  4142 | }
  4143 | 
  4144 | async function createPreviewAccount(page: Page) {
  4145 |   await page.goto("/?qa=preview");
  4146 |   await page.getByRole("button", { name: "Build my plan" }).click();
  4147 |   await page.getByLabel("First name").fill("Learner");
  4148 |   await page.getByLabel("Email address").fill("learning-loop@example.com");
  4149 |   await page.getByRole("button", { name: "Continue" }).click();
  4150 |   await expect(page.getByRole("heading", { name: "Make YOVA fit how you actually study." })).toBeVisible();
  4151 | }
  4152 | 
  4153 | async function readPreviewPracticeState(
  4154 |   page: Page,
  4155 |   planId?: string,
  4156 |   sessionId?: string,
  4157 | ) {
  4158 |   return page.evaluate(({ requestedPlanId, requestedSessionId }) => {
  4159 |     const stored = window.localStorage.getItem("yova.preview.v1");
  4160 |     if (!stored) return null;
  4161 | 
  4162 |     const snapshot = JSON.parse(stored) as {
  4163 |       plans?: Array<{
  4164 |         id?: string;
  4165 |         sessions?: Array<{
  4166 |           id?: string;
  4167 |           sequence?: number;
  4168 |           status?: string;
  4169 |           learningMode?: string;
  4170 |           topicIds?: string[];
  4171 |           contentTargets?: string[];
  4172 |           completionEvidence?: string[];
  4173 |           reviewType?: string;
  4174 |         }>;
  4175 |         knowledgeMap?: { topics?: Array<{ id?: string; status?: string }> };
  4176 |       }>;
  4177 |       sessionCompletions?: Array<{
  4178 |         id?: string;
  4179 |         planId?: string;
  4180 |         planSessionId?: string;
  4181 |         completionMode?: string;
  4182 |         correctAnswers?: number;
  4183 |         totalAnswers?: number;
  4184 |         observedGap?: string;
  4185 |         conceptEvidence?: unknown[];
  4186 |         confidenceEvidence?: unknown[];
  4187 |       }>;
  4188 |     };
  4189 |     const plan = requestedPlanId
  4190 |       ? snapshot.plans?.find((candidate) => candidate.id === requestedPlanId)
  4191 |       : snapshot.plans?.at(-1);
  4192 |     const session = requestedSessionId
  4193 |       ? plan?.sessions?.find((candidate) => candidate.id === requestedSessionId)
  4194 |       : plan?.sessions?.find((candidate) => candidate.status === "ready") ?? plan?.sessions?.at(0);
  4195 |     if (!plan?.id || !session?.id) return null;
  4196 |     const completion = snapshot.sessionCompletions?.find((candidate) => (
  4197 |       candidate.planId === plan.id
  4198 |       && candidate.planSessionId === session.id
  4199 |     )) ?? null;
  4200 |     const verificationSession = plan.sessions?.find((candidate) => (
  4201 |       candidate.sequence === (session.sequence ?? 0) + 1
  4202 |       && candidate.reviewType === "verify"
  4203 |     )) ?? null;
  4204 |     const topicStatuses = (plan.knowledgeMap?.topics ?? []).map((topic) => ({
  4205 |       id: topic.id ?? null,
  4206 |       status: topic.status ?? null,
  4207 |     }));
  4208 | 
  4209 |     return {
```