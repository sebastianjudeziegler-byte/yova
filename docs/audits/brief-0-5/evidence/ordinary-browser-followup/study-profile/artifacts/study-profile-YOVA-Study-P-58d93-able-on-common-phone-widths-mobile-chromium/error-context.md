# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: study-profile.spec.ts >> YOVA Study Profile >> keeps every pre-report screen usable on common phone widths
- Location: e2e/study-profile.spec.ts:301:7

# Error details

```
Error: expect(locator).toHaveAttribute(expected) failed

Locator: getByRole('progressbar', { name: 'Study Profile progress' })
Expected: "14"
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toHaveAttribute" with timeout 5000ms
  - waiting for getByRole('progressbar', { name: 'Study Profile progress' })

```

```yaml
- link "Skip to main content":
  - /url: "#study-profile-landing"
- banner:
  - link "YOVA home":
    - /url: /
  - navigation "Study Profile":
    - text: Free
    - button "Start the profile"
- main:
  - text: Free Study Profile · about 3 minutes
  - heading "Find out how you actually study." [level=1]
  - paragraph: 14 quick questions. Get your study pattern, the habit most worth changing, and practical methods selected from your answers. Join the free YOVA waitlist and confirm your email to unlock the full report.
  - button "Get my free study profile"
  - text: Free · about 3 minutes · email confirmation required Full report after confirmation Practical steps for tonight Private report link Example result
  - heading "The Familiarity Trap" [level=2]
  - paragraph: Feels easy is not the same as known.
  - text: Starting Planning Focus Self-testing Mistakes Energy
  - strong: Tonight
  - text: Start with a 10-minute brain dump.
  - region "A report that gives you something to do next.":
    - text: What you get
    - heading "A report that gives you something to do next." [level=2]
    - article:
      - heading "See what may be getting in the way." [level=3]
      - paragraph: Your answers are scored across six study habits and highlight the area most worth trying first.
    - article:
      - heading "Get practical methods with clear steps." [level=3]
      - paragraph: The report turns broad advice, such as retrieval practice, into a concrete way to try it.
    - article:
      - heading "Walk away with tonight's session." [level=3]
      - paragraph: A suggested block length, break timing, first step, and stopping point.
  - region "About three minutes. A plan you can use tonight.":
    - text: How it works
    - heading "About three minutes. A plan you can use tonight." [level=2]
    - list:
      - listitem:
        - text: "01"
        - strong: Answer honestly.
        - paragraph: 14 quick questions about how you actually study, not how you wish you studied.
      - listitem:
        - text: "02"
        - strong: Finish your profile.
        - paragraph: Your answers form a named pattern across six study habits.
      - listitem:
        - text: "03"
        - strong: Join and confirm.
        - paragraph: Enter your email, join the free YOVA waitlist, and confirm from your inbox to open your private report.
  - 'region "Example: The Familiarity Trap."':
    - text: An example result
    - 'heading "Example: The Familiarity Trap." [level=2]'
    - paragraph: This learner rereads until the material feels easy, then rarely checks without notes. The first suggested step takes ten minutes to set up.
    - button "Find my pattern"
    - text: YOVA Study Profile
    - heading "The Familiarity Trap" [level=3]
    - paragraph: Feels easy is not the same as known.
    - strong: Best first method
    - text: Brain dump, then check the gaps
  - region "This profile is chapter one.":
    - text: What is YOVA?
    - heading "This profile is chapter one." [level=2]
    - paragraph: YOVA builds your plan and runs your study sessions around your goal, materials, schedule, and this profile. The quiz asks how you work. The app finds out from what you actually do and keeps the plan current.
    - paragraph: YOVA is coming soon. The profile is free, and so is the waitlist.
    - text: Email address
    - textbox "Email address":
      - /placeholder: you@example.com
    - button "Join the waitlist" [disabled]
    - checkbox "I confirm I am 13 or older."
    - text: I confirm I am 13 or older.
    - checkbox "Email me when YOVA launches. I can unsubscribe at any time."
    - text: Email me when YOVA launches. I can unsubscribe at any time.
    - paragraph:
      - text: See how YOVA uses your email in the
      - link "Privacy Notice":
        - /url: /privacy
      - text: .
  - region "Study Profile methodology summary":
    - strong: Draws on established study techniques.
    - paragraph: Retrieval practice, spaced practice, and interleaving inform the suggestions. The match is a starting point based on your answers, not a diagnosis or personality test.
  - region "Ready to see what your answers suggest?":
    - text: Free · about 3 minutes · email confirmation required
    - heading "Ready to see what your answers suggest?" [level=2]
    - button "Get my free study profile"
    - paragraph: Not ready for the quiz? Join the YOVA waitlist instead.
    - text: Email address
    - textbox "Email address":
      - /placeholder: you@example.com
    - button "Join the waitlist" [disabled]
    - checkbox "I confirm I am 13 or older."
    - text: I confirm I am 13 or older.
    - checkbox "Email me when YOVA launches. I can unsubscribe at any time."
    - text: Email me when YOVA launches. I can unsubscribe at any time.
    - paragraph:
      - text: See how YOVA uses your email in the
      - link "Privacy Notice":
        - /url: /privacy
      - text: .
- contentinfo:
  - paragraph: © 2026 YOVA. Your study system should adapt to you.
  - navigation "Legal":
    - link "Privacy":
      - /url: /privacy
    - link "Terms":
      - /url: /terms
    - link "Email support":
      - /url: mailto:hello@yovaapp.com?subject=YOVA%20Study%20Profile%20support
```

