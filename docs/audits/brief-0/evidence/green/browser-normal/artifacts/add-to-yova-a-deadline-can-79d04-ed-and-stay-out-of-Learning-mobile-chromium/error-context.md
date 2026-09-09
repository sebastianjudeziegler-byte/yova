# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: add-to-yova.spec.ts >> a deadline can live in Calendar, be completed, and stay out of Learning
- Location: e2e/add-to-yova.spec.ts:17:5

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
    - text: My lab report is due October 8, 2026
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
  153 |   for (const scenario of scenarios) {
  154 |     const context = await browser.newContext();
  155 |     const page = await context.newPage();
  156 |     const diagnosticRequestCount = observeDiagnosticRequests(page);
  157 |
  158 |     await openPreviewApp(page);
  159 |     await openAdd(page, scenario.goal);
  160 |     await page.getByRole("button", { name: /Choose what YOVA should do/ }).click();
  161 |     await page.getByRole("button", { name: /Create a plan/ }).click();
  162 |
  163 |     await expect(page.getByRole("heading", { name: "When would you prefer to work on this?" })).toBeVisible();
  164 |     await page.getByRole("button", { name: "Review plan inputs" }).click();
  165 |     await expect(page.getByRole("heading", { name: "Everything YOVA will use" })).toBeVisible();
  166 |     expect(diagnosticRequestCount()).toBe(0);
  167 |     await expect(page.getByRole("button", { name: "Skip for now" })).toHaveCount(0);
  168 |     await expect(page.locator(".confirmation-list")).toContainText("Work mode");
  169 |
  170 |     await page.getByRole("button", { name: "Generate my plan" }).click();
  171 |     await expect(page.getByText("Plan ready")).toBeVisible();
  172 |     await expect(page.locator(".generated-roadmap")).toContainText(scenario.modeLabel);
  173 |     await expect(page.locator(".generated-roadmap")).not.toContainText(/(?:PRACTICE|TEACHING) FIRST/);
  174 |     await expect(page.locator(".generated-roadmap")).toContainText(scenario.phaseLabel);
  175 |     await expect(page.locator(".plan-alignment-facts")).toContainText(scenario.startingApproach);
  176 |     await expect(page.getByRole("button", { name: "Change starting level" })).toHaveCount(0);
  177 |
  178 |     await context.close();
  179 |   }
  180 | });
  181 |
  182 | test("general learning stays deadline-free until the user chooses otherwise", async ({ page }) => {
  183 |   await openPreviewApp(page);
  184 |   await openAdd(page, "I want to learn personal finance from the beginning");
  185 |   await expect(page.getByLabel("Due date, if there is one")).toHaveValue("");
  186 |   await page.getByRole("button", { name: /Choose what YOVA should do/ }).click();
  187 |   await expect(page.getByRole("button", { name: /Track the deadline/ })).toHaveCount(0);
  188 |   await expect(page.getByRole("button", { name: /Create one session/ })).toBeVisible();
  189 |   await expect(page.getByRole("button", { name: /Create a plan/ })).toBeVisible();
  190 | });
  191 |
  192 | test("a timed product-rule request becomes a specific one-off session", async ({ page }) => {
  193 |   await openPreviewApp(page);
  194 |   await openAdd(page, "I need to understand the product rule in 20 minutes");
  195 |   await expect(page.getByLabel("Title")).toHaveValue("Understand the Product Rule");
  196 |   await page.getByRole("button", { name: /Choose what YOVA should do/ }).click();
  197 |   await expect(page.getByText("20 minutes requested")).toBeVisible();
  198 |   await page.getByRole("button", { name: /Create one session/ }).click();
  199 |   await expect(page.getByText(/Understand the Product Rule/).first()).toBeVisible();
  200 |   await expect(page.getByRole("button", { name: /Create it for me/ })).toHaveClass(/selected/);
  201 | });
  202 |
  203 | test("an unfinished one-off session stays out of ongoing Learning goals", async ({ page }) => {
  204 |   await openPreviewApp(page);
  205 |   await openAdd(page, "I need to understand the product rule in 20 minutes");
  206 |   await page.getByRole("button", { name: /Choose what YOVA should do/ }).click();
  207 |   await page.getByRole("button", { name: /Create one session/ }).click();
  208 |   await page.getByRole("button", { name: /Build and start session/ }).click();
  209 |
  210 |   const unavailableSessionReturn = page.getByRole("button", { name: "Return to YOVA", exact: true });
  211 |   await expect(page.locator(".session-shell, .method-session-shell").or(unavailableSessionReturn))
  212 |     .toBeVisible({ timeout: 20_000 });
  213 |   if (await unavailableSessionReturn.isVisible()) {
  214 |     await unavailableSessionReturn.click();
  215 |   } else {
  216 |     await page.getByRole("button", { name: "Exit", exact: true }).click();
  217 |     await page.getByRole("button", { name: "Save progress and leave", exact: true }).click();
  218 |   }
  219 |   await page.goto("/?qa=preview");
  220 |   await page.getByRole("button", { name: "Learning", exact: true }).click();
  221 |
  222 |   await expect(page.getByRole("button", { name: /Active 0/ })).toBeVisible();
  223 |   await expect(page.getByRole("button", { name: /Recent 1/ })).toBeVisible();
  224 |   await expect(page.locator(".learning-page").getByText("Understand the Product Rule", { exact: true })).toHaveCount(0);
  225 | });
  226 |
  227 | test("one account never sees another account's deadline", async ({ browser }) => {
  228 |   const firstContext = await browser.newContext();
  229 |   const firstPage = await firstContext.newPage();
  230 |   await openPreviewApp(firstPage);
  231 |   await openAdd(firstPage, "I have a private World War I test in two weeks");
  232 |   await firstPage.getByRole("button", { name: /Choose what YOVA should do/ }).click();
  233 |   await firstPage.getByRole("button", { name: /Track the deadline/ }).click();
  234 |   await firstPage.getByRole("button", { name: "Calendar", exact: true }).click();
  235 |   await expect(firstPage.getByText("Private World War I Test", { exact: true }).first()).toBeVisible();
  236 |
  237 |   const secondContext = await browser.newContext();
  238 |   const secondPage = await secondContext.newPage();
  239 |   await openPreviewApp(secondPage);
  240 |   await secondPage.getByRole("button", { name: "Calendar", exact: true }).click();
  241 |   await expect(secondPage.getByText("Private World War I Test", { exact: true })).toHaveCount(0);
  242 |
  243 |   await firstContext.close();
  244 |   await secondContext.close();
  245 | });
  246 |
  247 | async function openAdd(page: Page, description: string) {
  248 |   await page.getByRole("button", { name: "Calendar", exact: true }).click();
  249 |   await page.locator(".calendar-page-header").getByRole("button", { name: "Add to YOVA", exact: true }).click();
  250 |   await expect(page.getByRole("heading", { name: "What would you like to add?" })).toBeVisible();
  251 |   await page.getByRole("textbox", { name: "Describe what you want to add" }).fill(description);
  252 |   await page.getByRole("button", { name: /Organize this/ }).click();
> 253 |   await expect(page.getByRole("heading", { name: "Here is what YOVA understood." })).toBeVisible();
      |                                                                                      ^ Error: expect(locator).toBeVisible() failed
  254 | }
  255 |
  256 | function observeDiagnosticRequests(page: Page) {
  257 |   let requestCount = 0;
  258 |   page.on("request", (request) => {
  259 |     const url = new URL(request.url());
  260 |     if (url.pathname === "/api/plans/generate" && url.searchParams.get("mode") === "diagnostic") {
  261 |       requestCount += 1;
  262 |     }
  263 |   });
  264 |   return () => requestCount;
  265 | }
  266 |
  267 | async function inspectOutcomeInWeek(
  268 |   page: Page,
  269 |   title: string,
  270 |   direction: "next" | "previous",
  271 |   maxPeriods: number,
  272 | ) {
  273 |   await page.getByRole("button", { name: "Week", exact: true }).click();
  274 |   await expect(page.locator(".calendar-week")).toBeVisible();
  275 |   const dueChip = page.locator(".calendar-due-chip").filter({ hasText: title });
  276 |   const range = page.locator("#calendar-board-title");
  277 |   const navigation = page.getByRole("button", {
  278 |     name: direction === "next" ? "Next calendar period" : "Previous calendar period",
  279 |   });
  280 |
  281 |   for (let period = 0; period <= maxPeriods; period += 1) {
  282 |     if (await dueChip.count()) {
  283 |       await dueChip.click();
  284 |       return;
  285 |     }
  286 |     const previousRange = await range.innerText();
  287 |     await navigation.click();
  288 |     await expect.poll(() => range.innerText()).not.toBe(previousRange);
  289 |   }
  290 |
  291 |   throw new Error(`Could not find ${title} within ${maxPeriods} calendar periods.`);
  292 | }
  293 |
  294 | async function openPreviewApp(page: Page) {
  295 |   await page.goto("/?qa=preview");
  296 |   await page.getByRole("button", { name: "Build my plan" }).click();
  297 |   await page.getByLabel("First name").fill("Learner");
  298 |   await page.getByLabel("Email address").fill(`add-${crypto.randomUUID()}@example.com`);
  299 |   await page.getByRole("button", { name: "Continue" }).click();
  300 |   await page.getByRole("button", { name: /Personalize YOVA/ }).click();
  301 |
  302 |   for (const [index, answer] of onboardingAnswers.entries()) {
  303 |     await page.getByRole("button", { name: answer, exact: true }).click();
  304 |     await page.getByRole("button", { name: index === onboardingAnswers.length - 1 ? "Build my setup" : "Continue" }).click();
  305 |   }
  306 |
  307 |   await page.getByRole("button", { name: "Open YOVA" }).click();
  308 |   await expect(page.getByRole("heading", { name: /^Good (morning|afternoon|evening), Learner$/ })).toBeVisible();
  309 | }
  310 |
```
