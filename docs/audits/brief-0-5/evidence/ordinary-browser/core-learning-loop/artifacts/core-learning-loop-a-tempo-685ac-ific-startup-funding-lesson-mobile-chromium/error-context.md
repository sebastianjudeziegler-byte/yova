# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: core-learning-loop.spec.ts >> a temporary AI failure loads a subject-specific startup funding lesson
- Location: e2e/core-learning-loop.spec.ts:767:5

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: locator.click: Test timeout of 30000ms exceeded.
Call log:
  - waiting for getByRole('button', { name: 'Study something now', exact: true }).first()
    - locator resolved to <button disabled class="yv-pill outline">Study something now</button>
  - attempting click action
    2 × waiting for element to be visible, enabled and stable
      - element is not enabled
    - retrying click action
    - waiting 20ms
    2 × waiting for element to be visible, enabled and stable
      - element is not enabled
    - retrying click action
      - waiting 100ms
    - waiting for element to be visible, enabled and stable
    - element is not enabled
  - retrying click action
    - waiting 500ms

```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - button "Open Next.js Dev Tools" [ref=e7] [cursor=pointer]
  - alert [ref=e11]
  - generic [ref=e12]:
    - link "Skip to main content" [ref=e13] [cursor=pointer]:
      - /url: "#main-content"
    - banner [ref=e14]:
      - generic [ref=e15]: "Y"
      - navigation "Main navigation" [ref=e17]:
        - button "Home" [ref=e18] [cursor=pointer]
        - button "Learning" [ref=e20] [cursor=pointer]
        - button "Calendar" [ref=e22] [cursor=pointer]
        - button "Ask YOVA" [ref=e24] [cursor=pointer]
        - button "You" [ref=e26] [cursor=pointer]
      - generic [ref=e28]:
        - button "Add to YOVA" [ref=e29] [cursor=pointer]:
          - generic [ref=e31]: Add
        - generic [ref=e32]:
          - generic "Learner · Private alpha" [ref=e33]: L
          - button "Sign out on this device" [ref=e34] [cursor=pointer]
    - main [ref=e38]:
      - generic [ref=e39]:
        - generic [ref=e40]:
          - generic [ref=e41]: WEDNESDAY, SEPTEMBER 9
          - heading [level=1] [ref=e42]:
            - text: Good morning,
            - emphasis [ref=e43]: Learner
        - generic [ref=e44]:
          - generic [ref=e45]: START HERE
          - heading "Turn any goal into a clear next step." [level=2] [ref=e46]
          - paragraph [ref=e47]: Use your own materials, let YOVA create the content, or get a plan for studying somewhere else.
          - generic [ref=e48]:
            - button "Build my first plan" [ref=e49] [cursor=pointer]
            - button "Study something now" [disabled] [ref=e50]
        - generic [ref=e51]:
          - generic [ref=e52]:
            - textbox "Ask YOVA" [ref=e53]:
              - /placeholder: Ask YOVA about anything you're studying…
            - button "Send" [disabled] [ref=e54]:
              - generic [ref=e55]: Ask
          - button "Add plan Notes, syllabus, link" [ref=e56] [cursor=pointer]:
            - generic [ref=e57]: +
            - generic [ref=e58]:
              - strong [ref=e59]: Add plan
              - generic [ref=e60]: Notes, syllabus, link
            - generic [ref=e61]: ›
          - button "Study now Quick, off-plan" [disabled] [ref=e62]:
            - generic [ref=e63]: →
            - generic [ref=e64]:
              - strong [ref=e65]: Study now
              - generic [ref=e66]: Quick, off-plan
            - generic [ref=e67]: ›
    - contentinfo [ref=e68]:
      - navigation "Trust and support" [ref=e69]:
        - link "Support" [ref=e70] [cursor=pointer]:
          - /url: /support
        - link "Privacy" [ref=e71] [cursor=pointer]:
          - /url: /privacy
        - link "Terms" [ref=e72] [cursor=pointer]:
          - /url: /terms
```

# Test source