# Test source

```ts
  436 |     for (const savedAt of [Date.now() - (8 * 24 * 60 * 60 * 1000), Date.now() + 60_000, null]) {
  437 |       await page.goto("/study-profile");
  438 |       await page.evaluate(({ key, timestamp }) => {
  439 |         window.localStorage.setItem(key, JSON.stringify({
  440 |           version: "study_profile_draft_v2",
  441 |           view: "question",
  442 |           currentQuestion: 5,
  443 |           answers: { q1: "a", q2: "b" },
  444 |           metadata: {},
  445 |           ...(timestamp === null ? {} : { savedAt: timestamp }),
  446 |         }));
  447 |       }, { key: DRAFT_STORAGE_KEY, timestamp: savedAt });
  448 | 
  449 |       await page.reload();
  450 |       await expect(page.getByRole("heading", {
  451 |         name: "Find out how you actually study.",
  452 |       })).toBeVisible();
  453 |       await expect.poll(() => page.evaluate((key) => (
  454 |         window.localStorage.getItem(key)
  455 |       ), DRAFT_STORAGE_KEY)).toBeNull();
  456 |     }
  457 |   });
  458 | 
  459 |   test("exposes semantic 14-step progress and dynamic radio keyboard help", async ({ page }) => {
  460 |     await page.goto("/study-profile");
  461 |     await page.getByRole("button", { name: "Get my free study profile" }).first().click();
  462 | 
  463 |     const progress = page.getByRole("progressbar", { name: "Study Profile progress" });
  464 |     await expect(progress).toHaveAttribute("aria-valuemin", "0");
  465 |     await expect(progress).toHaveAttribute("aria-valuemax", "14");
  466 |     await expect(progress).toHaveAttribute("aria-valuenow", "1");
  467 |     await expect(progress).toHaveAttribute("aria-valuetext", "Question 1 of 14");
  468 |     await expect(page.getByText("Choose what is usually true for you, even if it is not ideal.")).toBeVisible();
  469 |     await expect(page.getByText("Keyboard: press 1 to 4, A to D, or use arrow keys"))
  470 |       .toHaveText("Keyboard: press 1 to 4, A to D, or use arrow keys");
  471 |     await expectNoPercentOrContextSwitch(page);
  472 | 
  473 |     const radios = page.getByRole("radiogroup", { name: "Answers for question 1" }).getByRole("radio");
  474 |     await radios.first().focus();
  475 |     await page.keyboard.press("ArrowDown");
  476 |     await expectOnlyQuestion(page, 2);
  477 |     await expect(progress).toHaveAttribute("aria-valuenow", "2");
  478 |     await expect(progress).toHaveAttribute("aria-valuetext", "Question 2 of 14");
  479 |   });
  480 | });
  481 | 
  482 | async function completeAssessmentToReveal(page: Page) {
  483 |   for (let questionNumber = 1; questionNumber <= 12; questionNumber += 1) {
  484 |     await answerQuestion(page, questionNumber, 0);
  485 |   }
  486 |   await expectStudyGoalStep(page);
  487 |   await page.getByRole("button", { name: /^Exams coming up/ }).click();
  488 |   await expectCombinedContextStep(page);
  489 |   await page.getByRole("button", { name: "Morning", exact: true }).click();
  490 |   await page.getByRole("button", { name: "High school", exact: true }).click();
  491 |   await page.getByRole("button", { name: "Finish my profile" }).click();
  492 | }
  493 | 
  494 | async function answerQuestion(page: Page, questionNumber: number, answerIndex: number) {
  495 |   await expectOnlyQuestion(page, questionNumber);
  496 |   await page
  497 |     .getByRole("radiogroup", { name: `Answers for question ${questionNumber}` })
  498 |     .getByRole("radio")
  499 |     .nth(answerIndex)
  500 |     .click();
  501 | }
  502 | 
  503 | async function expectOnlyQuestion(page: Page, questionNumber: number) {
  504 |   await expectAssessmentStep(page, questionNumber);
  505 |   const currentGroup = page.getByRole("radiogroup", { name: `Answers for question ${questionNumber}` });
  506 |   await expect(currentGroup).toBeVisible();
  507 |   await expect(currentGroup.getByRole("radio")).toHaveCount(4);
  508 |   await expect(page.getByRole("radiogroup", { name: /^Answers for question \d+$/ })).toHaveCount(1);
  509 |   const keyboardHint = page.getByText("Keyboard: press 1 to 4, A to D, or use arrow keys");
  510 |   await expect(keyboardHint).toHaveText("Keyboard: press 1 to 4, A to D, or use arrow keys");
  511 |   const usesCoarsePointer = await page.evaluate(() => window.matchMedia("(pointer: coarse)").matches);
  512 |   if (usesCoarsePointer) await expect(keyboardHint).toBeHidden();
  513 |   else await expect(keyboardHint).toBeVisible();
  514 |   await expectNoPercentOrContextSwitch(page);
  515 | }
  516 | 
  517 | async function expectStudyGoalStep(page: Page) {
  518 |   await expectAssessmentStep(page, 13);
  519 |   await expect(page.getByRole("heading", {
  520 |     name: "What are you mainly studying for right now?",
  521 |   })).toBeVisible();
  522 |   await expect(page.getByRole("radiogroup", { name: /^Answers for question/ })).toHaveCount(0);
  523 |   await expectNoPercentOrContextSwitch(page);
  524 | }
  525 | 
  526 | async function expectCombinedContextStep(page: Page) {
  527 |   await expectAssessmentStep(page, 14);
  528 |   await expect(page.getByRole("heading", { name: "One last bit of context." })).toBeVisible();
  529 |   await expect(page.getByText("When is your focus usually strongest?", { exact: true })).toBeVisible();
  530 |   await expect(page.getByText("What best describes your setting?", { exact: true })).toBeVisible();
  531 |   await expectNoPercentOrContextSwitch(page);
  532 | }
  533 | 
  534 | async function expectAssessmentStep(page: Page, step: number) {
  535 |   const progress = page.getByRole("progressbar", { name: "Study Profile progress" });
> 536 |   await expect(progress).toHaveAttribute("aria-valuemax", "14");
      |                          ^ Error: expect(locator).toHaveAttribute(expected) failed
  537 |   await expect(progress).toHaveAttribute("aria-valuenow", String(step));
  538 |   await expect(progress).toHaveAttribute("aria-valuetext", `Question ${step} of 14`);
  539 | }
  540 | 
  541 | async function expectNoPercentOrContextSwitch(page: Page) {
  542 |   await expect(page.getByText(/^\d+%$/)).toHaveCount(0);
  543 |   await expect(page.getByText("Profile context", { exact: true })).toHaveCount(0);
  544 | }
  545 | 
  546 | async function expectLockedReveal(page: Page) {
  547 |   const progress = page.getByRole("progressbar", { name: "Study Profile progress" });
  548 |   await expect(progress).toHaveAttribute("aria-valuemax", "14");
  549 |   await expect(progress).toHaveAttribute("aria-valuenow", "14");
  550 |   await expect(progress).toHaveAttribute("aria-valuetext", "Profile complete");
  551 |   const heading = page.getByRole("heading", {
  552 |     name: "Your study pattern is ready.",
  553 |   });
  554 |   await expect(heading).toBeVisible();
  555 |   await expect(heading).toBeFocused();
  556 |   await expect(page.locator("#report-title")).toHaveCount(0);
  557 |   await expect(page.getByRole("heading", { name: /^You are The .+\.$/ })).toHaveCount(0);
  558 |   await expect(page.getByLabel("Your six study habits")).toHaveCount(0);
  559 |   await expect(page.getByText("One thing your answers show", { exact: true })).toHaveCount(0);
  560 |   await expect(page.getByText("The report is yours either way.", { exact: true })).toHaveCount(0);
  561 |   await expect(page.getByText("Your named study pattern", { exact: true })).toBeVisible();
  562 |   await expect(page.getByLabel("Email for your confirmation link")).toHaveValue("");
  563 |   await expect(page.getByRole("checkbox", {
  564 |     name: /Confirm my place on the YOVA waitlist/,
  565 |   })).not.toBeChecked();
  566 |   await expect(page.getByRole("checkbox", { name: "I am under 18." })).toHaveCount(0);
  567 | }
  568 | 
  569 | async function expectNoHorizontalOverflow(page: Page) {
  570 |   const overflow = await page.evaluate(() => {
  571 |     const root = document.scrollingElement ?? document.documentElement;
  572 |     const offenders = Array.from(document.querySelectorAll<HTMLElement>("body *"))
  573 |       .map((element) => {
  574 |         const bounds = element.getBoundingClientRect();
  575 |         return {
  576 |           tag: element.tagName.toLowerCase(),
  577 |           className: element.className,
  578 |           clientWidth: element.clientWidth,
  579 |           scrollWidth: element.scrollWidth,
  580 |           left: Math.round(bounds.left),
  581 |           right: Math.round(bounds.right),
  582 |           width: Math.round(bounds.width),
  583 |         };
  584 |       })
  585 |       .filter((element) => (
  586 |         element.scrollWidth > element.clientWidth + 1
  587 |         || element.width > window.innerWidth + 1
  588 |         || element.left < -1
  589 |         || element.right > window.innerWidth + 1
  590 |       ))
  591 |       .slice(0, 12);
  592 | 
  593 |     return {
  594 |       clientWidth: root.clientWidth,
  595 |       scrollWidth: root.scrollWidth,
  596 |       offenders,
  597 |     };
  598 |   });
  599 | 
  600 |   expect(
  601 |     overflow.scrollWidth,
  602 |     `Horizontal overflow at ${await page.evaluate(() => window.innerWidth)}px: ${JSON.stringify(overflow.offenders)}`,
  603 |   ).toBeLessThanOrEqual(overflow.clientWidth + 1);
  604 | }
  605 | 
  606 | async function expectMinimumTapTargets(locator: Locator, minimum = 44) {
  607 |   const sizes = await locator.evaluateAll((elements) => elements
  608 |     .filter((element) => {
  609 |       const htmlElement = element as HTMLElement;
  610 |       const style = window.getComputedStyle(htmlElement);
  611 |       return style.display !== "none" && style.visibility !== "hidden";
  612 |     })
  613 |     .map((element) => {
  614 |       const bounds = element.getBoundingClientRect();
  615 |       return { width: bounds.width, height: bounds.height, text: element.textContent?.trim() ?? "" };
  616 |     }));
  617 | 
  618 |   expect(sizes.length).toBeGreaterThan(0);
  619 |   for (const size of sizes) {
  620 |     expect(size.width, `Tap target is too narrow: ${size.text}`).toBeGreaterThanOrEqual(minimum);
  621 |     expect(size.height, `Tap target is too short: ${size.text}`).toBeGreaterThanOrEqual(minimum);
  622 |   }
  623 | }
  624 | 
  625 | async function expectNoElementOverlap(locator: Locator) {
  626 |   const boxes = await locator.evaluateAll((elements) => elements.map((element) => {
  627 |     const bounds = element.getBoundingClientRect();
  628 |     return { left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom };
  629 |   }));
  630 | 
  631 |   for (let firstIndex = 0; firstIndex < boxes.length; firstIndex += 1) {
  632 |     for (let secondIndex = firstIndex + 1; secondIndex < boxes.length; secondIndex += 1) {
  633 |       const first = boxes[firstIndex];
  634 |       const second = boxes[secondIndex];
  635 |       const overlapsHorizontally = first.left < second.right - 1 && first.right > second.left + 1;
  636 |       const overlapsVertically = first.top < second.bottom - 1 && first.bottom > second.top + 1;
```