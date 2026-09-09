# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: core-learning-loop.spec.ts >> normal-plan review changes one offered method without regenerating or rewriting other routes
- Location: e2e/core-learning-loop.spec.ts:3363:5

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: locator.click: Test timeout of 30000ms exceeded.
Call log:
  - waiting for getByRole('button', { name: 'Skip for now' })

```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - button "Open Next.js Dev Tools" [ref=e7] [cursor=pointer]
  - alert [ref=e11]
  - main [ref=e12]:
    - generic [ref=e13]:
      - generic [ref=e14]: YOVA
      - button "Exit" [ref=e17] [cursor=pointer]
    - generic [ref=e20]:
      - heading "Preparing a short placement check…" [level=1] [ref=e25]
      - paragraph [ref=e26]: YOVA is sampling prerequisite and central topics from your knowledge map.
      - generic [ref=e27]:
        - generic [ref=e28]: Mapping the goal
        - generic [ref=e31]: Writing self-contained questions
```

# Test source

```ts
  3278 |   ));
  3279 |   expect(visibleLearnIndex, JSON.stringify(visibleDraftRoutes)).toBeGreaterThanOrEqual(0);
  3280 |   expect(visiblePracticeIndex, JSON.stringify(visibleDraftRoutes)).toBeGreaterThan(visibleLearnIndex);
  3281 | 
  3282 |   await page.getByRole("button", { name: "Use this plan" }).click();
  3283 |   await expect(page.getByRole("heading", { name: "Your plan" })).toBeVisible();
  3284 | 
  3285 |   const activatedRoutes = await page.evaluate(() => {
  3286 |     const raw = window.localStorage.getItem("yova.preview.v1");
  3287 |     if (!raw) throw new Error("Expected the activated conceptual plan in preview storage.");
  3288 |     const snapshot = JSON.parse(raw) as { plans?: LearningPlan[] };
  3289 |     const plan = snapshot.plans?.at(-1);
  3290 |     if (!plan) throw new Error("Expected the latest activated conceptual plan.");
  3291 |     return plan.sessions.map((session) => ({
  3292 |       title: session.title,
  3293 |       learningMode: session.learningMode,
  3294 |       routeMode: session.studyRoute?.approach.mode ?? null,
  3295 |       lifecycle: session.studyRoute?.identity.lifecycleStatus ?? null,
  3296 |     }));
  3297 |   });
  3298 |   expect(activatedRoutes.map((session) => session.title)).toEqual(
  3299 |     visibleDraftRoutes.map((session) => session.title),
  3300 |   );
  3301 |   const committedLearnIndex = activatedRoutes.findIndex((session) => (
  3302 |     session.learningMode === "learn" && session.routeMode === "learn"
  3303 |   ));
  3304 |   const committedPracticeIndex = activatedRoutes.findIndex((session, index) => (
  3305 |     index > committedLearnIndex
  3306 |     && session.learningMode === "study"
  3307 |     && session.routeMode === "practice"
  3308 |   ));
  3309 |   expect(committedLearnIndex, JSON.stringify(activatedRoutes)).toBe(visibleLearnIndex);
  3310 |   expect(committedPracticeIndex, JSON.stringify(activatedRoutes)).toBe(visiblePracticeIndex);
  3311 |   expect(activatedRoutes.every((session) => session.lifecycle === "committed")).toBe(true);
  3312 | });
  3313 | 
  3314 | test("map revision cannot activate a stale draft and fresh placement uses the revised map", async ({ page }) => {
  3315 |   let releaseUpdate: (() => void) | undefined;
  3316 |   let updateStarted = false;
  3317 |   let activated = 0;
  3318 |   let revisedMap: LearningPlan["knowledgeMap"];
  3319 |   const diagnosticMaps: unknown[] = [];
  3320 |   page.on("request", request => {
  3321 |     if (new URL(request.url()).pathname === "/api/plans/activate") activated += 1;
  3322 |   });
  3323 |   await page.route("**/api/plans/generate*", async route => {
  3324 |     const url = new URL(route.request().url());
  3325 |     const input = route.request().postDataJSON();
  3326 |     if (url.searchParams.get("mode") === "diagnostic") diagnosticMaps.push(input.knowledgeMap);
  3327 |     if (input.mapCorrection && url.searchParams.get("mode") !== "diagnostic") {
  3328 |       updateStarted = true;
  3329 |       await new Promise<void>(resolve => { releaseUpdate = resolve; });
  3330 |       const response = await route.fetch();
  3331 |       const body = await response.json();
  3332 |       revisedMap = body.plan.knowledgeMap;
  3333 |       await route.fulfill({ response, json: body });
  3334 |     } else await route.continue();
  3335 |   });
  3336 |   await createPreviewAccount(page);
  3337 |   await completeOnboarding(page);
  3338 |   await beginPlanFromAdd(page, "Build me a plan to understand cellular respiration from scratch.");
  3339 |   await page.getByRole("button", { name: "45 minutes", exact: true }).click();
  3340 |   await page.getByRole("button", { name: "Continue" }).click();
  3341 |   await page.getByRole("button", { name: "Skip for now" }).click();
  3342 |   await page.getByRole("button", { name: "Generate my plan" }).click();
  3343 |   await expect(page.getByText("Plan ready", { exact: true })).toBeVisible({ timeout: 30_000 });
  3344 |   await page.getByLabel("Requested topic map change").fill("Include a comparison of aerobic and anaerobic respiration.");
  3345 |   await page.getByRole("button", { name: "Update map and plan" }).click();
  3346 |   await expect.poll(() => updateStarted).toBe(true);
  3347 |   try {
  3348 |     await expect(page.getByRole("button", { name: "Use this plan" })).toBeDisabled();
  3349 |     for (const name of ["Change content", "Change source", "Change schedule", "Change starting level"]) {
  3350 |       await expect(page.getByRole("button", { name, exact: true })).toBeDisabled();
  3351 |     }
  3352 |     expect(activated).toBe(0);
  3353 |   } finally { releaseUpdate?.(); }
  3354 |   await expect(page.getByRole("status").filter({ hasText: "Map updated:" })).toBeVisible({ timeout: 30_000 });
  3355 |   await page.getByRole("button", { name: "Change starting level" }).click();
  3356 |   await expect(page.getByRole("button", { name: "Skip for now" })).toBeVisible({ timeout: 30_000 });
  3357 |   expect(diagnosticMaps.length).toBe(2);
  3358 |   expect((diagnosticMaps[1] as NonNullable<LearningPlan["knowledgeMap"]>).topics.map(topic => topic.id))
  3359 |     .toEqual(revisedMap?.topics.map(topic => topic.id));
  3360 |   expect(activated).toBe(0);
  3361 | });
  3362 | 
  3363 | test("normal-plan review changes one offered method without regenerating or rewriting other routes", async ({ page }) => {
  3364 |   let planGenerationRequests = 0;
  3365 |   page.on("request", (request) => {
  3366 |     if (new URL(request.url()).pathname === "/api/plans/generate") {
  3367 |       planGenerationRequests += 1;
  3368 |     }
  3369 |   });
  3370 | 
  3371 |   await createPreviewAccount(page);
  3372 |   await completeOnboarding(page);
  3373 | 
  3374 |   await beginPlanFromAdd(page, "I have a biology test next Friday on cellular respiration.");
  3375 |   await expect(page.getByRole("heading", { name: "When would you prefer to study this material?" })).toBeVisible();
  3376 |   await page.getByRole("button", { name: "45 minutes", exact: true }).click();
  3377 |   await page.getByRole("button", { name: "Continue" }).click();
> 3378 |   await page.getByRole("button", { name: "Skip for now" }).click();
       |                                                            ^ Error: locator.click: Test timeout of 30000ms exceeded.
  3379 |   await page.getByRole("button", { name: "Generate my plan" }).click();
  3380 |   await expect(page.getByText("Plan ready")).toBeVisible({ timeout: 30_000 });
  3381 | 
  3382 |   const generationCountBeforeChoice = planGenerationRequests;
  3383 |   const targetSession = page.getByRole("article", { name: /^Session 1:/ });
  3384 |   const methodDecision = targetSession.locator("details.generated-method-reason");
  3385 |   const methodName = targetSession.locator(":scope > div > p").first();
  3386 |   const methodReason = methodDecision.locator(":scope > p");
  3387 |   const originalMethod = (await methodName.innerText()).trim();
  3388 |   const originalReason = (await methodReason.innerText()).trim();
  3389 | 
  3390 |   await methodDecision.locator("summary").click();
  3391 |   await methodDecision.getByRole("button", { name: "Change method" }).click();
  3392 |   const alternatives = methodDecision.getByRole("group", {
  3393 |     name: /^Other methods that also fit for /,
  3394 |   });
  3395 |   const alternative = alternatives.getByRole("button").first();
  3396 |   const alternativeName = (await alternative.locator("strong").innerText()).trim();
  3397 |   expect(alternativeName).not.toBe(originalMethod);
  3398 | 
  3399 |   const methodChoiceResponsePromise = page.waitForResponse((response) => (
  3400 |     new URL(response.url()).pathname === "/api/plans/method-choice"
  3401 |     && response.request().method() === "POST"
  3402 |   ));
  3403 |   await alternative.click();
  3404 |   const methodChoiceResponse = await methodChoiceResponsePromise;
  3405 |   expect(methodChoiceResponse.ok()).toBe(true);
  3406 | 
  3407 |   const requestPayload = methodChoiceResponse.request().postDataJSON() as {
  3408 |     plan: LearningPlan;
  3409 |     selection: { sessionId: string; methodId: string };
  3410 |   };
  3411 |   const responsePayload = await methodChoiceResponse.json() as {
  3412 |     plan: LearningPlan;
  3413 |     revision: { status: string };
  3414 |   };
  3415 |   expect(responsePayload.revision.status).toBe("updated");
  3416 |   expect(requestPayload.selection.methodId).toBe(
  3417 |     responsePayload.plan.sessions.find((session) => session.id === requestPayload.selection.sessionId)
  3418 |       ?.studyRoute?.approach.primaryMethodId,
  3419 |   );
  3420 | 
  3421 |   const beforeRouteIds = new Map(requestPayload.plan.sessions.map((session) => [
  3422 |     session.id,
  3423 |     session.studyRoute?.identity.routeRevisionId ?? null,
  3424 |   ]));
  3425 |   const afterRouteIds = new Map(responsePayload.plan.sessions.map((session) => [
  3426 |     session.id,
  3427 |     session.studyRoute?.identity.routeRevisionId ?? null,
  3428 |   ]));
  3429 |   for (const [sessionId, routeRevisionId] of beforeRouteIds) {
  3430 |     if (sessionId === requestPayload.selection.sessionId) {
  3431 |       expect(afterRouteIds.get(sessionId)).not.toBe(routeRevisionId);
  3432 |     } else {
  3433 |       expect(afterRouteIds.get(sessionId)).toBe(routeRevisionId);
  3434 |     }
  3435 |   }
  3436 | 
  3437 |   await expect(methodName).toHaveText(alternativeName);
  3438 |   await expect(methodReason).toContainText(`You chose ${alternativeName}`);
  3439 |   expect((await methodReason.innerText()).trim()).not.toBe(originalReason);
  3440 |   await expect(targetSession.getByRole("status")).toContainText(`${alternativeName} is now part of this draft.`);
  3441 |   expect(planGenerationRequests).toBe(generationCountBeforeChoice);
  3442 | 
  3443 |   await page.getByRole("button", { name: "Use this plan" }).click();
  3444 |   await expect(page.getByRole("heading", { name: "Your plan" })).toBeVisible();
  3445 | 
  3446 |   const storedPlan = await page.evaluate((planId) => {
  3447 |     const raw = window.localStorage.getItem("yova.preview.v1");
  3448 |     if (!raw) throw new Error("Expected the activated plan in preview storage.");
  3449 |     const snapshot = JSON.parse(raw) as { plans?: LearningPlan[] };
  3450 |     const plan = snapshot.plans?.find((candidate) => candidate.id === planId);
  3451 |     if (!plan) throw new Error("Expected the revised plan to be activated.");
  3452 |     return plan;
  3453 |   }, responsePayload.plan.id);
  3454 |   const storedTarget = storedPlan.sessions.find((session) => (
  3455 |     session.id === requestPayload.selection.sessionId
  3456 |   ));
  3457 |   expect(storedTarget).toBeDefined();
  3458 |   expect(storedTarget?.method).toBe(alternativeName);
  3459 |   expect(storedTarget?.studyRoute?.approach.visibleMethodName).toBe(alternativeName);
  3460 |   expect(storedTarget?.studyRoute?.identity.lifecycleStatus).toBe("committed");
  3461 |   expect(storedTarget?.studyRoute?.identity.routeRevisionId).toBe(
  3462 |     afterRouteIds.get(requestPayload.selection.sessionId),
  3463 |   );
  3464 |   expect(storedTarget?.studyRoute?.agency).toMatchObject({
  3465 |     selectedBy: "learner",
  3466 |     controlMode: "learner_customizes",
  3467 |     override: { changedFields: ["primary_method"] },
  3468 |   });
  3469 |   for (const storedSession of storedPlan.sessions) {
  3470 |     if (storedSession.id === requestPayload.selection.sessionId) continue;
  3471 |     expect(storedSession.studyRoute?.identity.routeRevisionId).toBe(beforeRouteIds.get(storedSession.id));
  3472 |     expect(storedSession.studyRoute?.agency.selectedBy).toBe("yova");
  3473 |   }
  3474 | });
  3475 | 
  3476 | test("session setup changes one committed method and generates from its exact successor route", async ({ page }) => {
  3477 |   let planGenerationRequests = 0;
  3478 |   const sessionGenerationRequests: Array<Record<string, unknown>> = [];
```