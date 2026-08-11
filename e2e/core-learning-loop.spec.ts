import { expect, test, type Page } from "@playwright/test";

const onboardingAnswers = [
  "I struggle to start",
  "Give me clear structure with flexibility",
  "20 to 30 minutes",
  "A concrete example first",
  "Sometimes",
  "I intend to begin but often delay",
  "Afternoon",
  "A combination",
  "No extra support right now",
  "Nothing else for now",
] as const;

test("a confident misconception is repaired now without a duplicate follow-up", async ({ page }) => {
  await createPreviewAccount(page);
  await completeOnboarding(page);

  await expect(page.getByRole("heading", { name: /Good (morning|afternoon|evening), Learner\./ })).toBeVisible();
  await page.getByRole("button", { name: "Study something now", exact: true }).first().click();

  await page.getByPlaceholder("Example: Help me understand the product rule and practice using it.").fill(
    "Help me review cellular respiration and test what I remember.",
  );
  await page.getByRole("button", { name: "I know it and want to test my recall" }).click();
  await expect(page.getByText("Starting approach: Practice first.")).toBeVisible();
  await page.getByRole("button", { name: /Choose how YOVA should help/ }).click();
  await page.getByRole("button", { name: /Create it for me/ }).click();
  await page.getByRole("button", { name: /Build and start session/ }).click();
  await expect(page.getByRole("heading", { name: "Here is how YOVA plans to start." })).toBeVisible();
  await expect(page.getByLabel("Why YOVA chose this approach")).toContainText("Start with evidence, then repair only the gap");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "I already know some of this" }).click();
  await expect(page.getByText(/skip them only after you demonstrate them/i)).toBeVisible();
  const claimedKnownTarget = page.locator(".known-targets button").first();
  await expect(claimedKnownTarget).toBeVisible();
  await claimedKnownTarget.click();
  await expect(claimedKnownTarget).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Prepare this session" }).click();

  await expect(page.getByRole("heading", { name: "Closed-note retrieval" })).toBeVisible();
  await openMobileSessionGuide(page);
  await expect(page.getByText("How YOVA adapted this").filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByText(/asked for concrete examples before rules/i).filter({ visible: true }).first()).toBeVisible();
  await expect(page.locator(".session-method-playbook:visible")).toContainText("WHY THIS METHOD");
  await expect(page.locator(".session-method-playbook:visible")).toContainText("Use it like this");
  await expect(page.getByLabel("Support progression").first()).toContainText("Start without support");
  const retrievalRoadmap = page.getByLabel("Session method sequence").first();
  await expect(retrievalRoadmap).toContainText("Attempt from memory");
  await expect(retrievalRoadmap).toContainText("Compare and repair");
  await expect(page.getByLabel("Method phase 1 of 3")).toContainText("Orient to the target");
  await expect(page.getByText(/Try to produce each answer before looking/)).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();

  await page.getByRole("button", { name: "Very sure" }).click();
  await page.getByRole("button", { name: "Krebs cycle" }).click();
  await expect(page.getByText(/possible misconception/i)).toBeVisible();
  await page.getByRole("button", { name: "Repair this idea" }).click();

  await expect(page.getByText("Repair now, verify later")).toBeVisible();
  await expect(page.getByText("YOVA CHANGED THE SUPPORT")).toBeVisible();
  await expect(page.getByText("Name and replace the error")).toBeVisible();
  await expect(page.getByText(/very sure about this answer/i)).toBeVisible();
  await leaveSession(page, "2 of 6 required steps finished");
  await expect(page.getByText("Continue where you left off")).toBeVisible();
  await page.getByRole("button", { name: "Continue session" }).click();
  await expect(page.getByText("Repair now, verify later")).toBeVisible();
  await expect(page.locator(".session-activity-header").getByRole("heading", { name: /Replace the mistaken Cellular respiration sequence relationship/i })).toBeVisible();
  await expect(page.getByText(/not saved as proof of mastery/i)).not.toBeVisible();
  await page.getByLabel("Corrected idea in your own words").fill(
    "Glycolysis happens first, followed by the Krebs cycle and electron transport chain.",
  );
  await page.getByRole("button", { name: "Check my answer" }).dispatchEvent("click");
  await expect(page.getByText("YOVA'S FORMATIVE CHECK")).toBeVisible();
  await expect(page.getByText("The key idea is present.")).toBeVisible();
  await page.getByRole("button", { name: "I got the key idea" }).click();
  await expect(page.getByText(/required recheck records whether the repaired concept now holds/i)).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();

  await page.getByRole("button", { name: "Somewhat sure" }).click();
  await page.getByRole("button", { name: "Cytoplasm" }).click();
  await page.getByRole("button", { name: "Continue" }).click();

  await page.getByLabel("Attempt from memory").fill(
    "Glycolysis occurs in the cytoplasm and does not directly require oxygen.",
  );
  await page.getByRole("button", { name: "Check my answer" }).dispatchEvent("click");
  await page.getByRole("button", { name: "I got the key idea" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Finish this content" }).click();

  await expect(page.getByRole("heading", { name: "The work is done. One part needs another check." })).toBeInViewport();
  await expect(page.getByText("2 of 3")).toBeVisible();
  await expect(page.getByText("Evidence checks")).toBeVisible();
  await expect(page.getByText("Recorded, not graded")).toBeVisible();
  await expect(page.getByText(/You repaired one idea during the session/)).toBeVisible();
  await expect(page.getByText("Cellular respiration sequence", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("NO CHANGE NEEDED")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Complete this learning item" })).toBeVisible();
  await expect(page.getByText(/today’s evidence does not require another scheduled check/i)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Add a short delayed check" })).not.toBeVisible();
  await page.getByRole("button", { name: "Finish and continue" }).click();
  await expect(page.getByRole("heading", { name: /Good (morning|afternoon|evening), Learner\./ })).toBeVisible();
});

test("a generation fallback honors a request to teach a planned study session first", async ({ page }) => {
  await page.route("**/api/sessions/generate", async (route) => {
    await route.fulfill({
      status: 502,
      contentType: "application/json",
      body: JSON.stringify({ error: "Temporary guided-session generation failure." }),
    });
  });
  await createPreviewAccount(page);
  await completeOnboarding(page);

  await page.getByRole("button", { name: "Study something now", exact: true }).first().click();
  await page.getByPlaceholder("Example: Help me understand the product rule and practice using it.").fill(
    "Help me review the product rule and test what I remember.",
  );
  await page.getByRole("button", { name: "I know it and want to test my recall" }).click();
  await page.getByRole("button", { name: /Choose how YOVA should help/ }).click();
  await page.getByRole("button", { name: /Create it for me/ }).click();
  await page.getByRole("button", { name: /Build and start session/ }).click();
  await expect(page.getByRole("heading", { name: "Here is how YOVA plans to start." })).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "I need this taught first" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText(/switch this session to teaching first/i)).toBeVisible();
  await page.getByRole("button", { name: "Prepare this session" }).click();

  await expect(page.getByRole("heading", { name: "See the product rule before using it" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Recall the product-rule structure" })).not.toBeVisible();
  await expect(page.getByText(/safe built-in session was loaded instead/i)).toBeVisible();
});

test("a built-in fallback never exceeds a shortened session window", async ({ page }) => {
  await page.route("**/api/sessions/generate", async (route) => {
    await route.fulfill({
      status: 502,
      contentType: "application/json",
      body: JSON.stringify({ error: "Temporary guided-session generation failure." }),
    });
  });
  await createPreviewAccount(page);
  await completeOnboarding(page);

  await page.getByRole("button", { name: "Study something now", exact: true }).first().click();
  await page.getByPlaceholder("Example: Help me understand the product rule and practice using it.").fill(
    "Help me understand the product rule and practice using it.",
  );
  await page.getByRole("button", { name: "I haven't learned this yet" }).click();
  await page.getByRole("button", { name: /Choose how YOVA should help/ }).click();
  await page.getByRole("button", { name: /Create it for me/ }).click();
  await page.getByRole("button", { name: /Build and start session/ }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Time available right now").selectOption("10");
  await page.getByRole("button", { name: "Prepare this session" }).click();

  await expect(page.getByRole("heading", { name: "YOVA already knows what this lesson should cover." })).toBeVisible();
  await expect(page.getByText(/safe built-in session was loaded instead/i)).not.toBeVisible();
});

test("a built-in fallback never ignores a learner's custom session requirement", async ({ page }) => {
  await page.route("**/api/sessions/generate", async (route) => {
    await route.fulfill({
      status: 502,
      contentType: "application/json",
      body: JSON.stringify({ error: "Temporary guided-session generation failure." }),
    });
  });
  await createPreviewAccount(page);
  await completeOnboarding(page);

  await page.getByRole("button", { name: "Study something now", exact: true }).first().click();
  await page.getByPlaceholder("Example: Help me understand the product rule and practice using it.").fill(
    "Help me understand the product rule and practice using it.",
  );
  await page.getByRole("button", { name: "I haven't learned this yet" }).click();
  await page.getByRole("button", { name: /Choose how YOVA should help/ }).click();
  await page.getByRole("button", { name: /Create it for me/ }).click();
  await page.getByRole("button", { name: /Build and start session/ }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Anything YOVA should account for?").fill("This session must also cover the quotient rule.");
  await page.getByRole("button", { name: "Prepare this session" }).click();

  await expect(page.getByRole("heading", { name: "YOVA already knows what this lesson should cover." })).toBeVisible();
  await expect(page.getByText(/safe built-in session was loaded instead/i)).not.toBeVisible();
});

test("a new topic is taught before YOVA asks for independent performance", async ({ page }) => {
  await page.route("**/api/sessions/generate", async (route) => {
    await route.fulfill({
      status: 502,
      contentType: "application/json",
      body: JSON.stringify({ error: "Use the deterministic built-in lesson for this browser journey." }),
    });
  });
  await createPreviewAccount(page);
  await completeOnboarding(page);

  await page.getByRole("button", { name: "Study something now", exact: true }).first().click();
  await page.getByPlaceholder("Example: Help me understand the product rule and practice using it.").fill(
    "Help me understand compound growth and personal finance basics.",
  );
  await page.getByRole("button", { name: "I haven't learned this yet" }).click();
  await expect(page.getByText("Starting approach: Teaching first.")).toBeVisible();
  await page.getByRole("button", { name: /Choose how YOVA should help/ }).click();
  await page.getByRole("button", { name: /Create it for me/ }).click();
  await page.getByRole("button", { name: /Build and start session/ }).click();
  await confirmSessionSetup(page);

  await expect(page.getByLabel(/Method phase 1 of/)).toContainText("See a complete model");
  await expect(page.getByLabel("How YOVA adapted this session")).toContainText("The method comes from the task");
  await expect(page.getByLabel("How YOVA adapted this session")).toContainText(/concrete examples before rules/i);
  await openMobileSessionGuide(page);
  await expect(page.getByText("Teaching first", { exact: true }).filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByText("How YOVA adapted this").filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByText(/asked for concrete examples before rules/i).filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByLabel("Support progression").first()).toContainText("Support fades inside this session");
  const teachingRoadmap = page.getByLabel("Session method sequence").first();
  await expect(teachingRoadmap).toContainText("See a complete model");
  await expect(teachingRoadmap).toContainText("Practice with less help");
  await expect(teachingRoadmap).toContainText("Perform independently");
  await expect(teachingRoadmap).toContainText("Apply it in a new context");
  await expect(page.getByLabel("Method phase 1 of 4")).toContainText("See a complete model");
  await expect(page.getByText(/A budget directs limited income/).first()).toBeVisible();
  await expect(page.getByText("Part 1 of 2", { exact: true })).toBeVisible();
  const interactiveVisualLabel = page.getByText(/^INTERACTIVE (?:MODEL|PROCESS|TIMELINE|COMPARISON|CONCEPT MAP)$/);
  const interactiveVisual = page.getByLabel(/^Interactive (?:model|process|timeline|comparison|concept map):/i);
  await expect(interactiveVisualLabel).not.toBeVisible();
  await expect(page.getByRole("group", { name: /One quick confidence check/ })).not.toBeVisible();
  await page.getByRole("button", { name: "Next: Explore the model" }).click();
  await expect(interactiveVisualLabel).toBeVisible();
  await expect(interactiveVisual).toBeVisible();
  await expect(page.getByRole("tablist", { name: "Model parts" }).getByRole("tab")).toHaveCount(3);
  await page.getByRole("button", { name: "Next part" }).click();
  await expect(interactiveVisual).toContainText("2 of 3");
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByRole("heading", { name: "Trace one financial choice" })).toBeVisible();
  await expect(page.getByText(/If \$100 earns 10%/).first()).toBeVisible();
  await expect(page.getByRole("group", { name: /One quick confidence check/ })).not.toBeVisible();
  await page.getByRole("button", { name: "Next: Explore the model" }).click();
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByRole("heading", { name: "What makes the second year compound growth?" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Review the lesson" })).toBeVisible();
  await page.getByRole("button", { name: "Review the lesson" }).click();
  await expect(page.getByRole("dialog", { name: /Review the lesson, then return to the same question/i })).toBeVisible();
  await expect(page.getByText("Your answer and session progress stay exactly where they are.")).toBeVisible();
  await page.getByRole("button", { name: "Back to the question" }).click();
  await expect(page.getByRole("heading", { name: "What makes the second year compound growth?" })).toBeVisible();
  await expect(page.getByRole("group", { name: /One quick confidence check/ })).not.toBeVisible();
  await page.getByRole("button", { name: "The earlier gain remains in the base" }).click();
  await expect(page.getByText("Correct.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByRole("heading", { name: "Explain compound growth in your own words" })).toBeVisible();
  await expect(page.getByLabel("Method phase 3 of 4")).toContainText("Perform independently");
  await expect(page.getByRole("group", { name: /One quick confidence check/ })).toBeVisible();
  await page.getByRole("button", { name: "Somewhat sure" }).click();
  await expect(page.getByRole("button", { name: "I don't know yet" })).toBeVisible();
  await page.getByRole("button", { name: "I don't know yet" }).dispatchEvent("click");
  await expect(page.getByText("MODEL ANSWER")).toBeVisible();
  await expect(page.getByRole("button", { name: "Needs another pass" })).toHaveClass(/selected/);
  await page.getByRole("button", { name: "Repair this idea" }).click();

  await expect(page.getByText("Repair now, verify later")).toBeVisible();
  await expect(page.getByText("YOVA CHANGED THE SUPPORT")).toBeVisible();
  await expect(page.getByText("Restore one step at a time")).toBeVisible();
  await expect(page.getByText(/marked this answer as uncertain/i)).toBeVisible();
  await page.getByLabel("Corrected idea in your own words").fill(
    "Earlier gains stay in the base, so later percentage gains apply to the original amount and its accumulated growth.",
  );
  await page.getByRole("button", { name: "Check my answer" }).dispatchEvent("click");
  await expect(page.getByText("YOVA'S FORMATIVE CHECK")).toBeVisible();
  await expect(page.getByText("The key idea is present.")).toBeVisible();
});

test("a World War I beginner receives real teaching and a direct model answer", async ({ page }) => {
  await page.route("**/api/sessions/generate", async (route) => {
    await route.fulfill({
      status: 502,
      contentType: "application/json",
      body: JSON.stringify({ error: "Use the built-in subject session for this reliability test." }),
    });
  });
  await createPreviewAccount(page);
  await completeOnboarding(page);

  await page.getByRole("button", { name: "Study something now", exact: true }).first().click();
  await page.getByPlaceholder("Example: Help me understand the product rule and practice using it.").fill(
    "Teach me the causes of World War I and how the conflict spread across Europe.",
  );
  await page.getByRole("button", { name: "I haven't learned this yet" }).click();
  await page.getByRole("button", { name: /Choose how YOVA should help/ }).click();
  await page.getByRole("button", { name: /Create it for me/ }).click();
  await page.getByRole("button", { name: /Build and start session/ }).click();
  await confirmSessionSetup(page);

  await expect(page.getByRole("heading", { name: "Build the World War I cause map" })).toBeVisible();
  await expect(page.getByText(/On June 28, 1914/)).toBeVisible();
  await page.getByRole("button", { name: "Next: Core idea" }).click();
  await expect(page.getByText(/Militarism increased armies/)).toBeVisible();
  await expect(page.locator(".session-workspace")).not.toContainText("the first concept listed");
  await expect(page.locator(".session-workspace")).not.toContainText("A strong response states the main idea");

  await page.getByRole("button", { name: "Next: Explore the model" }).click();
  await expect(page.getByText(/On June 28, 1914/).first()).toBeVisible();
  await page.getByRole("button", { name: "Next: Common mix-up" }).click();
  await expect(page.getByText("The assassination alone made a world war inevitable.")).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByRole("heading", { name: "Which explanation best describes the outbreak of World War I?" })).toBeVisible();
  await page.getByRole("button", { name: "Long-term tensions made Europe unstable, and decisions during the July Crisis widened the assassination crisis into war" }).click();
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByRole("heading", { name: "Rebuild the escalation in your own words" })).toBeVisible();
  await expectNoHorizontalOverflow(page, ".session-shell");
  const confidence = page.getByRole("button", { name: "Somewhat sure" });
  if (await confidence.isVisible()) await confidence.click();
  const unknownAnswer = page.getByRole("button", { name: "I don't know yet" });
  await expect(unknownAnswer).toBeInViewport();
  await unknownAnswer.dispatchEvent("click");
  await expect(page.getByText("MODEL ANSWER")).toBeVisible();
  await expect(page.locator(".model-answer-card")).toContainText("Austria-Hungary responded to the assassination with an ultimatum");
  await expect(page.locator(".model-answer-card")).not.toContainText("A strong response");
});

test("an opaque class label is stopped until the learner names the actual calculus concept", async ({ page }) => {
  await createPreviewAccount(page);
  await completeOnboarding(page);

  await page.getByRole("button", { name: "Study something now", exact: true }).first().click();
  const goalInput = page.getByPlaceholder("Example: Help me understand the product rule and practice using it.");
  await goalInput.fill("Start Calc Unit 3");
  await expect(page.getByText(/class label such as “Unit 3” does not tell YOVA/i)).toBeVisible();
  await page.getByRole("button", { name: /Choose how YOVA should help/ }).click();
  await page.getByRole("button", { name: /Create it for me/ }).click();

  await expect(page.getByRole("heading", { name: "What topics or skills does this actually cover?" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Build and start session/ })).toBeDisabled();
  await page.getByRole("button", { name: "Product rule", exact: true }).click();
  await page.getByRole("button", { name: /Use this topic/ }).click();
  await expect(page.getByText("Start Calc Unit 3: Product rule", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Build and start session/ })).toBeEnabled();
  await page.getByRole("button", { name: /Build and start session/ }).click();
  await confirmSessionSetup(page);

  await expect(page.getByRole("heading", { name: "See the product rule before using it" })).toBeVisible();
  await expect(page.getByText(/teaching first/i).filter({ visible: true }).first()).toBeVisible();
  const workspaceWidth = await page.locator(".session-workspace").evaluate((element) => ({
    client: element.clientWidth,
    scroll: element.scrollWidth,
  }));
  expect(workspaceWidth.scroll).toBeLessThanOrEqual(workspaceWidth.client + 1);
});

test("a total lesson-service outage never asks the learner to redefine an already clear topic", async ({ page }) => {
  await page.route("**/api/sessions/generate", async (route) => {
    await route.fulfill({
      status: 502,
      contentType: "application/json",
      body: JSON.stringify({ error: "Temporary guided-session generation failure." }),
    });
  });
  await createPreviewAccount(page);
  await completeOnboarding(page);

  await page.getByRole("button", { name: "Study something now", exact: true }).first().click();
  await page.getByPlaceholder("Example: Help me understand the product rule and practice using it.").fill(
    "Help me understand eigenvalues and eigenvectors from scratch",
  );
  await page.getByRole("button", { name: "I haven't learned this yet" }).click();
  await page.getByRole("button", { name: /Choose how YOVA should help/ }).click();
  await page.getByRole("button", { name: /Create it for me/ }).click();
  await page.getByRole("button", { name: /Build and start session/ }).click();
  await confirmSessionSetup(page);

  await expect(page.getByRole("heading", { name: "YOVA already knows what this lesson should cover." })).toBeVisible();
  await expect(page.getByText(/You do not need to explain the lesson again/i)).toBeVisible();
  await expect(page.getByText("See the structure before trying it alone", { exact: true })).not.toBeVisible();
  await expect(page.getByRole("heading", { name: "What should happen after an initial explanation?" })).not.toBeVisible();
  await expect(page.getByRole("button", { name: "Add context and retry" })).not.toBeVisible();
  await expect(page.getByRole("button", { name: "Prepare this lesson again" })).toBeVisible();
});

test("a temporary AI failure loads a subject-specific startup funding lesson", async ({ page }) => {
  await page.route("**/api/sessions/generate", async (route) => {
    await route.fulfill({
      status: 502,
      contentType: "application/json",
      body: JSON.stringify({ error: "Temporary guided-session generation failure." }),
    });
  });
  await createPreviewAccount(page);
  await completeOnboarding(page);

  await page.getByRole("button", { name: "Study something now", exact: true }).first().click();
  await page.getByPlaceholder("Example: Help me understand the product rule and practice using it.").fill(
    "Teach me startup funding stages, instruments, investors, dilution, and term sheets from the beginning",
  );
  await page.getByRole("button", { name: "I haven't learned this yet" }).click();
  await page.getByRole("button", { name: /Choose how YOVA should help/ }).click();
  await page.getByRole("button", { name: /Create it for me/ }).click();
  await page.getByRole("button", { name: /Build and start session/ }).click();
  await confirmSessionSetup(page);

  await expect(page.getByRole("heading", { name: "Build the startup funding map" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Follow one founder from an idea to an early company." })).toBeVisible();
  await page.getByRole("button", { name: /Core idea/ }).click();
  await expect(page.getByText(/bootstrapping uses founder money or company revenue/i)).toBeVisible();
  await expect(page.getByText(/safe built-in session was loaded instead/i)).toBeVisible();
  await expect(page.getByRole("heading", { name: "YOVA already knows what this lesson should cover." })).not.toBeVisible();
});

test("home lets the learner browse prioritized recommendations without opening every plan", async ({ page }) => {
  test.setTimeout(60_000);
  await page.route("**/api/sessions/generate", async (route) => {
    await route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ error: "Temporary test failure." }) });
  });
  await createPreviewAccount(page);
  await completeOnboarding(page);

  await createOneOffLearningSession(page, "Help me understand compound growth and personal finance basics.");
  await expect(page.locator(".method-phase-coach:visible")).toContainText("See a complete model");
  await exitSessionWithoutProgress(page);

  await createOneOffLearningSession(page, "Teach me startup funding stages, instruments, investors, and dilution from the beginning.");
  await expect(page.getByRole("heading", { name: "Build the startup funding map" })).toBeVisible();
  await exitSessionWithoutProgress(page);

  await expect(page.getByLabel("Recommended learning plan")).toBeVisible();
  await expect(page.getByLabel("Show next recommendation")).toBeVisible();
  await expect(page.getByText("1 of 2", { exact: true })).toBeVisible();
  const firstTitle = await page.locator(".recommendation-card .rec-body h2").textContent();
  await page.getByLabel("Show next recommendation").click();
  await expect(page.getByText("2 of 2", { exact: true })).toBeVisible();
  await expect(page.locator(".recommendation-card .rec-body h2")).not.toHaveText(firstTitle ?? "");
  await expect(page.getByText("Swipe or use the arrows to see other plans")).toBeVisible();
});

test("outside study gives a concrete source-based session instead of pretending YOVA owns the content", async ({ page }) => {
  await createPreviewAccount(page);
  await completeOnboarding(page);

  await page.getByRole("button", { name: "Study something now", exact: true }).first().click();
  await page.getByPlaceholder("Example: Help me understand the product rule and practice using it.").fill(
    "Draft a comparative history thesis using my textbook evidence",
  );
  await page.getByRole("button", { name: /Choose how YOVA should help/ }).click();
  await page.getByRole("button", { name: /Guide me outside YOVA/ }).click();
  await page.getByRole("button", { name: /Build and start session/ }).click();
  await confirmSessionSetup(page);

  await expect(page.getByRole("heading", { name: "Prepare your outside study block" })).toBeVisible();
  await expect(page.getByText(/Open the material you use for Draft a comparative history thesis using my textbook evidence\. Keep only that source and a place to work visible/i)).toBeVisible();
  await expect(page.locator("strong:visible").filter({ hasText: /^Retrieval-based outlining$/ })).toBeVisible();
});

test("the backend rejects an opaque goal even when the browser guard is bypassed", async ({ request }) => {
  const response = await request.post("/api/plans/generate", {
    data: {
      intent: "study_now",
      learningIntent: "learn",
      goal: "Start Calc Unit 3",
      materialMode: "none",
      materials: [],
      studyMode: "inside",
      deadline: null,
      timeZone: "America/Los_Angeles",
      diagnosticResponses: [{
        question: "Where are you starting?",
        answer: "I have not learned this yet",
        evaluation: "self_report",
      }],
      availability: [{ day: "Today", window: "Now", minutes: 15 }],
      profileSummary: "The learner wants a short, clearly structured session.",
    },
  });
  const body = await response.json();

  expect(response.status()).toBe(422);
  expect(body.code).toBe("goal_needs_detail");
});

test("plan generation remains a draft until the learner activates it", async ({ request }) => {
  const generationRequest = {
    intent: "plan",
    learningIntent: "learn",
    goal: "Understand photosynthesis and cellular respiration for my biology test",
    materialMode: "none",
    materials: [],
    studyMode: "inside",
    deadline: "2026-08-14T23:59:00.000Z",
    timeZone: "America/Los_Angeles",
    diagnosticResponses: [{
      question: "Where are you starting?",
      answer: "I have not learned this yet",
      evaluation: "self_report",
    }],
    availability: [{ day: "Monday", window: "Evening", minutes: 25 }],
    profileSummary: "The learner prefers direct explanations, examples, and short structured sessions.",
  };
  const generationResponse = await request.post("/api/plans/generate", { data: generationRequest });
  const generated = await generationResponse.json();

  expect(generationResponse.status()).toBe(200);
  expect(generated.plan.status).toBe("draft");
  expect(generated.generation.persistence).toBe("draft");

  const activationResponse = await request.post("/api/plans/activate", {
    data: { plan: generated.plan, generationRequest },
  });
  const activated = await activationResponse.json();

  expect(activationResponse.status()).toBe(200);
  expect(activated.plan.status).toBe("active");
  expect(activated.activation.persistence).toBe("browser");

  const repeatedActivation = await request.post("/api/plans/activate", {
    data: { plan: generated.plan, generationRequest },
  });
  const repeated = await repeatedActivation.json();

  expect(repeatedActivation.status()).toBe(200);
  expect(repeated.plan.id).toBe(activated.plan.id);
  expect(repeated.plan.learningItemId).toBe(activated.plan.learningItemId);
});

test("a learner can stop twice without losing progress or earlier evidence", async ({ page }) => {
  await createPreviewAccount(page);
  await completeOnboarding(page);

  await page.getByRole("button", { name: "Study something now", exact: true }).first().click();
  await page.getByPlaceholder("Example: Help me understand the product rule and practice using it.").fill(
    "Help me understand compound growth and personal finance basics.",
  );
  await page.getByRole("button", { name: "I haven't learned this yet" }).click();
  await page.getByRole("button", { name: /Choose how YOVA should help/ }).click();
  await page.getByRole("button", { name: /Create it for me/ }).click();
  await page.getByRole("button", { name: /Build and start session/ }).click();
  await confirmSessionSetup(page);

  await expect(page.getByRole("heading", { name: "Use money concepts as decision tools" })).toBeVisible();
  await page.getByRole("button", { name: "Next: Explore the model" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await leaveSession(page, "1 of 5 required steps finished");

  await expect(page.getByText("Continue where you left off")).toBeVisible();
  await expect(page.getByText("1 section saved", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Continue session" }).click();
  await expect(page.getByRole("heading", { name: "Trace one financial choice" })).toBeVisible();
  await page.getByRole("button", { name: "Next: Explore the model" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "The earlier gain remains in the base" }).click();
  await expect(page.getByText("Correct.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await leaveSession(page, "3 of 5 required steps finished");

  await expect(page.getByText("3 sections saved", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Continue session" }).click();
  await expect(page.getByRole("heading", { name: "Explain compound growth in your own words" })).toBeVisible();
  await page.getByRole("button", { name: "Somewhat sure" }).click();
  await page.getByLabel("Perform independently").fill(
    "Earlier gains remain in the base, so the same percentage can produce larger gains later.",
  );
  await page.getByRole("button", { name: "Check my answer" }).dispatchEvent("click");
  await expect(page.getByText("YOVA'S FORMATIVE CHECK")).toBeVisible();
  await expect(page.getByText("The key idea is present.")).toBeVisible();
  await expect(page.getByText(/one-time AI check and is not saved/i)).toBeVisible();
  await page.getByRole("button", { name: "I got the key idea" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Finish this content" }).click();

  await expect(page.getByText("2 of 2", { exact: true })).toBeVisible();
  await expect(page.getByText("Evidence checks", { exact: true })).toBeVisible();
});

test("the product shell keeps every core destination and creation path usable", async ({ page }) => {
  await createPreviewAccount(page);
  await completeOnboarding(page);

  await expect(page.getByRole("heading", { name: /Good (morning|afternoon|evening), Learner\./ })).toBeVisible();
  await expect(page.getByText("What would you like to learn or prepare for?")).toBeVisible();
  await expectNoHorizontalOverflow(page, ".home-page");

  await page.getByRole("button", { name: "Learning", exact: true }).click();
  await expect(page.getByRole("heading", { name: "What you’re working toward" })).toBeVisible();
  await expectNoHorizontalOverflow(page, ".page");

  await page.getByRole("button", { name: "Agenda", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your week at a glance" })).toBeVisible();
  await expectNoHorizontalOverflow(page, ".page");

  await page.getByRole("button", { name: "Ask YOVA", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Get help in context" })).toBeVisible();
  await expectNoHorizontalOverflow(page, ".page");
  await expect(page.getByRole("combobox", { name: "Ask YOVA context" })).toHaveValue("general");
  await expect(page.getByText("No learning goal attached")).toBeVisible();
  await page.getByRole("button", { name: /^History/ }).click();
  await expect(page.getByRole("dialog", { name: "Previous chats" })).toBeVisible();
  await page.getByRole("button", { name: "Close conversation history" }).last().click();
  await page.getByRole("textbox", { name: "Ask YOVA" }).fill("An unsent draft");

  await page.getByRole("button", { name: "You", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your learning, in one place" })).toBeVisible();
  await expectNoHorizontalOverflow(page, ".page");
  await page.getByRole("button", { name: "Ask YOVA", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Ask YOVA context" })).toHaveValue("general");
  await expect(page.getByRole("textbox", { name: "Ask YOVA" })).toHaveValue("");
  await page.getByRole("button", { name: "You", exact: true }).click();

  await page.getByRole("button", { name: "Home", exact: true }).click();
  await page.locator(".quick-actions button").filter({ hasText: "Create another plan" }).click();
  await expect(page.getByRole("heading", { name: "What do you need to learn or prepare for?" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();

  await page.getByRole("button", { name: "Agenda", exact: true }).click();
  await page.getByRole("button", { name: "Add to Agenda", exact: true }).click();
  await expect(page.getByRole("heading", { name: "What do you need to learn, prepare for, or complete?" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("button", { name: "Home", exact: true }).click();

  await page.getByRole("button", { name: "Study something now", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "What do you want help with?" })).toBeVisible();
});

test("Ask YOVA turns structured explanations and math into readable interface content", async ({ page }) => {
  await createPreviewAccount(page);
  await completeOnboarding(page);

  await page.route("**/api/tutor", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    const threadId = "10000000-0000-4000-8000-000000000001";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        threadId,
        messages: [
          {
            id: "10000000-0000-4000-8000-000000000002",
            threadId,
            role: "user",
            content: "Explain the derivative at x equals 2.",
            createdAt: "2026-08-06T20:00:00.000Z",
          },
          {
            id: "10000000-0000-4000-8000-000000000003",
            threadId,
            role: "assistant",
            content: "**Core idea:** the derivative is the instantaneous rate of change.\n\nUse $f'(2)=4$.\n\n1. Compare nearby points.\n2. Shrink the interval.",
            createdAt: "2026-08-06T20:00:01.000Z",
          },
        ],
        model: "test-model",
        persistence: "browser",
        proposedAction: null,
      }),
    });
  });

  await page.getByRole("button", { name: "Ask YOVA", exact: true }).click();
  await page.getByRole("textbox", { name: "Ask YOVA" }).fill("Explain the derivative at x equals 2.");
  await page.getByRole("button", { name: "Send" }).click();

  await expect(page.locator(".tutor-rich-text strong")).toHaveText("Core idea:");
  await expect(page.locator(".tutor-rich-text .katex")).toBeVisible();
  await expect(page.locator(".tutor-rich-text li")).toHaveCount(2);
  await expect(page.locator(".tutor-rich-text")).not.toContainText("**");
});

test("the session tutor stays anchored to the exact learning activity", async ({ page }) => {
  await createPreviewAccount(page);
  await completeOnboarding(page);

  let capturedRequest: { sessionContext?: Record<string, unknown> } = {};
  await page.route("**/api/tutor", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    capturedRequest = route.request().postDataJSON() as { sessionContext?: Record<string, unknown> };
    const threadId = "20000000-0000-4000-8000-000000000001";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        threadId,
        messages: [
          {
            id: "20000000-0000-4000-8000-000000000002",
            threadId,
            role: "user",
            content: "Show me one concrete example of the idea in this step.",
            createdAt: "2026-08-06T21:00:00.000Z",
          },
          {
            id: "20000000-0000-4000-8000-000000000003",
            threadId,
            role: "assistant",
            content: "**Example:** if $100$ grows by $10$, the new base is $110$. The next percentage gain uses that larger base.",
            createdAt: "2026-08-06T21:00:01.000Z",
          },
        ],
        model: "test-model",
        persistence: "browser",
        proposedAction: null,
      }),
    });
  });

  await page.getByRole("button", { name: "Study something now", exact: true }).first().click();
  await page.getByPlaceholder("Example: Help me understand the product rule and practice using it.").fill(
    "Help me understand compound growth and personal finance basics.",
  );
  await page.getByRole("button", { name: "I haven't learned this yet" }).click();
  await page.getByRole("button", { name: /Choose how YOVA should help/ }).click();
  await page.getByRole("button", { name: /Create it for me/ }).click();
  await page.getByRole("button", { name: /Build and start session/ }).click();
  await confirmSessionSetup(page);

  await expect(page.getByRole("heading", { name: "Use money concepts as decision tools" })).toBeVisible();
  await page.getByRole("button", { name: "Ask YOVA", exact: true }).click();
  await expect(page.getByRole("button", { name: "Explain it differently" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Show an example" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Check my understanding" })).toBeVisible();
  await page.getByRole("button", { name: "Show an example" }).click();

  await expect(page.locator(".session-tutor-assistant .tutor-rich-text strong")).toHaveText("Example:");
  await expect(page.locator(".session-tutor-assistant .katex").first()).toBeVisible();
  await expect(page.locator(".session-tutor-response")).not.toContainText("**");
  await expect(page.getByText("YOVA sees the step and result, but not your typed free response.")).toBeVisible();

  const sessionContext = capturedRequest.sessionContext ?? {};
  expect(sessionContext.activityTitle).toBe("Use money concepts as decision tools");
  expect(sessionContext.activityType).toBe("instruction");
  expect(sessionContext.helpIntent).toBe("show_example");
  expect(sessionContext.answerState).toBe("not_attempted");
  expect(sessionContext.selectedChoice).toBeNull();
  expect(String(sessionContext.teachingSummary)).toContain("budget");
});

test("a planning request outage still produces a reviewable plan from YOVA's saved inputs", async ({ page }) => {
  await page.route("**/api/plans/generate", async (route) => {
    await route.fulfill({
      status: 502,
      contentType: "application/json",
      body: JSON.stringify({ error: "Temporary planning service failure." }),
    });
  });
  await createPreviewAccount(page);
  await completeOnboarding(page);

  await beginPlanFromAdd(page, "I have a biology test next Friday on cellular respiration.");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Skip for now" }).click();
  await page.getByRole("button", { name: "Generate my plan" }).click();

  await expect(page.getByText("Plan ready")).toBeVisible();
  await expect(page.getByText(/reliable planning engine because the live planning request was interrupted/i)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Your information is safe." })).not.toBeVisible();
});

test("a multi-session plan carries one clear source decision from Add to Learning", async ({ page }) => {
  await createPreviewAccount(page);
  await completeOnboarding(page);

  await beginPlanFromAdd(page, "I have a biology test next Friday on cellular respiration.");

  await expect(page.getByRole("heading", { name: "When would you prefer to study this material?" })).toBeVisible();
  const enabledMinuteSelectors = page.locator("select[aria-label$='available minutes']:not([disabled])");
  for (let index = 0; index < await enabledMinuteSelectors.count(); index += 1) {
    await enabledMinuteSelectors.nth(index).selectOption("45");
  }
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Skip for now" }).click();

  await expect(page.getByRole("heading", { name: "Everything YOVA will use" })).toBeVisible();
  await expect(page.getByText("Guided inside YOVA with YOVA-created teaching and practice")).toBeVisible();
  await page.getByRole("button", { name: "Generate my plan" }).click();

  await expect(page.getByText("Plan ready")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Does this plan match what you need?" })).toBeVisible();
  await expect(page.getByText("Nothing is active until you confirm it below.")).toBeVisible();
  const planContract = page.getByRole("region", { name: "How YOVA mapped this plan" });
  await expect(planContract).toBeVisible();
  await expect(planContract).toContainText("KNOWLEDGE MAP");
  await expect(planContract).toContainText("SESSION LOAD");
  await expect(planContract).toContainText("YOUR DELIVERY");
  await expect(planContract).toContainText("YOUR SCHEDULE");
  await expect(page.locator(".generated-session-focus").first()).toContainText("Focus:");
  await page.getByRole("button", { name: "Change schedule" }).click();
  await expect(page.getByRole("heading", { name: "When would you prefer to study this material?" })).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Skip for now" }).click();
  await page.getByRole("button", { name: "Generate my plan" }).click();
  await expect(page.getByText("Plan ready")).toBeVisible();
  await page.getByRole("button", { name: "Use this plan" }).click();
  await expect(page.getByRole("heading", { name: "Your plan" })).toBeVisible();
  await expect(page.getByText("Created by YOVA", { exact: true })).toBeVisible();

  const initialSessionCount = await page.locator(".timeline-row").count();
  expect(initialSessionCount).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Adjust", exact: true }).click();
  await expect(page.getByText(/Time controls the size of each content slice/)).toBeVisible();
  await page.getByRole("combobox", { name: /Future session window/ }).selectOption("15");
  await page.getByRole("button", { name: "Approve and rebuild plan" }).click();

  await expect.poll(async () => page.locator(".timeline-row").count()).toBeGreaterThan(initialSessionCount);
  const adjustedDurations = await page.locator(".timeline-row > span:last-child").allTextContents();
  expect(adjustedDurations.length).toBeGreaterThan(initialSessionCount);
  expect(adjustedDurations.every((duration) => Number.parseInt(duration, 10) <= 15)).toBe(true);
  await expect(page.getByText(/sessions complete/).first()).toBeVisible();

  await page.getByRole("button", { name: "Ask YOVA", exact: true }).click();
  const tutorContext = page.getByRole("combobox", { name: "Ask YOVA context" });
  await expect(tutorContext).toHaveValue("general");
  await tutorContext.selectOption({ label: "Photosynthesis and Cellular Respiration" });
  await expect(page.getByText("Using learning context")).toBeVisible();
  await expect(page.getByText("YOVA can use this goal's materials, next session, and learner evidence.")).toBeVisible();
  await page.getByRole("button", { name: "Learning", exact: true }).click();
  await page.getByRole("button", { name: "Ask YOVA", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Ask YOVA context" })).toHaveValue("general");

  await page.getByRole("button", { name: "Agenda", exact: true }).click();
  const moveOverdue = page.getByRole("button", { name: "Move to tomorrow" });
  if (await moveOverdue.isVisible()) await moveOverdue.click();
  await expect(page.getByRole("heading", { name: "Your week at a glance" })).toBeVisible();
  const adjustmentTools = page.locator("details.agenda-adjustment-tools");
  if (!(await adjustmentTools.getAttribute("open"))) await adjustmentTools.locator("summary").click();
  await expect(page.getByText("What YOVA is allowed to change")).toBeVisible();
  await page.getByRole("button", { name: "I have 15 minutes today" }).click();
  await expect(page.locator(".agenda-capacity-result")).not.toHaveClass(/blocked/);
  await expect(page.locator(".agenda-capacity-result")).toContainText(/Today already fits|No change needed/);
  await expect(page.getByText(/planned sessions/).first()).toBeVisible();
});

test("material setup clearly supports files, articles, and YouTube transcripts", async ({ page }) => {
  await createPreviewAccount(page);
  await completeOnboarding(page);

  await page.getByRole("button", { name: "Study something now", exact: true }).first().click();
  await page.getByPlaceholder("Example: Help me understand the product rule and practice using it.").fill(
    "Help me understand how ecosystems respond to invasive species.",
  );
  await page.getByRole("button", { name: /Choose how YOVA should help/ }).click();
  await page.getByRole("button", { name: /Use my materials/ }).click();
  const dropzone = page.getByLabel("Upload learning materials. Choose files or drag and drop them here.");
  await expect(dropzone).toContainText("Choose files or drag them here");
  await expect(dropzone).toContainText("PDF, TXT, or Markdown");
  await expect(page.getByRole("button", { name: /Add an article or YouTube video/ })).toBeVisible();
  await page.getByRole("button", { name: /Add an article or YouTube video/ }).click();
  await expect(page.getByRole("region", { name: "Add material from a link" })).toContainText("Public article");
  await expect(page.getByRole("region", { name: "Add material from a link" })).toContainText("YouTube transcript");
  await expect(page.getByText(/does not bypass paywalls or sign-ins/i)).toBeVisible();
});

test("material drop zone accepts drag gestures and explains rejected files", async ({ page }) => {
  await createPreviewAccount(page);
  await completeOnboarding(page);

  await page.getByRole("button", { name: "Study something now", exact: true }).first().click();
  await page.getByPlaceholder("Example: Help me understand the product rule and practice using it.").fill(
    "Help me prepare for a World War I history test.",
  );
  await page.getByRole("button", { name: /Choose how YOVA should help/ }).click();
  await page.getByRole("button", { name: /Use my materials/ }).click();

  const dropzone = page.getByLabel("Upload learning materials. Choose files or drag and drop them here.");
  const transfer = await page.evaluateHandle(() => {
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(new File(["history notes"], "history-notes.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    }));
    return dataTransfer;
  });

  await dropzone.dispatchEvent("dragenter", { dataTransfer: transfer });
  await expect(dropzone).toHaveClass(/drag-active/);
  await expect(dropzone).toContainText("Drop files to add them");
  await dropzone.dispatchEvent("drop", { dataTransfer: transfer });
  await expect(dropzone).not.toHaveClass(/drag-active/);
  await expect(page.getByText("history-notes.docx is not supported. Use PDF, TXT, or Markdown.")).toBeVisible();
  await transfer.dispose();

  await page.getByLabel("Choose learning materials").setInputFiles({
    name: "teacher-guide.pptx",
    mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    buffer: Buffer.from("not a supported upload"),
  });
  await expect(page.getByText("teacher-guide.pptx is not supported. Use PDF, TXT, or Markdown.")).toBeVisible();
});

async function openMobileSessionGuide(page: Page) {
  const mobileGuide = page.locator(".session-guide-mobile");
  if (await mobileGuide.isVisible()) await mobileGuide.locator(":scope > summary").click();
}

async function beginPlanFromAdd(page: Page, description: string) {
  await page.getByRole("button", { name: "Agenda", exact: true }).click();
  await page.getByRole("button", { name: "Add to Agenda", exact: true }).click();
  await page.getByPlaceholder("Example: I have a World War I test in two weeks. I am starting from the beginning and I have a study guide.").fill(description);
  await page.getByRole("button", { name: "Organize this" }).click();
  await expect(page.getByRole("heading", { name: "Here is what YOVA understood." })).toBeVisible();
  await page.getByRole("button", { name: "Choose what YOVA should do" }).click();
  await page.getByRole("button", { name: /Create a plan/ }).click();
}

async function expectNoHorizontalOverflow(page: Page, selector: string) {
  const overflow = await page.locator(selector).first().evaluate((element) => ({
    client: element.clientWidth,
    scroll: element.scrollWidth,
    offenders: Array.from(element.querySelectorAll<HTMLElement>("*")).map((child) => {
      const rect = child.getBoundingClientRect();
      return {
        tag: child.tagName.toLowerCase(),
        className: child.className,
        client: child.clientWidth,
        scroll: child.scrollWidth,
        width: Math.round(rect.width),
        right: Math.round(rect.right),
      };
    }).filter((item) => item.scroll > item.client + 1 || item.width > window.innerWidth + 1 || item.right > window.innerWidth + 1).slice(0, 12),
  }));
  expect(
    overflow.scroll,
    `Horizontal overflow in ${selector}: ${JSON.stringify(overflow.offenders)}`,
  ).toBeLessThanOrEqual(overflow.client + 1);
}

async function createPreviewAccount(page: Page) {
  await page.goto("/?qa=preview");
  await page.getByRole("button", { name: "Build my plan" }).click();
  await page.getByLabel("First name").fill("Learner");
  await page.getByLabel("Email address").fill("learning-loop@example.com");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Make YOVA fit how you actually study." })).toBeVisible();
}

async function completeOnboarding(page: Page) {
  await page.getByRole("button", { name: /Personalize YOVA/ }).click();

  for (const [index, answer] of onboardingAnswers.entries()) {
    await page.getByRole("button", { name: answer, exact: true }).click();
    const nextLabel = index === onboardingAnswers.length - 1 ? "Build my setup" : "Continue";
    await page.getByRole("button", { name: nextLabel }).click();
  }

  await expect(page.getByRole("heading", { name: "YOVA will begin like this." })).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue to private alpha" }).click();
}

async function leaveSession(page: Page, progressText: string) {
  await page.getByRole("button", { name: "Exit" }).dispatchEvent("click");
  await expect(page.getByRole("dialog", { name: "Your plan will stay open." })).toContainText(progressText);
  await page.getByRole("button", { name: "Save progress and leave" }).dispatchEvent("click");
}

async function confirmSessionSetup(page: Page) {
  await expect(page.getByRole("heading", { name: "Here is how YOVA plans to start." })).toBeVisible();
  await expect(page.getByLabel("Why YOVA chose this approach")).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Has anything changed?" })).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Set the pace for today." })).toBeVisible();
  await page.getByRole("button", { name: "Prepare this session" }).click();
}

async function createOneOffLearningSession(page: Page, request: string) {
  await page.locator(".quick-actions button").filter({ hasText: "Study something now" }).click();
  await page.getByPlaceholder("Example: Help me understand the product rule and practice using it.").fill(request);
  await page.getByRole("button", { name: "I haven't learned this yet" }).click();
  await page.getByRole("button", { name: /Choose how YOVA should help/ }).click();
  await page.getByRole("button", { name: /Create it for me/ }).click();
  await page.getByRole("button", { name: /Build and start session/ }).click();
  await confirmSessionSetup(page);
}

async function exitSessionWithoutProgress(page: Page) {
  await page.getByRole("button", { name: "Exit" }).dispatchEvent("click");
  await expect(page.getByRole("dialog", { name: "Your plan will stay open." })).toBeVisible();
  await page.getByRole("button", { name: "Save progress and leave" }).dispatchEvent("click");
}
