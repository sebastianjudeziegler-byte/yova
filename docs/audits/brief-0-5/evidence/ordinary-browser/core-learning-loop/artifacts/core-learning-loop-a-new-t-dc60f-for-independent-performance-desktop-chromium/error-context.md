# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: core-learning-loop.spec.ts >> a new topic is taught before YOVA asks for independent performance
- Location: e2e/core-learning-loop.spec.ts:552:5

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByText('YOVA\'S FORMATIVE CHECK')
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 5000ms
  - waiting for getByText('YOVA\'S FORMATIVE CHECK')

```

```yaml
- alert
- main:
  - text: Help Me Understand Compound Growth and Personal Finance Basics · Session 1 of 1
  - strong: Learn Budgeting decisions and 1 connected topic
  - text: 4 of 6 required steps complete · 0:05 elapsed
  - button "Change direction"
  - button "Exit"
  - complementary:
    - group:
      - strong: Feynman Technique
      - text: Teaching first · Step 5 of 6 · 5 learning phases
  - region "Method phase 4 of 5":
    - text: METHOD PHASE 4 OF 5
    - strong: Compare and repair
    - paragraph: Use feedback after the attempt to correct the exact missing or mistaken part.
    - emphasis: Feedback available
  - strong: Repair now, verify later
  - paragraph: Correct the idea now. YOVA will still check it again later because an immediate retry is not proof that it will stick.
  - 'region "Adaptive repair: One clue first"':
    - text: YOVA CHANGED THE SUPPORT
    - strong: One clue first
    - text: Why this changed
    - paragraph: You asked for a small hint when stuck, so YOVA is preserving another attempt before revealing the complete answer.
    - text: One bounded clue
    - heading "Use one clue, then retry Compound growth mechanism" [level=2]
    - paragraph: Focus on the relationship involving Compound growth mechanism in the original prompt. Name what changes, what stays fixed, and how the parts connect.
    - paragraph: "The target has not changed: explain or apply Compound growth mechanism accurately without visible support."
  - text: STEP 5 OF 6
  - strong: REPAIR CHECK
  - text: About 2 min
  - heading "Use one clue, then retry Compound growth mechanism" [level=1]
  - paragraph: The previous check exposed this exact gap. Answer the original Compound growth mechanism prompt again using the clue, without copying the reference answer.
  - text: PREVIOUS LESSON AVAILABLE
  - strong: Trace one financial choice
  - text: Open it without losing this question or your place.
  - button "Review the lesson"
  - text: Corrected idea in your own words
  - textbox "Corrected idea in your own words" [disabled]:
    - /placeholder: Explain the corrected idea without copying the wording...
    - text: Earlier gains stay in the base, so later percentage gains apply to the original amount and its accumulated growth.
  - button "Checking your work..." [disabled]
  - button "I don't know yet" [disabled]
  - text: YOVA will show the model and record a gap without treating it as failure.
  - button "Continue" [disabled]
  - complementary:
    - button "Ask YOVA"
