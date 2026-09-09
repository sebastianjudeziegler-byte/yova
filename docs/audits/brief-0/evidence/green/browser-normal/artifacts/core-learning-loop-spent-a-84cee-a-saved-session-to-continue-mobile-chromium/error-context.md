# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: core-learning-loop.spec.ts >> spent allowance still permits a saved session to continue
- Location: e2e/core-learning-loop.spec.ts:2356:5

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: locator.click: Test timeout of 30000ms exceeded.
Call log:
  - waiting for getByRole('region', { name: 'Recommended learning plan' }).getByRole('button', { name: 'Continue session' })
    - locator resolved to <button class="yv-pill primary large">Continue session</button>
  - attempting click action
    - waiting for element to be visible, enabled and stable
    - element is visible, enabled and stable
    - scrolling into view if needed
    - done scrolling
    - performing click action

```

# Page snapshot

```yaml
- generic [ref=f1e1]:
  - generic [ref=f1e2]:
    - link "Skip to main content" [ref=f1e3] [cursor=pointer]:
      - /url: "#main-content"
    - banner [ref=f1e4]:
      - generic [ref=f1e5]: "Y"
      - navigation "Main navigation" [ref=f1e7]:
        - button "Home" [active] [ref=f1e8] [cursor=pointer]
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
          - generic [ref=f1e31]: TUESDAY, SEPTEMBER 8
          - heading [level=1] [ref=f1e32]:
            - text: Good afternoon,
            - emphasis [ref=f1e33]: Learner
        - status "Guided-session allowance" [ref=f1e34]:
          - generic [ref=f1e39]:
            - generic [ref=f1e40]: GUIDED SESSION ALLOWANCE
            - strong [ref=f1e41]: Daily guided-session allowance used
            - paragraph [ref=f1e42]:
              - text: You can still continue a session that was already saved. New guided sessions are available after
              - time [ref=f1e43]: Wednesday, August 19, 2026 at 5:00 PM
              - text: .
        - generic [ref=f1e44]:
          - region "Recommended learning plan" [ref=f1e45]:
            - generic [ref=f1e46]:
              - generic [ref=f1e47]: CONTINUE · PROGRESS SAVED
              - heading "Learn Practice explaining how thermohaline circulation..." [level=2] [ref=f1e48]
              - generic [ref=f1e49]:
                - generic [ref=f1e50]: Learn
                - generic [ref=f1e51]: Feynman Technique
                - generic [ref=f1e52]: 25 minutes
              - paragraph [ref=f1e53]:
                - strong [ref=f1e54]: WHY THIS ·
                - text: Feynman Technique fits this task and your starting point. It helps you build understanding before you try it yourself.
              - paragraph [ref=f1e55]:
                - generic [ref=f1e59]:
                  - strong [ref=f1e60]: "Personalized today:"
                  - text: Example first · One step at a time · Hint first
                - button "Why?" [ref=f1e61] [cursor=pointer]
            - generic [ref=f1e62]:
              - button "Continue session" [ref=f1e63] [cursor=pointer]
              - generic [ref=f1e64]: 0 of 1 sessions complete
          - generic [ref=f1e65]:
            - generic [ref=f1e66]:
              - heading "Today" [level=3] [ref=f1e67]
              - button "Calendar →" [ref=f1e68] [cursor=pointer]
            - generic [ref=f1e69]:
              - generic [ref=f1e70]: PM
              - generic [ref=f1e71]:
                - strong [ref=f1e72]: Learn Practice explaining how thermohaline circulation...
                - generic [ref=f1e73]: Focused session · about 25 min · up next
            - generic [ref=f1e74]:
              - generic [ref=f1e75]:
                - strong [ref=f1e76]: "0"
                - generic [ref=f1e77]: sessions completed
              - generic [ref=f1e78]:
                - strong [ref=f1e79]: "1"
                - generic [ref=f1e80]: active plan
        - generic [ref=f1e81]:
          - generic [ref=f1e82]:
            - textbox "Ask YOVA" [ref=f1e83]:
              - /placeholder: Ask YOVA about anything you're studying…
            - button "Send" [disabled] [ref=f1e84]:
              - generic [ref=f1e85]: Ask
          - button "Add plan Notes, syllabus, link" [ref=f1e86] [cursor=pointer]:
            - generic [ref=f1e87]: +
            - generic [ref=f1e88]:
              - strong [ref=f1e89]: Add plan
              - generic [ref=f1e90]: Notes, syllabus, link
            - generic [ref=f1e91]: ›
          - button "Study now Quick, off-plan" [disabled] [ref=f1e92]:
            - generic [ref=f1e93]: →
            - generic [ref=f1e94]:
              - strong [ref=f1e95]: Study now
              - generic [ref=f1e96]: Quick, off-plan
            - generic [ref=f1e97]: ›
        - generic [ref=f1e98]:
          - heading "YOVA noticed" [level=3] [ref=f1e99]
          - generic [ref=f1e100]: from your recent sessions
        - generic [ref=f1e102]:
          - generic [ref=f1e103]:
            - generic [ref=f1e104]: "Y"
            - generic [ref=f1e105]: PERSONALIZATION
          - generic [ref=f1e106]:
            - strong [ref=f1e107]: Complete one guided session so YOVA can compare your profile with real work.
            - text: Onboarding creates a starting hypothesis. Answer accuracy, support use, completion, and feedback are what let YOVA adjust responsibly.
            - emphasis [ref=f1e108]: No completed-session evidence yet
          - button "Start the recommended session" [ref=f1e110] [cursor=pointer]
        - generic [ref=f1e111]:
          - heading "Your week" [level=3] [ref=f1e112]
          - generic [ref=f1e113]: Sep 8 – 12
        - generic [ref=f1e114]:
          - generic [ref=f1e115]:
            - generic [ref=f1e116]: TUE · TODAY
            - strong [ref=f1e117]: Learn Practice explaining how thermohaline circulation...
            - generic [ref=f1e118]: 25 min · 1 session
          - generic [ref=f1e119]:
            - generic [ref=f1e120]: WED
            - strong [ref=f1e121]: Open
            - generic [ref=f1e122]: nothing scheduled
          - generic [ref=f1e123]:
            - generic [ref=f1e124]: THU
            - strong [ref=f1e125]: Open
            - generic [ref=f1e126]: nothing scheduled
          - generic [ref=f1e127]:
            - generic [ref=f1e128]: FRI
            - strong [ref=f1e129]: Open
            - generic [ref=f1e130]: nothing scheduled
          - generic [ref=f1e131]:
            - generic [ref=f1e132]: SAT
            - strong [ref=f1e133]: Open
            - generic [ref=f1e134]: nothing scheduled
        - generic [ref=f1e135]:
          - heading "Pick up where you left off" [level=3] [ref=f1e136]
          - generic [ref=f1e137]: 1 open thread
        - generic [ref=f1e139]:
          - generic [ref=f1e140]: PRACTICE EXPLAINING HOW THERMOHALINE CIRCULATION MOVES WATER…
          - strong [ref=f1e141]: Learn Practice explaining how thermohaline circulation...
          - generic [ref=f1e142]: 0 of 5 sections saved
          - generic [ref=f1e143]: 0%
          - button "Resume" [ref=f1e146] [cursor=pointer]
        - generic [ref=f1e147]:
          - heading "Where you stand" [level=3] [ref=f1e148]
          - generic [ref=f1e149]: updates after every session
        - 'button "Practice Explaining How Thermohaline Circulation Moves Water… 0% 0 of 1 topics secure · next: practice explaining how thermohaline circulation moves water through the oceans." [ref=f1e151] [cursor=pointer]':
          - generic [ref=f1e152]:
            - strong [ref=f1e153]: Practice Explaining How Thermohaline Circulation Moves Water…
            - generic [ref=f1e154]: 0%
          - generic [ref=f1e155]: "0 of 1 topics secure · next: practice explaining how thermohaline circulation moves water through the oceans."
        - generic [ref=f1e156]:
          - heading "Your learning" [level=3] [ref=f1e157]
          - generic [ref=f1e158]: 1 active
        - button "Practice Explaining How Thermohaline Circulation Moves Water… Continue at section 1" [ref=f1e160] [cursor=pointer]:
          - generic [ref=f1e165]:
            - strong [ref=f1e166]: Practice Explaining How Thermohaline Circulation Moves Water…
            - generic [ref=f1e167]: Continue at section 1
    - contentinfo [ref=f1e170]:
      - navigation "Trust and support" [ref=f1e171]:
        - link "Support" [ref=f1e172] [cursor=pointer]:
          - /url: /support
        - link "Privacy" [ref=f1e173] [cursor=pointer]:
          - /url: /privacy
        - link "Terms" [ref=f1e174] [cursor=pointer]:
          - /url: /terms
  - button "Open Next.js Dev Tools" [ref=f1e180] [cursor=pointer]
  - alert [ref=f1e184]
