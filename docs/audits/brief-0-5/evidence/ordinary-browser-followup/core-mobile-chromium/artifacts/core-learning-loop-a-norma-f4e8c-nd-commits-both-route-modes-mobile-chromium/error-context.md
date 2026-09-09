# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: core-learning-loop.spec.ts >> a normal conceptual plan visibly moves from Learn to later Practice and commits both route modes
- Location: e2e/core-learning-loop.spec.ts:3255:5

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('heading', { name: 'Here is what YOVA understood.' })
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 5000ms
  - waiting for getByRole('heading', { name: 'Here is what YOVA understood.' })

```

```yaml
- alert
- main:
  - text: YOVA
  - button "Exit" [disabled]
  - text: ADD TO YOVA
  - heading "What would you like to add?" [level=1]
  - paragraph: Describe a class, recurring commitment, deadline, or learning goal. YOVA will organize it for you.
  - textbox "Describe what you want to add":
    - /placeholder: "Example: I have a communications class from 11:30 to 12 every Monday and Wednesday. Or: I have a biology test in two weeks."
    - text: I have never studied cellular respiration. Teach me from scratch for my exam in three weeks.
  - strong: Materials are optional
  - text: Attach a study guide, notes, slides, article, or video when it helps define the scope. Files or links
  - strong: Reading files…
  - text: PDF, TXT, or Markdown · up to 5 files · 10 MB each
  - button "Choose learning materials" [disabled]
  - button "Add an article or YouTube video Public article text or a YouTube transcript can become plan material." [disabled]:
    - strong: Add an article or YouTube video
    - text: Public article text or a YouTube transcript can become plan material.
  - button "Cancel" [disabled]
  - button "Organize this" [disabled]