```

# Test source

```ts
  541 |   await page.getByRole("button", { name: "Try preparing the guided lesson again" }).click();
  542 |   await expect.poll(() => generationBodies.length).toBe(initialRequestCount + 1);
  543 |   expect(generationBodies.at(-1)?.sessionAdjustment).toEqual(requestedAdjustment);
  544 |   expect(generationBodies.at(-1)?.sessionAdjustment).toMatchObject({
  545 |     familiarity: "as_planned",
  546 |     availableMinutes: null,
  547 |     note: "This session must also cover the quotient rule.",
  548 |   });
  549 |   await expect(page.getByRole("heading", { name: "YOVA could not reach the guided-lesson service." })).toBeVisible();
  550 | });
  551 | 
  552 | test("a new topic is taught before YOVA asks for independent performance", async ({ page }) => {
  553 |   await page.route("**/api/sessions/generate", async (route) => {
  554 |     await route.fulfill({
  555 |       status: 502,
  556 |       contentType: "application/json",
  557 |       body: JSON.stringify({ error: "Use the deterministic built-in lesson for this browser journey." }),
  558 |     });
  559 |   });
  560 |   await createPreviewAccount(page);
  561 |   await completeOnboarding(page);
  562 | 
  563 |   await page.getByRole("button", { name: "Study something now", exact: true }).first().click();
  564 |   await page.getByPlaceholder("Example: Help me understand the product rule and practice using it.").fill(
  565 |     "Help me understand compound growth and personal finance basics.",
  566 |   );
  567 |   await page.getByRole("button", { name: "I haven't learned this yet" }).click();
  568 |   await expect(page.getByText("Starting approach: Teaching first.")).toBeVisible();
  569 |   await page.getByRole("button", { name: /Choose how YOVA should help/ }).click();
  570 |   await page.getByRole("button", { name: /Create it for me/ }).click();
  571 |   await page.getByRole("button", { name: /Build and start session/ }).click();
  572 |   await confirmSessionSetup(page);
  573 | 
  574 |   await expect(page.getByLabel(/Method phase 1 of/)).toContainText("See a complete model");
  575 |   await expect(page.getByLabel("How YOVA adapted this session")).toContainText("The method comes from the task");
  576 |   await expect(page.getByLabel("How YOVA adapted this session")).toContainText(/concrete examples before rules/i);
  577 |   await openMobileSessionGuide(page);
  578 |   await expect(page.getByText("Teaching first", { exact: true }).filter({ visible: true }).first()).toBeVisible();
  579 |   await expect(page.getByText("How YOVA adapted this").filter({ visible: true }).first()).toBeVisible();
  580 |   await expect(page.getByText(/asked for concrete examples before rules/i).filter({ visible: true }).first()).toBeVisible();
  581 |   await expect(page.getByLabel("Support progression").first()).toContainText("Support fades inside this session");
  582 |   const teachingRoadmap = page.getByLabel("Session method sequence").first();
  583 |   await expect(teachingRoadmap).toContainText("See a complete model");
  584 |   await expect(teachingRoadmap).toContainText("Practice with less help");
  585 |   await expect(teachingRoadmap).toContainText("Perform independently");
  586 |   await expect(teachingRoadmap).toContainText("Apply it in a new context");
  587 |   await expect(page.getByLabel("Method phase 1 of 4")).toContainText("See a complete model");
  588 |   await expect(page.getByText(/A budget directs limited income/).first()).toBeVisible();
  589 |   await expect(page.getByText("Part 1 of 2", { exact: true })).toBeVisible();
  590 |   const interactiveVisualLabel = page.getByText(/^INTERACTIVE (?:MODEL|PROCESS|TIMELINE|COMPARISON|CONCEPT MAP)$/);
  591 |   const interactiveVisual = page.getByLabel(/^Interactive (?:model|process|timeline|comparison|concept map):/i);
  592 |   await expect(interactiveVisualLabel).not.toBeVisible();
  593 |   await expect(page.getByRole("group", { name: /One quick confidence check/ })).not.toBeVisible();
  594 |   await page.getByRole("button", { name: "Next: Explore the model" }).click();
  595 |   await expect(interactiveVisualLabel).toBeVisible();
  596 |   await expect(interactiveVisual).toBeVisible();
  597 |   await expect(page.getByRole("tablist", { name: "Model parts" }).getByRole("tab")).toHaveCount(3);
  598 |   await page.getByRole("button", { name: "Next part" }).click();
  599 |   await expect(interactiveVisual).toContainText("2 of 3");
  600 |   await page.getByRole("button", { name: "Continue" }).click();
  601 | 
  602 |   await expect(page.getByRole("heading", { name: "One financial choice" })).toBeVisible();
  603 |   await expect(page.getByText(/If \$100 earns 10%/).first()).toBeVisible();
  604 |   await expect(page.getByRole("group", { name: /One quick confidence check/ })).not.toBeVisible();
  605 |   await page.getByRole("button", { name: "Next: Explore the model" }).click();
  606 |   await page.getByRole("button", { name: "Continue" }).click();
  607 | 
  608 |   await expect(page.getByRole("heading", { name: "What makes the second year compound growth?" })).toBeVisible();
  609 |   await expect(page.getByRole("button", { name: "Review the lesson" })).toBeVisible();
  610 |   await page.getByRole("button", { name: "Review the lesson" }).click();
  611 |   await expect(page.getByRole("dialog", { name: /Review the lesson, then return to the same question/i })).toBeVisible();
  612 |   await expect(page.getByText("Your answer and session progress stay exactly where they are.")).toBeVisible();
  613 |   await page.getByRole("dialog", { name: /Review the lesson, then return to the same question/i })
  614 |     .locator("footer")
  615 |     .getByRole("button", { name: "Back to the question" })
  616 |     .click();
  617 |   await expect(page.getByRole("heading", { name: "What makes the second year compound growth?" })).toBeVisible();
  618 |   await expect(page.getByRole("group", { name: /One quick confidence check/ })).not.toBeVisible();
  619 |   await page.getByRole("button", { name: "The earlier gain remains in the base" }).click();
  620 |   await expect(page.getByText("Correct.", { exact: true })).toBeVisible();
  621 |   await page.getByRole("button", { name: "Continue" }).click();
  622 | 
  623 |   await expect(page.getByRole("heading", { name: "Explain compound growth in your own words" })).toBeVisible();
  624 |   await expect(page.getByLabel("Method phase 3 of 4")).toContainText("Perform independently");
  625 |   await expect(page.getByRole("group", { name: /One quick confidence check/ })).toBeVisible();
  626 |   await page.getByRole("button", { name: "Somewhat sure" }).click();
  627 |   await expect(page.getByRole("button", { name: "I don't know yet" })).toBeVisible();
  628 |   await page.getByRole("button", { name: "I don't know yet" }).dispatchEvent("click");
  629 |   await expect(page.getByText("MODEL ANSWER")).toBeVisible();
  630 |   await expect(page.getByRole("button", { name: "Needs another pass" })).toHaveClass(/selected/);
  631 |   await page.getByRole("button", { name: "Repair this idea" }).click();
  632 | 
  633 |   await expect(page.getByText("Repair now, verify later")).toBeVisible();
  634 |   await expect(page.getByText("YOVA CHANGED THE SUPPORT")).toBeVisible();
  635 |   await expect(page.getByText("One clue first")).toBeVisible();
  636 |   await expect(page.getByText(/asked for a small hint when stuck/i)).toBeVisible();
  637 |   await page.getByLabel("Corrected idea in your own words").fill(
  638 |     "Earlier gains stay in the base, so later percentage gains apply to the original amount and its accumulated growth.",
  639 |   );
  640 |   await page.getByRole("button", { name: "Check my answer" }).dispatchEvent("click");
> 641 |   await expect(page.getByText("YOVA'S FORMATIVE CHECK")).toBeVisible();
      |                                                          ^ Error: expect(locator).toBeVisible() failed
  642 |   await expect(page.getByText("The key idea is present.")).toBeVisible();
  643 | });
  644 | 
  645 | test("a World War I beginner receives real teaching and a direct model answer", async ({ page }) => {
  646 |   await page.route("**/api/sessions/generate", async (route) => {
  647 |     await route.fulfill({
  648 |       status: 502,
  649 |       contentType: "application/json",
  650 |       body: JSON.stringify({ error: "Use the built-in subject session for this reliability test." }),
  651 |     });
  652 |   });
  653 |   await createPreviewAccount(page);
  654 |   await completeOnboarding(page);
  655 | 
  656 |   await page.getByRole("button", { name: "Study something now", exact: true }).first().click();
  657 |   await page.getByPlaceholder("Example: Help me understand the product rule and practice using it.").fill(
  658 |     "Teach me the causes of World War I and how the conflict spread across Europe.",
  659 |   );
  660 |   await page.getByRole("button", { name: "I haven't learned this yet" }).click();
  661 |   await page.getByRole("button", { name: /Choose how YOVA should help/ }).click();
  662 |   await page.getByRole("button", { name: /Create it for me/ }).click();
  663 |   await page.getByRole("button", { name: /Build and start session/ }).click();
  664 |   await confirmSessionSetup(page);
  665 | 
  666 |   await expect(page.getByRole("heading", { name: /^Trace the sequence from the Sarajevo assassination/ })).toBeVisible();
  667 |   await expect(page.getByText(/On June 28, 1914/)).toBeVisible();
  668 |   await page.getByRole("button", { name: "Next: Core idea" }).click();
  669 |   await expect(page.getByText(/Militarism increased armies/)).toBeVisible();
  670 |   await expect(page.locator(".session-workspace")).not.toContainText("the first concept listed");
  671 |   await expect(page.locator(".session-workspace")).not.toContainText("A strong response states the main idea");
  672 | 
  673 |   await page.getByRole("button", { name: "Next: Explore the model" }).click();
  674 |   await expect(page.getByText(/On June 28, 1914/).first()).toBeVisible();
  675 |   await page.getByRole("button", { name: "Next: Common mix-up" }).click();
  676 |   await expect(page.getByText("The assassination alone made a world war inevitable.")).toBeVisible();
  677 |   await page.getByRole("button", { name: "Continue" }).click();
  678 | 
  679 |   await expect(page.getByRole("heading", { name: "Which explanation best describes the outbreak of World War I?" })).toBeVisible();
  680 |   await page.getByRole("button", { name: "Long-term tensions made Europe unstable, and decisions during the July Crisis widened the assassination crisis into war" }).click();
  681 |   await page.getByRole("button", { name: "Continue" }).click();
  682 | 
  683 |   await expect(page.getByRole("heading", { name: "Rebuild the escalation in your own words" })).toBeVisible();
  684 |   await expectNoHorizontalOverflow(page, ".session-shell");
  685 |   const confidence = page.getByRole("button", { name: "Somewhat sure" });
  686 |   if (await confidence.isVisible()) await confidence.click();
  687 |   const unknownAnswer = page.getByRole("button", { name: "I don't know yet" });
  688 |   await expect(unknownAnswer).toBeInViewport();
  689 |   await unknownAnswer.dispatchEvent("click");
  690 |   await expect(page.getByText("MODEL ANSWER")).toBeVisible();
  691 |   await expect(page.locator(".model-answer-card")).toContainText("Austria-Hungary responded to the assassination with an ultimatum");
  692 |   await expect(page.locator(".model-answer-card")).not.toContainText("A strong response");
  693 | });
  694 | 
  695 | test("an opaque class label is stopped until the learner names the actual calculus concept", async ({ page }) => {
  696 |   await createPreviewAccount(page);
  697 |   await completeOnboarding(page);
  698 | 
  699 |   await page.getByRole("button", { name: "Study something now", exact: true }).first().click();
  700 |   const goalInput = page.getByPlaceholder("Example: Help me understand the product rule and practice using it.");
  701 |   await goalInput.fill("Start Calc Unit 3");
  702 |   await expect(page.getByText(/class label such as “Unit 3” does not tell YOVA/i)).toBeVisible();
  703 |   await page.getByRole("button", { name: /Choose how YOVA should help/ }).click();
  704 |   await page.getByRole("button", { name: /Create it for me/ }).click();
  705 | 
  706 |   await expect(page.getByRole("heading", { name: "What topics or skills does this actually cover?" })).toBeVisible();
  707 |   await expect(page.getByRole("button", { name: /Build and start session/ })).toBeDisabled();
  708 |   await page.getByRole("button", { name: "Product rule", exact: true }).click();
  709 |   await page.getByRole("button", { name: /Use this topic/ }).click();
  710 |   await expect(page.getByText("Start Calc Unit 3: Product rule", { exact: true })).toBeVisible();
  711 |   await expect(page.getByRole("button", { name: /Build and start session/ })).toBeEnabled();
  712 |   await page.getByRole("button", { name: /Build and start session/ }).click();
  713 |   await confirmSessionSetup(page);
  714 | 
  715 |   await expect(page.getByRole("heading", { name: "The product rule before using it" })).toBeVisible();
  716 |   await expect(page.getByText(/teaching first/i).filter({ visible: true }).first()).toBeVisible();
  717 |   const renderedFormula = page.locator(".teaching-core .katex").first();
  718 |   await expect(renderedFormula).toBeVisible();
  719 |   await expect(renderedFormula.locator("annotation[encoding='application/x-tex']")).toContainText("frac");
  720 |   const formulaLayout = await renderedFormula.evaluate((element) => ({
  721 |     fontSize: Number.parseFloat(getComputedStyle(element).fontSize),
  722 |     fitsItsLine: element.getBoundingClientRect().width <= (element.parentElement?.getBoundingClientRect().width ?? 0) + 1,
  723 |   }));
  724 |   expect(formulaLayout.fontSize).toBeGreaterThanOrEqual(15);
  725 |   expect(formulaLayout.fitsItsLine).toBe(true);
  726 |   const workspaceWidth = await page.locator(".session-workspace").evaluate((element) => ({
  727 |     client: element.clientWidth,
  728 |     scroll: element.scrollWidth,
  729 |   }));
  730 |   expect(workspaceWidth.scroll).toBeLessThanOrEqual(workspaceWidth.client + 1);
  731 | });
  732 | 
  733 | test("a teaching-first inside outage does not start with unsupported recall", async ({ page }) => {
  734 |   await page.route("**/api/sessions/generate", async (route) => {
  735 |     await route.fulfill({
  736 |       status: 502,
  737 |       contentType: "application/json",
  738 |       body: JSON.stringify({
  739 |         error: "Live generation did not produce a guided session that passed YOVA's learning checks.",
  740 |         code: "guided_session_quality_checks_failed",
  741 |         retryable: false,
```