```

# Test source

```ts
  2315 |     response.url().includes("/api/sessions/allowance")
  2316 |   ));
  2317 |   await completeOnboarding(page);
  2318 |   await initialAllowanceResponse;
  2319 |   await expect(page.getByRole("button", { name: "Study now Quick, off-plan" })).toBeEnabled();
  2320 |   await expect(page.getByLabel("Guided-session allowance")).toHaveCount(0);
  2321 |
  2322 |   await page.getByRole("button", { name: "Calendar", exact: true }).click();
  2323 |   await expect(page.getByLabel("Guided-session allowance")).toHaveCount(0);
  2324 |   await page.getByRole("button", { name: "Home", exact: true }).click();
  2325 |   await page.getByRole("button", { name: "Study something now", exact: true }).first().click();
  2326 |   await page.getByPlaceholder("Example: Help me understand the product rule and practice using it.").fill(
  2327 |     "Review how plate boundaries shape ocean basins.",
  2328 |   );
  2329 |   await page.getByRole("button", { name: "I understand the basics but need practice" }).click();
  2330 |   await page.getByRole("button", { name: /Choose how YOVA should help/ }).click();
  2331 |   await page.getByRole("button", { name: /Create it for me/ }).click();
  2332 |   await page.getByRole("button", { name: /Build and start session/ }).click();
  2333 |   await openExistingStudyNowSetup(page);
  2334 |   await page.getByRole("button", { name: "Not now", exact: true }).click();
  2335 |
  2336 |   allowanceExhausted = true;
  2337 |   await page.reload();
  2338 |
  2339 |   const homeAllowance = page.locator(".guided-session-allowance-notice.home");
  2340 |   await expect(homeAllowance).toContainText("Daily guided-session allowance used");
  2341 |   await expect(homeAllowance.locator("time")).toHaveAttribute("datetime", resetAt);
  2342 |   await expect(homeAllowance).toContainText("continue a session that was already saved");
  2343 |   await expect(page.getByRole("button", { name: "Allowance used today" }).first()).toBeDisabled();
  2344 |   await expect(page.getByRole("button", { name: "Study now Quick, off-plan" })).toBeDisabled();
  2345 |   await expect(page.getByRole("heading", { name: "Here is how YOVA plans to start." })).not.toBeVisible();
  2346 |
  2347 |   await page.getByRole("button", { name: "Calendar", exact: true }).click();
  2348 |   const agendaAllowance = page.locator(".guided-session-allowance-notice.agenda");
  2349 |   await expect(agendaAllowance).toContainText("Daily guided-session allowance used");
  2350 |   await expect(agendaAllowance.locator("time")).toHaveAttribute("datetime", resetAt);
  2351 |   const blockedAgendaStarts = page.getByRole("button", { name: "Allowance used today" });
  2352 |   await expect(blockedAgendaStarts.first()).toBeDisabled();
  2353 |   await expect(page.getByRole("heading", { name: "Here is how YOVA plans to start." })).not.toBeVisible();
  2354 | });
  2355 |
  2356 | test("spent allowance still permits a saved session to continue", async ({ page }) => {
  2357 |   const resetAt = "2026-08-20T00:00:00.000Z";
  2358 |   let allowanceExhausted = false;
  2359 |   let generationRequests = 0;
  2360 |   await page.route("**/api/sessions/allowance", async (route) => {
  2361 |     await route.fulfill({
  2362 |       status: 200,
  2363 |       contentType: "application/json",
  2364 |       headers: allowanceExhausted ? { "Retry-After": "7200" } : {},
  2365 |       body: JSON.stringify(allowanceExhausted
  2366 |         ? {
  2367 |           status: "exhausted",
  2368 |           remainingToday: 0,
  2369 |           retryAfterSeconds: 7_200,
  2370 |           resetAt,
  2371 |         }
  2372 |         : {
  2373 |           status: "available",
  2374 |           remainingToday: 2,
  2375 |           retryAfterSeconds: 0,
  2376 |           resetAt: null,
  2377 |         }),
  2378 |     });
  2379 |   });
  2380 |   await page.route("**/api/sessions/generate", async (route) => {
  2381 |     generationRequests += 1;
  2382 |     await route.fulfill({
  2383 |       status: 200,
  2384 |       contentType: "application/json",
  2385 |       body: JSON.stringify(streamedResumeSessionResponse(requestedRouteRevisionId(route))),
  2386 |     });
  2387 |   });
  2388 |
  2389 |   await createPreviewAccount(page);
  2390 |   await completeOnboarding(page);
  2391 |   await createOneOffLearningSession(
  2392 |     page,
  2393 |     "Practice explaining how thermohaline circulation moves water through the oceans.",
  2394 |     "study",
  2395 |   );
  2396 |   await expect(page.getByRole("button", { name: "Exit" })).toBeVisible();
  2397 |   await exitSessionWithoutProgress(page);
  2398 |
  2399 |   allowanceExhausted = true;
  2400 |   await page.reload();
  2401 |
  2402 |   await expect(page.locator(".guided-session-allowance-notice.home")).toContainText(
  2403 |     "Daily guided-session allowance used",
  2404 |   );
  2405 |   await expect(recommendedLearningPlan(page).getByRole("button", { name: "Continue session" })).toBeEnabled();
  2406 |   await expect(page.getByRole("button", { name: "Study now Quick, off-plan" })).toBeDisabled();
  2407 |
  2408 |   await page.getByRole("button", { name: "Calendar", exact: true }).click();
  2409 |   await expect(page.locator(".guided-session-allowance-notice.agenda")).toContainText(
  2410 |     "Daily guided-session allowance used",
  2411 |   );
  2412 |   await expect(page.locator(".calendar-your-day").getByRole("button", { name: "Continue" })).toBeEnabled();
  2413 |
  2414 |   await page.getByRole("button", { name: "Home", exact: true }).click();
> 2415 |   await recommendedLearningPlan(page).getByRole("button", { name: "Continue session" }).click();
       |                                                                                         ^ Error: locator.click: Test timeout of 30000ms exceeded.
  2416 |   await expect(page.getByRole("button", { name: "Change direction" })).toBeVisible();
  2417 |   await expect(page.getByText("Your session was recovered.")).toBeVisible();
  2418 |   expect(generationRequests).toBe(1);
  2419 | });
  2420 |
  2421 | test("the product shell keeps every core destination and creation path usable", async ({ page }) => {
  2422 |   await createPreviewAccount(page);
  2423 |   await completeOnboarding(page);
  2424 |
  2425 |   await expect(page.getByRole("heading", { name: /^Good (morning|afternoon|evening), Learner$/ })).toBeVisible();
  2426 |   await expect(page.getByRole("heading", { name: "Turn any goal into a clear next step." })).toBeVisible();
  2427 |   await expectNoHorizontalOverflow(page, ".home-page");
  2428 |
  2429 |   await page.getByRole("button", { name: "Learning", exact: true }).click();
  2430 |   await expect(page.getByRole("heading", { name: "What you’re working toward" })).toBeVisible();
  2431 |   await expectNoHorizontalOverflow(page, ".page");
  2432 |
  2433 |   await page.getByRole("button", { name: "Calendar", exact: true }).click();
  2434 |   await expect(page.getByRole("heading", { name: "Plan the work that gets you there" })).toBeVisible();
  2435 |   await expectNoHorizontalOverflow(page, ".page");
  2436 |
  2437 |   await page.getByRole("button", { name: "Ask YOVA", exact: true }).click();
  2438 |   await expect(page.getByRole("heading", { name: "Get help in context" })).toBeVisible();
  2439 |   await expectNoHorizontalOverflow(page, ".page");
  2440 |   await expect(page.getByRole("combobox", { name: "Ask YOVA context" })).toHaveValue("general");
  2441 |   await expect(page.getByText("No learning goal attached")).toBeVisible();
  2442 |   await page.getByRole("button", { name: /^History/ }).click();
  2443 |   await expect(page.getByRole("dialog", { name: "Previous chats" })).toBeVisible();
  2444 |   await page.getByRole("button", { name: "Close conversation history" }).last().click();
  2445 |   await page.getByRole("textbox", { name: "Ask YOVA" }).fill("An unsent draft");
  2446 |
  2447 |   await page.getByRole("button", { name: "You", exact: true }).click();
  2448 |   await expect(page.getByRole("heading", { name: "Your learning, in one place" })).toBeVisible();
  2449 |   await expectNoHorizontalOverflow(page, ".page");
  2450 |   await page.getByRole("button", { name: "Ask YOVA", exact: true }).click();
  2451 |   await expect(page.getByRole("combobox", { name: "Ask YOVA context" })).toHaveValue("general");
  2452 |   await expect(page.getByRole("textbox", { name: "Ask YOVA" })).toHaveValue("");
  2453 |   await page.getByRole("button", { name: "You", exact: true }).click();
  2454 |
  2455 |   await page.getByRole("button", { name: "Home", exact: true }).click();
  2456 |   await page.getByRole("button", { name: "Build my first plan", exact: true }).click();
  2457 |   await expect(page.getByRole("heading", { name: "What do you need to learn or prepare for?" })).toBeVisible();
  2458 |   await page.getByRole("button", { name: "Cancel" }).click();
  2459 |
  2460 |   await page.getByRole("button", { name: "Calendar", exact: true }).click();
  2461 |   await page.locator(".calendar-page-header").getByRole("button", { name: "Add to YOVA", exact: true }).click();
  2462 |   await expect(page.getByRole("heading", { name: "What would you like to add?" })).toBeVisible();
  2463 |   await page.getByRole("button", { name: "Cancel" }).click();
  2464 |   await page.getByRole("button", { name: "Home", exact: true }).click();
  2465 |
  2466 |   await page.getByRole("button", { name: "Study something now", exact: true }).first().click();
  2467 |   await expect(page.getByRole("heading", { name: "What do you want help with?" })).toBeVisible();
  2468 | });
  2469 |
  2470 | test("Ask YOVA turns structured explanations and math into readable interface content", async ({ page }) => {
  2471 |   await createPreviewAccount(page);
  2472 |   await completeOnboarding(page);
  2473 |
  2474 |   await page.route("**/api/tutor", async (route) => {
  2475 |     if (route.request().method() !== "POST") {
  2476 |       await route.continue();
  2477 |       return;
  2478 |     }
  2479 |     const threadId = "10000000-0000-4000-8000-000000000001";
  2480 |     await route.fulfill({
  2481 |       status: 200,
  2482 |       contentType: "application/json",
  2483 |       body: JSON.stringify({
  2484 |         threadId,
  2485 |         messages: [
  2486 |           {
  2487 |             id: "10000000-0000-4000-8000-000000000002",
  2488 |             threadId,
  2489 |             role: "user",
  2490 |             content: "Explain the derivative at x equals 2.",
  2491 |             createdAt: "2026-08-06T20:00:00.000Z",
  2492 |           },
  2493 |           {
  2494 |             id: "10000000-0000-4000-8000-000000000003",
  2495 |             threadId,
  2496 |             role: "assistant",
  2497 |             content: "**Core idea:** the derivative is the instantaneous rate of change.\n\nUse $f'(2)=4$.\n\n1. Compare nearby points.\n2. Shrink the interval.",
  2498 |             createdAt: "2026-08-06T20:00:01.000Z",
  2499 |           },
  2500 |         ],
  2501 |         model: "test-model",
  2502 |         persistence: "browser",
  2503 |         proposedAction: null,
  2504 |       }),
  2505 |     });
  2506 |   });
  2507 |
  2508 |   await page.getByRole("button", { name: "Ask YOVA", exact: true }).click();
  2509 |   await page.getByRole("textbox", { name: "Ask YOVA" }).fill("Explain the derivative at x equals 2.");
  2510 |   await page.getByRole("button", { name: "Send" }).click();
  2511 |
  2512 |   await expect(page.locator(".tutor-rich-text strong")).toHaveText("Core idea:");
  2513 |   await expect(page.locator(".tutor-rich-text .katex")).toBeVisible();
  2514 |   await expect(page.locator(".tutor-rich-text li")).toHaveCount(2);
  2515 |   await expect(page.locator(".tutor-rich-text")).not.toContainText("**");
```
