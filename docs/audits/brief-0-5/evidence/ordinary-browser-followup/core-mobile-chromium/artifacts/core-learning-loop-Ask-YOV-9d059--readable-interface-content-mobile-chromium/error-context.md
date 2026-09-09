# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: core-learning-loop.spec.ts >> Ask YOVA turns structured explanations and math into readable interface content
- Location: e2e/core-learning-loop.spec.ts:2470:5

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: expect(locator).toHaveText(expected) failed

Locator: locator('.tutor-rich-text strong')
Expected: "Core idea:"
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toHaveText" with timeout 5000ms
  - waiting for locator('.tutor-rich-text strong')

```

```yaml
- alert
- link "Skip to main content":
  - /url: "#main-content"
- banner:
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
  - text: ASK YOVA
  - heading "Get help in context" [level=1]
  - paragraph: Start general, or connect a learning goal when YOVA needs its materials and progress.
  - text: Context
  - combobox "Ask YOVA context" [disabled]:
    - option "General" [selected]
  - button "New chat" [disabled]
  - button "History"
  - text: General conversation
  - strong: No learning goal attached
  - text: Choose a goal above only when its specific context would help.
  - strong: YOVA
  - paragraph: What would you like help with? This is a fresh general conversation. You can attach a learning goal at any time.
  - strong: You
  - paragraph: Explain the derivative at x equals 2.
  - textbox "Ask YOVA" [disabled]:
    - /placeholder: Ask YOVA anything or describe what you need…
  - button "Send" [disabled]
  - text: General mode does not use a specific plan or its materials.
- contentinfo:
  - navigation "Trust and support":
    - link "Support":
      - /url: /support
    - link "Privacy":
      - /url: /privacy
    - link "Terms":
      - /url: /terms