```

# Test source

```ts
  3985 | });
  3986 | 
  3987 | test("material drop zone accepts drag gestures and explains rejected files", async ({ page }) => {
  3988 |   await createPreviewAccount(page);
  3989 |   await completeOnboarding(page);
  3990 | 
  3991 |   await page.getByRole("button", { name: "Study something now", exact: true }).first().click();
  3992 |   await page.getByPlaceholder("Example: Help me understand the product rule and practice using it.").fill(
  3993 |     "Help me prepare for a World War I history test.",
  3994 |   );
  3995 |   await page.getByRole("button", { name: /Choose how YOVA should help/ }).click();
  3996 |   await page.getByRole("button", { name: /Use my materials/ }).click();
  3997 | 
  3998 |   const dropzone = page.getByLabel("Upload learning materials. Choose files or drag and drop them here.");
  3999 |   const transfer = await page.evaluateHandle(() => {
  4000 |     const dataTransfer = new DataTransfer();
  4001 |     dataTransfer.items.add(new File(["history notes"], "history-notes.docx", {
  4002 |       type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  4003 |     }));
  4004 |     return dataTransfer;
  4005 |   });
  4006 | 
  4007 |   await dropzone.dispatchEvent("dragenter", { dataTransfer: transfer });
  4008 |   await expect(dropzone).toHaveClass(/drag-active/);
  4009 |   await expect(dropzone).toContainText("Drop files to add them");
  4010 |   await dropzone.dispatchEvent("drop", { dataTransfer: transfer });
  4011 |   await expect(dropzone).not.toHaveClass(/drag-active/);
  4012 |   await expect(page.getByText("history-notes.docx is not supported. Use PDF, TXT, or Markdown.")).toBeVisible();
  4013 |   await transfer.dispose();
  4014 | 
  4015 |   await page.getByLabel("Choose learning materials").setInputFiles({
  4016 |     name: "teacher-guide.pptx",
  4017 |     mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  4018 |     buffer: Buffer.from("not a supported upload"),
  4019 |   });
  4020 |   await expect(page.getByText("teacher-guide.pptx is not supported. Use PDF, TXT, or Markdown.")).toBeVisible();
  4021 | });
  4022 | 
  4023 | async function openMobileSessionGuide(page: Page) {
  4024 |   const mobileGuide = page.locator(".session-guide-mobile");
  4025 |   if (await mobileGuide.isVisible()) await mobileGuide.locator(":scope > summary").click();
  4026 | }
  4027 | 
  4028 | async function openExistingStudyNowSetup(page: Page) {
  4029 |   if (await page.locator(".session-setup-shell").isVisible()) return;
  4030 |   await expect.poll(() => page.evaluate(() => {
  4031 |     const raw = localStorage.getItem("yova.preview.v1");
  4032 |     return raw ? JSON.parse(raw).plans?.length ?? 0 : 0;
  4033 |   })).toBeGreaterThan(0);
  4034 |   // These tests cover a returning learner changing setup. Seed an unstarted
  4035 |   // saved goal, rather than expecting Study Now to repeat three setup screens.
  4036 |   // Seed before React reads storage. Mutating a hydrated app's snapshot can
  4037 |   // race its persistence effect and bring the prepared resource back.
  4038 |   await page.addInitScript(() => {
  4039 |     if (sessionStorage.getItem("yova.e2e.seed-unstarted") !== "1") return;
  4040 |     sessionStorage.removeItem("yova.e2e.seed-unstarted");
  4041 |     const raw = localStorage.getItem("yova.preview.v1");
  4042 |     if (!raw) throw new Error("Expected the newly created goal.");
  4043 |     const snapshot = JSON.parse(raw);
  4044 |     const plan = snapshot.plans.at(-1);
  4045 |     for (const session of plan.sessions) delete session.resource;
  4046 |     snapshot.updatedAt = new Date().toISOString();
  4047 |     localStorage.setItem("yova.preview.v1", JSON.stringify(snapshot));
  4048 |     localStorage.removeItem("yova.active-session-checkpoints.v1");
  4049 |   });
  4050 |   await page.evaluate(() => sessionStorage.setItem("yova.e2e.seed-unstarted", "1"));
  4051 |   await page.reload();
  4052 |   await expect(page.getByRole("button", { name: "Start session", exact: true })).toBeVisible();
  4053 |   expect(await page.evaluate(() => {
  4054 |     const snapshot = JSON.parse(localStorage.getItem("yova.preview.v1") ?? "{}");
  4055 |     return snapshot.plans.at(-1).sessions.some((session: { resource?: unknown }) => Boolean(session.resource));
  4056 |   })).toBe(false);
  4057 |   await page.getByRole("button", { name: "Start session", exact: true }).click();
  4058 |   await expect(page.locator(".session-setup-shell")).toBeVisible();
  4059 | }
  4060 | 
  4061 | async function rebuildLatestStudyNowPlanForMinutes(page: Page, minutes: number) {
  4062 |   await openExistingStudyNowSetup(page);
  4063 |   await expect(page.getByRole("heading", { name: "Here is how YOVA plans to start." })).toBeVisible();
  4064 |   await page.getByRole("button", { name: "Not now", exact: true }).click();
  4065 |   await page.getByRole("button", { name: "Learning", exact: true }).click();
  4066 |   await page.locator(".tabs").getByRole("button", { name: /^Recent/ }).click();
  4067 | 
  4068 |   const latestPlan = page.locator(".learning-goal-card").last();
  4069 |   await latestPlan.getByRole("button", { name: "Open goal" }).click();
  4070 |   await page.getByRole("button", { name: "Adjust", exact: true }).click();
  4071 | 
  4072 |   const adjustmentPanel = page.locator(".plan-adjustment-panel");
  4073 |   await adjustmentPanel.getByRole("combobox", { name: "Future session window" }).selectOption(String(minutes));
  4074 |   await adjustmentPanel.getByRole("button", { name: "Approve and rebuild plan" }).click();
  4075 |   await expect(adjustmentPanel).toHaveCount(0);
  4076 |   await page.getByRole("button", { name: "Start next session", exact: true }).click();
  4077 |   await expect(page.getByRole("heading", { name: "Here is how YOVA plans to start." })).toBeVisible();
  4078 | }
  4079 | 
  4080 | async function beginPlanFromAdd(page: Page, description: string) {
  4081 |   await page.getByRole("button", { name: "Calendar", exact: true }).click();
  4082 |   await page.locator(".calendar-page-header").getByRole("button", { name: "Add to YOVA", exact: true }).click();
  4083 |   await page.getByRole("textbox", { name: "Describe what you want to add" }).fill(description);
  4084 |   await page.getByRole("button", { name: "Organize this" }).click();
> 4085 |   await expect(page.getByRole("heading", { name: "Here is what YOVA understood." })).toBeVisible();
       |                                                                                      ^ Error: expect(locator).toBeVisible() failed
  4086 |   await page.getByRole("button", { name: "Choose what YOVA should do" }).click();
  4087 |   await page.getByRole("button", { name: /Create a plan/ }).click();
  4088 | }
  4089 | 
  4090 | async function expectNoHorizontalOverflow(page: Page, selector: string) {
  4091 |   const overflow = await page.locator(selector).first().evaluate((element) => ({
  4092 |     client: element.clientWidth,
  4093 |     scroll: element.scrollWidth,
  4094 |     offenders: Array.from(element.querySelectorAll<HTMLElement>("*")).map((child) => {
  4095 |       const rect = child.getBoundingClientRect();
  4096 |       return {
  4097 |         tag: child.tagName.toLowerCase(),
  4098 |         className: child.className,
  4099 |         client: child.clientWidth,
  4100 |         scroll: child.scrollWidth,
  4101 |         width: Math.round(rect.width),
  4102 |         right: Math.round(rect.right),
  4103 |       };
  4104 |     }).filter((item) => item.scroll > item.client + 1 || item.width > window.innerWidth + 1 || item.right > window.innerWidth + 1).slice(0, 12),
  4105 |   }));
  4106 |   expect(
  4107 |     overflow.scroll,
  4108 |     `Horizontal overflow in ${selector}: ${JSON.stringify(overflow.offenders)}`,
  4109 |   ).toBeLessThanOrEqual(overflow.client + 1);
  4110 | }
  4111 | 
  4112 | async function createPreviewAccount(page: Page) {
  4113 |   await page.goto("/?qa=preview");
  4114 |   await page.getByRole("button", { name: "Build my plan" }).click();
  4115 |   await page.getByLabel("First name").fill("Learner");
  4116 |   await page.getByLabel("Email address").fill("learning-loop@example.com");
  4117 |   await page.getByRole("button", { name: "Continue" }).click();
  4118 |   await expect(page.getByRole("heading", { name: "Make YOVA fit how you actually study." })).toBeVisible();
  4119 | }
  4120 | 
  4121 | async function readPreviewPracticeState(
  4122 |   page: Page,
  4123 |   planId?: string,
  4124 |   sessionId?: string,
  4125 | ) {
  4126 |   return page.evaluate(({ requestedPlanId, requestedSessionId }) => {
  4127 |     const stored = window.localStorage.getItem("yova.preview.v1");
  4128 |     if (!stored) return null;
  4129 | 
  4130 |     const snapshot = JSON.parse(stored) as {
  4131 |       plans?: Array<{
  4132 |         id?: string;
  4133 |         sessions?: Array<{
  4134 |           id?: string;
  4135 |           sequence?: number;
  4136 |           status?: string;
  4137 |           learningMode?: string;
  4138 |           topicIds?: string[];
  4139 |           contentTargets?: string[];
  4140 |           completionEvidence?: string[];
  4141 |           reviewType?: string;
  4142 |         }>;
  4143 |         knowledgeMap?: { topics?: Array<{ id?: string; status?: string }> };
  4144 |       }>;
  4145 |       sessionCompletions?: Array<{
  4146 |         id?: string;
  4147 |         planId?: string;
  4148 |         planSessionId?: string;
  4149 |         completionMode?: string;
  4150 |         correctAnswers?: number;
  4151 |         totalAnswers?: number;
  4152 |         observedGap?: string;
  4153 |         conceptEvidence?: unknown[];
  4154 |         confidenceEvidence?: unknown[];
  4155 |       }>;
  4156 |     };
  4157 |     const plan = requestedPlanId
  4158 |       ? snapshot.plans?.find((candidate) => candidate.id === requestedPlanId)
  4159 |       : snapshot.plans?.at(-1);
  4160 |     const session = requestedSessionId
  4161 |       ? plan?.sessions?.find((candidate) => candidate.id === requestedSessionId)
  4162 |       : plan?.sessions?.find((candidate) => candidate.status === "ready") ?? plan?.sessions?.at(0);
  4163 |     if (!plan?.id || !session?.id) return null;
  4164 |     const completion = snapshot.sessionCompletions?.find((candidate) => (
  4165 |       candidate.planId === plan.id
  4166 |       && candidate.planSessionId === session.id
  4167 |     )) ?? null;
  4168 |     const verificationSession = plan.sessions?.find((candidate) => (
  4169 |       candidate.sequence === (session.sequence ?? 0) + 1
  4170 |       && candidate.reviewType === "verify"
  4171 |     )) ?? null;
  4172 |     const topicStatuses = (plan.knowledgeMap?.topics ?? []).map((topic) => ({
  4173 |       id: topic.id ?? null,
  4174 |       status: topic.status ?? null,
  4175 |     }));
  4176 | 
  4177 |     return {
  4178 |       planId: plan.id,
  4179 |       sessionId: session.id,
  4180 |       sessionSequence: session.sequence ?? 0,
  4181 |       sessionStatus: session.status ?? null,
  4182 |       sessionTopicIds: session.topicIds ?? [],
  4183 |       sessionContentTargets: session.contentTargets ?? [],
  4184 |       sessionCompletionEvidence: session.completionEvidence ?? [],
  4185 |       topicStatuses,
```