# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: plan-schedule-date.spec.ts >> an overfull plan returns to its schedule and recovers without a client crash
- Location: e2e/plan-schedule-date.spec.ts:274:5

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('button', { name: 'Skip for now' })
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 5000ms
  - waiting for getByRole('button', { name: 'Skip for now' })

```

```yaml
- alert
- main:
  - text: YOVA
  - button "Exit"
  - heading "Preparing a short placement check…" [level=1]
  - paragraph: YOVA is sampling prerequisite and central topics from your knowledge map.
  - text: Mapping the goal Writing self-contained questions
```

# Test source

```ts
  323 |
  324 |   // The second attempt exercises the deterministic browser fallback. It must
  325 |   // produce the same expected recovery instead of throwing outside the API
  326 |   // error handler and stranding the loading screen.
  327 |   await finishPlanSetup(page);
  328 |   await page.getByRole("button", { name: "Generate my plan" }).click();
  329 |   await expect(capacityGuidance).toBeVisible();
  330 |   expect(pageErrors).toEqual([]);
  331 |
  332 |   const feasible = futureDate(14);
  333 |   await page.getByRole("textbox", { name: "Target date" }).fill(feasible.input);
  334 |   await page.getByRole("button", { name: "Every day", exact: true }).click();
  335 |   await page.getByRole("button", { name: "60 minutes", exact: true }).click();
  336 |   await finishPlanSetup(page);
  337 |   await page.getByRole("button", { name: "Generate my plan" }).click();
  338 |
  339 |   await expect(page.getByText("Plan ready")).toBeVisible();
  340 |   expect(planAttempts).toBe(3);
  341 |   expect(pageErrors).toEqual([]);
  342 | });
  343 |
  344 | test("changing the goal through Back replaces the old placement map", async ({ page }) => {
  345 |   await page.route("**/api/plans/generate**", async route => {
  346 |     const request = route.request().postDataJSON();
  347 |     if (request.knowledgeMap) return route.continue();
  348 |     const photosynthesis = request.goal.includes("photosynthesis");
  349 |     const title = photosynthesis ? "Photosynthesis and chloroplasts" : "Glycolysis products";
  350 |     const id = photosynthesis ? "91000000-0000-4000-8000-000000000002" : "91000000-0000-4000-8000-000000000001";
  351 |     const knowledgeMap = {
  352 |       version: 1, scopeJudgment: { band: "focused_skill", label: title, minimumSessions: 2, recommendedSessions: 2, maximumSessions: 4, minimumTeachingSessions: 1, explanation: "Learn this mapped idea, then check it independently without notes." },
  353 |       topics: [{ id, title, description: photosynthesis ? "Explain how chloroplasts use light energy to make glucose during photosynthesis." : "Explain that glycolysis turns glucose into two pyruvate, net two ATP and two NADH.", subtopics: [], prerequisiteTopicIds: [], status: "not_started", initialEvidence: null, sourceReferences: [], origin: "ai_generated", deferred: null }],
  354 |       placementCheck: { status: "available", completedAt: null, demonstratedTopicIds: [], gapTopicIds: [] },
  355 |     };
  356 |     await route.continue({ postData: JSON.stringify({ ...request, knowledgeMap }) });
  357 |   });
  358 |   await openPreviewApp(page);
  359 |   await page.getByRole("button", { name: /New plan|Build my first plan|Create another plan/ }).first().click();
  360 |   await page.getByPlaceholder(/I have a biology test/).fill("Learn glycolysis: where it happens and the net ATP, NADH and pyruvate products.");
  361 |   await page.getByRole("button", { name: "Continue", exact: true }).click();
  362 |   await page.getByRole("button", { name: /Create it for me/ }).click();
  363 |   await page.getByRole("button", { name: "Continue", exact: true }).click();
  364 |   const firstResponse = page.waitForResponse(response => response.url().includes("/api/plans/generate?mode=diagnostic"));
  365 |   await page.getByRole("button", { name: "Continue to placement check" }).click();
  366 |   const first = await (await firstResponse).json();
  367 |   expect(first.knowledgeMap.topics.length).toBeGreaterThan(0);
  368 |   await expect(page.getByRole("button", { name: "Skip for now" })).toBeVisible();
  369 |   // A timing edit reuses accepted scope instead of discarding it.
  370 |   await page.getByRole("button", { name: "Back", exact: true }).click();
  371 |   await page.getByRole("button", { name: "45 minutes", exact: true }).click();
  372 |   const timedResponse = page.waitForResponse(response => response.url().includes("/api/plans/generate?mode=diagnostic"));
  373 |   await page.getByRole("button", { name: "Continue to placement check" }).click();
  374 |   const timed = await (await timedResponse).json();
  375 |   expect(timed.knowledgeMap.topics).toEqual(first.knowledgeMap.topics);
  376 |   await expect(page.getByRole("heading", { name: timed.questions[0].prompt, exact: true })).toBeVisible();
  377 |   for (let step = 0; step < 3; step += 1) await page.getByRole("button", { name: "Back", exact: true }).click();
  378 |   await page.getByPlaceholder(/I have a biology test/).fill("Learn photosynthesis: chloroplasts, light absorption and glucose production.");
  379 |   await page.getByRole("button", { name: "Continue", exact: true }).click();
  380 |   await page.getByRole("button", { name: "Continue", exact: true }).click();
  381 |   const secondResponse = page.waitForResponse(response => response.url().includes("/api/plans/generate?mode=diagnostic"));
  382 |   await page.getByRole("button", { name: "Continue to placement check" }).click();
  383 |   const second = await (await secondResponse).json();
  384 |   await expect(page.getByRole("button", { name: "Skip for now" })).toBeVisible();
  385 |   console.info(JSON.stringify({oldTopics:first.knowledgeMap.topics.map((topic:{title:string})=>topic.title),newTopics:second.knowledgeMap.topics.map((topic:{title:string})=>topic.title),visibleQuestion:second.questions[0]?.prompt}));
  386 |   await expect(page.getByRole("heading", { name: second.questions[0].prompt, exact: true })).toBeVisible();
  387 |   expect(second.questions[0].prompt).toContain("Photosynthesis and chloroplasts");
  388 |   const originalIds = first.knowledgeMap.topics.map((topic:{id:string})=>topic.id);
  389 |   expect(second.knowledgeMap.topics.every((topic:{id:string})=>!originalIds.includes(topic.id)), "The new photosynthesis quiz must not reuse glycolysis identities").toBe(true);
  390 |   await page.getByRole("button", { name: "Skip for now" }).click();
  391 |   const planResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/plans/generate" && !new URL(response.url()).search);
  392 |   await page.getByRole("button", { name: "Generate my plan" }).click();
  393 |   const generated = await (await planResponse).json();
  394 |   await expect(page.getByText("Plan ready", { exact: true })).toBeVisible();
  395 |   await expect(page.locator(".generated-topic-map")).toContainText(/photosynthesis|chloroplast/i);
  396 |   expect(JSON.stringify(generated.plan.sessions)).not.toMatch(/glycolysis/i);
  397 | });
  398 |
  399 | function futureDate(days: number) {
  400 |   const now = new Date();
  401 |   const currentCalendarParts = new Intl.DateTimeFormat("en-US", {
  402 |     timeZone: TEST_TIME_ZONE,
  403 |     year: "numeric",
  404 |     month: "numeric",
  405 |     day: "numeric",
  406 |   }).formatToParts(now);
  407 |   const part = (type: Intl.DateTimeFormatPartTypes) => Number(
  408 |     currentCalendarParts.find((candidate) => candidate.type === type)?.value,
  409 |   );
  410 |   const local = new Date(Date.UTC(part("year"), part("month") - 1, part("day") + days, 12));
  411 |   const year = local.getUTCFullYear();
  412 |   const month = String(local.getUTCMonth() + 1).padStart(2, "0");
  413 |   const day = String(local.getUTCDate()).padStart(2, "0");
  414 |   return {
  415 |     date: local,
  416 |     input: `${year}-${month}-${day}`,
  417 |     monthShort: new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" }).format(local),
  418 |   };
  419 | }
  420 |
  421 | async function finishPlanSetup(page: Page) {
  422 |   await page.getByRole("button", { name: "Continue" }).click();
> 423 |   await expect(page.getByRole("button", { name: "Skip for now" })).toBeVisible();
      |                                                                    ^ Error: expect(locator).toBeVisible() failed
  424 |   await page.getByRole("button", { name: "Skip for now" }).click();
  425 |   await expect(page.getByRole("heading", { name: "Everything YOVA will use" })).toBeVisible();
  426 | }
  427 |
  428 | async function openPreviewApp(page: Page) {
  429 |   await page.goto("/?qa=preview");
  430 |   await page.getByRole("button", { name: "Build my plan" }).click();
  431 |   await page.getByLabel("First name").fill("Learner");
  432 |   await page.getByLabel("Email address").fill(`schedule-${crypto.randomUUID()}@example.com`);
  433 |   await page.getByRole("button", { name: "Continue" }).click();
  434 |   await page.getByRole("button", { name: /Personalize YOVA/ }).click();
  435 |
  436 |   for (const [index, answer] of onboardingAnswers.entries()) {
  437 |     await page.getByRole("button", { name: answer, exact: true }).click();
  438 |     await page.getByRole("button", { name: index === onboardingAnswers.length - 1 ? "Build my setup" : "Continue" }).click();
  439 |   }
  440 |
  441 |   await page.getByRole("button", { name: "Open YOVA" }).click();
  442 |   await expect(page.getByRole("heading", { name: /^Good (morning|afternoon|evening), Learner$/ })).toBeVisible();
  443 | }
  444 |
```