```

# Test source

```ts
  2412 |   await expect(page.locator(".calendar-your-day").getByRole("button", { name: "Continue" })).toBeEnabled();
  2413 | 
  2414 |   await page.getByRole("button", { name: "Home", exact: true }).click();
  2415 |   await recommendedLearningPlan(page).getByRole("button", { name: "Continue session" }).click();
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
> 2512 |   await expect(page.locator(".tutor-rich-text strong")).toHaveText("Core idea:");
       |                                                         ^ Error: expect(locator).toHaveText(expected) failed
  2513 |   await expect(page.locator(".tutor-rich-text .katex")).toBeVisible();
  2514 |   await expect(page.locator(".tutor-rich-text li")).toHaveCount(2);
  2515 |   await expect(page.locator(".tutor-rich-text")).not.toContainText("**");
  2516 | });
  2517 | 
  2518 | test("the session tutor stays anchored to the exact learning activity", async ({ page }) => {
  2519 |   await createPreviewAccount(page);
  2520 |   await completeOnboarding(page);
  2521 | 
  2522 |   let capturedRequest: { sessionContext?: Record<string, unknown> } = {};
  2523 |   await page.route("**/api/tutor", async (route) => {
  2524 |     if (route.request().method() !== "POST") {
  2525 |       await route.continue();
  2526 |       return;
  2527 |     }
  2528 |     capturedRequest = route.request().postDataJSON() as { sessionContext?: Record<string, unknown> };
  2529 |     const threadId = "20000000-0000-4000-8000-000000000001";
  2530 |     await route.fulfill({
  2531 |       status: 200,
  2532 |       contentType: "application/json",
  2533 |       body: JSON.stringify({
  2534 |         threadId,
  2535 |         messages: [
  2536 |           {
  2537 |             id: "20000000-0000-4000-8000-000000000002",
  2538 |             threadId,
  2539 |             role: "user",
  2540 |             content: "Show me one concrete example of the idea in this step.",
  2541 |             createdAt: "2026-08-06T21:00:00.000Z",
  2542 |           },
  2543 |           {
  2544 |             id: "20000000-0000-4000-8000-000000000003",
  2545 |             threadId,
  2546 |             role: "assistant",
  2547 |             content: "**Example:** if $100$ grows by $10$, the new base is $110$. The next percentage gain uses that larger base.",
  2548 |             createdAt: "2026-08-06T21:00:01.000Z",
  2549 |           },
  2550 |         ],
  2551 |         model: "test-model",
  2552 |         persistence: "browser",
  2553 |         proposedAction: null,
  2554 |       }),
  2555 |     });
  2556 |   });
  2557 | 
  2558 |   await page.getByRole("button", { name: "Study something now", exact: true }).first().click();
  2559 |   await page.getByPlaceholder("Example: Help me understand the product rule and practice using it.").fill(
  2560 |     "Help me understand compound growth and personal finance basics.",
  2561 |   );
  2562 |   await page.getByRole("button", { name: "I haven't learned this yet" }).click();
  2563 |   await page.getByRole("button", { name: /Choose how YOVA should help/ }).click();
  2564 |   await page.getByRole("button", { name: /Create it for me/ }).click();
  2565 |   await page.getByRole("button", { name: /Build and start session/ }).click();
  2566 |   await confirmSessionSetup(page);
  2567 | 
  2568 |   await expect(page.getByRole("heading", { name: "Use money concepts as decision tools" })).toBeVisible();
  2569 |   await page.getByRole("button", { name: "Ask YOVA", exact: true }).click();
  2570 |   await expect(page.getByRole("button", { name: "Explain it differently" })).toBeVisible();
  2571 |   await expect(page.getByRole("button", { name: "Show an example" })).toBeVisible();
  2572 |   await expect(page.getByRole("button", { name: "Check my understanding" })).toBeVisible();
  2573 |   await page.getByRole("button", { name: "Show an example" }).click();
  2574 | 
  2575 |   await expect(page.locator(".session-tutor-assistant .tutor-rich-text strong")).toHaveText("Example:");
  2576 |   await expect(page.locator(".session-tutor-assistant .katex").first()).toBeVisible();
  2577 |   await expect(page.locator(".session-tutor-response")).not.toContainText("**");
  2578 |   await expect(page.getByText("YOVA sees the step and result, but not your typed free response.")).toBeVisible();
  2579 | 
  2580 |   const sessionContext = capturedRequest.sessionContext ?? {};
  2581 |   expect(sessionContext.activityTitle).toBe("Use money concepts as decision tools");
  2582 |   expect(sessionContext.activityType).toBe("instruction");
  2583 |   expect(sessionContext.helpIntent).toBe("show_example");
  2584 |   expect(sessionContext.answerState).toBe("not_attempted");
  2585 |   expect(sessionContext.selectedChoice).toBeNull();
  2586 |   expect(String(sessionContext.teachingSummary)).toContain("budget");
  2587 | });
  2588 | 
  2589 | test("a planning request outage still produces a reviewable plan from YOVA's saved inputs", async ({ page }) => {
  2590 |   await page.route("**/api/plans/generate", async (route) => {
  2591 |     await route.fulfill({
  2592 |       status: 502,
  2593 |       contentType: "application/json",
  2594 |       body: JSON.stringify({ error: "Temporary planning service failure." }),
  2595 |     });
  2596 |   });
  2597 |   await createPreviewAccount(page);
  2598 |   await completeOnboarding(page);
  2599 | 
  2600 |   await beginPlanFromAdd(page, "I have a biology test in two weeks on cellular respiration.");
  2601 |   await page.getByRole("button", { name: "Continue" }).click();
  2602 |   await page.getByRole("button", { name: "Skip for now" }).click();
  2603 |   await page.getByRole("button", { name: "Generate my plan" }).click();
  2604 | 
  2605 |   await expect(page.getByText("Plan ready")).toBeVisible({ timeout: 30_000 });
  2606 |   const livePlanningIssue = page.locator(".generation-notice[role='alert']");
  2607 |   await expect(livePlanningIssue).toContainText("Live AI planning failed");
  2608 |   await expect(livePlanningIssue.getByRole("button", { name: "Retry live planning" })).toBeVisible();
  2609 |   await expect(livePlanningIssue).not.toContainText("reliable planning engine");
  2610 |   await expect(page.getByRole("heading", { name: "Your information is safe." })).not.toBeVisible();
  2611 | });
  2612 | 
```