```ts
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
  742 |       }),
  743 |     });
  744 |   });
  745 |   await createPreviewAccount(page);
  746 |   await completeOnboarding(page);
  747 | 
  748 |   await page.getByRole("button", { name: "Study something now", exact: true }).first().click();
  749 |   await page.getByPlaceholder("Example: Help me understand the product rule and practice using it.").fill(
  750 |     "Help me understand eigenvalues and eigenvectors from scratch",
  751 |   );
  752 |   await page.getByRole("button", { name: "I haven't learned this yet" }).click();
  753 |   await page.getByRole("button", { name: /Choose how YOVA should help/ }).click();
  754 |   await page.getByRole("button", { name: /Create it for me/ }).click();
  755 |   await page.getByRole("button", { name: /Build and start session/ }).click();
  756 |   await confirmSessionSetup(page);
  757 | 
  758 |   await expect(page.getByText("LESSON QUALITY CHECK", { exact: true })).toBeVisible();
  759 |   await expect(page.getByRole("heading", { name: "The generated lesson did not pass YOVA's quality checks." })).toBeVisible();
  760 |   await expect(page.getByText(/teaching-first session still needs an initial subject explanation/i)).toBeVisible();
  761 |   await expect(page.getByLabel("Study-method workpad")).toHaveCount(0);
  762 |   await expect(page.getByRole("button", { name: "Use the study method" })).toHaveCount(0);
  763 |   await expect(page.getByRole("button", { name: "Try preparing the guided lesson again" })).toHaveCount(0);
  764 |   await expect(page.getByRole("button", { name: "Review session setup" })).toBeVisible();
  765 | });
  766 | 
  767 | test("a temporary AI failure loads a subject-specific startup funding lesson", async ({ page }) => {
  768 |   await page.route("**/api/sessions/generate", async (route) => {
  769 |     await route.fulfill({
  770 |       status: 502,
  771 |       contentType: "application/json",
  772 |       body: JSON.stringify({ error: "Temporary guided-session generation failure." }),
  773 |     });
  774 |   });
  775 |   await createPreviewAccount(page);
  776 |   await completeOnboarding(page);
  777 | 
> 778 |   await page.getByRole("button", { name: "Study something now", exact: true }).first().click();
      |                                                                                        ^ Error: locator.click: Test timeout of 30000ms exceeded.
  779 |   await page.getByPlaceholder("Example: Help me understand the product rule and practice using it.").fill(
  780 |     "Teach me startup funding stages, instruments, investors, dilution, and term sheets from the beginning",
  781 |   );
  782 |   await page.getByRole("button", { name: "I haven't learned this yet" }).click();
  783 |   await page.getByRole("button", { name: /Choose how YOVA should help/ }).click();
  784 |   await page.getByRole("button", { name: /Create it for me/ }).click();
  785 |   await page.getByRole("button", { name: /Build and start session/ }).click();
  786 |   await confirmSessionSetup(page);
  787 | 
  788 |   await expect(page.getByRole("heading", { name: "The startup funding map" })).toBeVisible();
  789 |   await expect(page.getByRole("heading", { name: "Follow one founder from an idea to an early company." })).toBeVisible();
  790 |   await page.getByRole("button", { name: /Core idea/ }).click();
  791 |   await expect(page.getByText(/bootstrapping uses founder money or company revenue/i)).toBeVisible();
  792 |   await expect(page.getByText(/safe built-in session was loaded instead/i)).toBeVisible();
  793 |   await expect(page.getByRole("heading", { name: "YOVA already knows what this lesson should cover." })).not.toBeVisible();
  794 | });
  795 | 
  796 | test("home lets the learner browse prioritized recommendations without opening every plan", async ({ page }) => {
  797 |   test.setTimeout(60_000);
  798 |   await page.route("**/api/sessions/generate", async (route) => {
  799 |     await route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ error: "Temporary test failure." }) });
  800 |   });
  801 |   await createPreviewAccount(page);
  802 |   await completeOnboarding(page);
  803 | 
  804 |   await createOneOffLearningSession(page, "Help me understand compound growth and personal finance basics.");
  805 |   await expect(page.locator(".method-phase-coach:visible")).toContainText("See a complete model");
  806 |   await exitSessionWithoutProgress(page);
  807 | 
  808 |   await createOneOffLearningSession(page, "Teach me startup funding stages, instruments, investors, and dilution from the beginning.");
  809 |   await expect(page.getByRole("heading", { name: "The startup funding map" })).toBeVisible();
  810 |   await exitSessionWithoutProgress(page);
  811 | 
  812 |   const recommendation = recommendedLearningPlan(page);
  813 |   await expect(recommendation).toBeVisible();
  814 |   const secondRecommendation = page.getByRole("button", { name: "Show recommendation 2 of 2" });
  815 |   await expect(secondRecommendation).toBeVisible();
  816 |   await expect(page.getByText("1 of 2", { exact: true })).toBeVisible();
  817 |   const firstTitle = await recommendation.getByRole("heading", { level: 2 }).textContent();
  818 |   await secondRecommendation.click();
  819 |   await expect(page.getByText("2 of 2", { exact: true })).toBeVisible();
  820 |   await expect(recommendation.getByRole("heading", { level: 2 })).not.toHaveText(firstTitle ?? "");
  821 | });
  822 | 
  823 | test("outside study gives a concrete source-based session instead of pretending YOVA owns the content", async ({ page }) => {
  824 |   await createPreviewAccount(page);
  825 |   await completeOnboarding(page);
  826 | 
  827 |   await page.getByRole("button", { name: "Study something now", exact: true }).first().click();
  828 |   await page.getByPlaceholder("Example: Help me understand the product rule and practice using it.").fill(
  829 |     "Draft a comparative history thesis using my textbook evidence",
  830 |   );
  831 |   await page.getByRole("button", { name: /Choose how YOVA should help/ }).click();
  832 |   await page.getByRole("button", { name: /Guide me outside YOVA/ }).click();
  833 |   await page.getByRole("button", { name: /Build and start session/ }).click();
  834 |   await confirmSessionSetup(page);
  835 | 
  836 |   const methodWorkpad = page.getByLabel("Study-method workpad");
  837 |   const methodBriefing = methodWorkpad.getByLabel("How to study this");
  838 |   await expect(methodWorkpad).toBeVisible();
  839 |   await expect(methodBriefing).toContainText("HOW TO STUDY THIS");
  840 |   await expect(methodBriefing).toContainText("TODAY'S TARGET");
  841 |   await expect(methodBriefing).toContainText("What this covers");
  842 |   await expect(methodBriefing).toContainText("Finished means");
  843 |   await expect(methodBriefing).toContainText("WHY THIS METHOD");
  844 |   await expect(methodBriefing).toContainText("Use it like this");
  845 |   await expect(methodBriefing).toContainText("Why this fits today");
  846 |   await expect(methodBriefing).toContainText(/outside source remains the source of truth/i);
  847 |   await expect(methodWorkpad).toContainText("This completes practice, not a knowledge check.");
  848 |   await expect(page.locator(".session-activity-header").getByRole("heading", { name: /How to use/i })).toBeVisible();
  849 |   await expect(page.getByText(/move to your own source/i)).toBeVisible();
  850 |   await expect(page.locator("strong:visible").filter({ hasText: /^Outline from Memory$/ })).toBeVisible();
  851 | });
  852 | 
  853 | test("an arbitrary outside method workpad completes as practice without changing topic evidence", async ({ page }) => {
  854 |   await createPreviewAccount(page);
  855 |   await completeOnboarding(page);
  856 | 
  857 |   await page.getByRole("button", { name: "Study something now", exact: true }).first().click();
  858 |   await page.getByPlaceholder("Example: Help me understand the product rule and practice using it.").fill(
  859 |     "Review how thermohaline circulation moves heat using my oceanography textbook",
  860 |   );
  861 |   await page.getByRole("button", { name: "I understand the basics but need practice" }).click();
  862 |   await page.getByRole("button", { name: /Choose how YOVA should help/ }).click();
  863 |   await page.getByRole("button", { name: /Guide me outside YOVA/ }).click();
  864 |   await page.getByRole("button", { name: /Build and start session/ }).click();
  865 |   await confirmSessionSetup(page);
  866 | 
  867 |   const workpad = page.getByLabel("Study-method workpad");
  868 |   await expect(workpad).toBeVisible();
  869 |   await expect(workpad.getByLabel("How to study this")).toContainText(/thermohaline circulation/i);
  870 |   await expect(workpad).toContainText("This completes practice, not a knowledge check.");
  871 | 
  872 |   await expect.poll(async () => Boolean(await readPreviewPracticeState(page))).toBe(true);
  873 |   const before = await readPreviewPracticeState(page);
  874 |   if (!before) throw new Error("Expected the outside session in the preview snapshot.");
  875 |   expect(before.topicStatuses.length).toBeGreaterThan(0);
  876 |   expect(before.sessionStatus).toBe("ready");
  877 | 
  878 |   await workpad.getByLabel("Your workpad").fill(
```