# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: plan-schedule-date.spec.ts >> changing the goal through Back replaces the old placement map
- Location: e2e/plan-schedule-date.spec.ts:344:5

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: page.waitForResponse: Test timeout of 30000ms exceeded.
```

# Page snapshot

```yaml
- generic [active] [ref=f1e1]:
  - generic [ref=f1e2]:
    - link "Skip to main content" [ref=f1e3] [cursor=pointer]:
      - /url: "#main-content"
    - banner [ref=f1e4]:
      - generic [ref=f1e5]: "Y"
      - navigation "Main navigation" [ref=f1e7]:
        - button "Home" [ref=f1e8] [cursor=pointer]
        - button "Learning" [ref=f1e10] [cursor=pointer]
        - button "Calendar" [ref=f1e12] [cursor=pointer]
        - button "Ask YOVA" [ref=f1e14] [cursor=pointer]
        - button "You" [ref=f1e16] [cursor=pointer]
      - generic [ref=f1e18]:
        - button "Add to YOVA" [ref=f1e19] [cursor=pointer]:
          - generic [ref=f1e21]: Add
        - generic [ref=f1e22]:
          - generic "Learner · Private alpha" [ref=f1e23]: L
          - button "Sign out on this device" [ref=f1e24] [cursor=pointer]
    - main [ref=f1e28]:
      - generic [ref=f1e29]:
        - generic [ref=f1e30]:
          - generic [ref=f1e31]: WEDNESDAY, SEPTEMBER 9
          - heading [level=1] [ref=f1e32]:
            - text: Good morning,
            - emphasis [ref=f1e33]: Learner
        - generic [ref=f1e34]:
          - generic [ref=f1e35]: START HERE
          - heading "Turn any goal into a clear next step." [level=2] [ref=f1e36]
          - paragraph [ref=f1e37]: Use your own materials, let YOVA create the content, or get a plan for studying somewhere else.
          - generic [ref=f1e38]:
            - button "Build my first plan" [ref=f1e39] [cursor=pointer]
            - button "Study something now" [ref=f1e40] [cursor=pointer]
        - generic [ref=f1e41]:
          - generic [ref=f1e42]:
            - textbox "Ask YOVA" [ref=f1e43]:
              - /placeholder: Ask YOVA about anything you're studying…
            - button "Send" [disabled] [ref=f1e44]:
              - generic [ref=f1e45]: Ask
          - button "Add plan Notes, syllabus, link" [ref=f1e46] [cursor=pointer]:
            - generic [ref=f1e47]: +
            - generic [ref=f1e48]:
              - strong [ref=f1e49]: Add plan
              - generic [ref=f1e50]: Notes, syllabus, link
            - generic [ref=f1e51]: ›
          - button "Study now Quick, off-plan" [ref=f1e52] [cursor=pointer]:
            - generic [ref=f1e53]: →
            - generic [ref=f1e54]:
              - strong [ref=f1e55]: Study now
              - generic [ref=f1e56]: Quick, off-plan
            - generic [ref=f1e57]: ›
    - contentinfo [ref=f1e58]:
      - navigation "Trust and support" [ref=f1e59]:
        - link "Support" [ref=f1e60] [cursor=pointer]:
          - /url: /support
        - link "Privacy" [ref=f1e61] [cursor=pointer]:
          - /url: /privacy
        - link "Terms" [ref=f1e62] [cursor=pointer]:
          - /url: /terms
  - button "Open Next.js Dev Tools" [ref=f1e68] [cursor=pointer]
  - alert [ref=f1e72]
```

# Test source

```ts
  291 |           error: "The plan does not fit before the deadline.",
  292 |         }),
  293 |       });
  294 |       return;
  295 |     }
  296 |     await route.fulfill({
  297 |       status: 502,
  298 |       contentType: "application/json",
  299 |       body: JSON.stringify({ error: "Temporary planning service failure." }),
  300 |     });
  301 |   });
  302 |   await openPreviewApp(page);
  303 |
  304 |   await page.getByRole("button", { name: /New plan|Build my first plan|Create another plan/ }).first().click();
  305 |   await page.getByPlaceholder(/I have a biology test/).fill(
  306 |     "I have a biology test tomorrow on cellular respiration.",
  307 |   );
  308 |   await page.getByRole("button", { name: "Continue", exact: true }).click();
  309 |   await page.getByRole("button", { name: /Create it for me/ }).click();
  310 |   await page.getByRole("button", { name: "Continue", exact: true }).click();
  311 |   await page.getByRole("button", { name: "1–2 days", exact: true }).click();
  312 |   await page.getByRole("button", { name: "15 minutes", exact: true }).click();
  313 |
  314 |   await finishPlanSetup(page);
  315 |   await page.getByRole("button", { name: "Generate my plan" }).click();
  316 |
  317 |   const capacityGuidance = page.getByRole("alert").filter({
  318 |     hasText: "This plan needs more room before your target date.",
  319 |   });
  320 |   await expect(capacityGuidance).toContainText("Add another study day");
  321 |   await expect(capacityGuidance).toContainText("choose longer sessions");
  322 |   await expect(page.getByRole("heading", { name: "When would you prefer to study this material?" })).toBeVisible();
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
> 391 |   const planResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/plans/generate" && !new URL(response.url()).search);
      |                             ^ Error: page.waitForResponse: Test timeout of 30000ms exceeded.
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
  423 |   await expect(page.getByRole("button", { name: "Skip for now" })).toBeVisible();
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
