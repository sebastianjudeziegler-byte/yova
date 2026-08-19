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

test("durable allowance exhaustion loads an arbitrary inside session fallback and names the reset", async ({ page }) => {
  await page.route("**/api/sessions/generate", async (route) => {
    await route.fulfill({
      status: 429,
      contentType: "application/json",
      headers: {
        "Retry-After": "3600",
        "X-Yova-Fallback-Reason": "guided_session_allowance_exhausted",
        "X-Yova-Request-Id": "86948113-b4be-423a-b0bc-d86aaae1ba7b",
      },
      body: JSON.stringify({
        error: "This account has used all of its guided-session allowance.",
        code: "guided_session_allowance_exhausted",
        retryable: false,
        retryAfterSeconds: 3600,
      }),
    });
  });
  await createPreviewAccount(page);
  await completeOnboarding(page);

  await createOneOffLearningSession(
    page,
    "Review the photosynthetic electron transport chain for my test.",
    "study",
  );

  const allowanceNotice = page.locator(".session-issue").filter({
    hasText: "Your guided-session allowance is used up until",
  });
  await expect(allowanceNotice).toContainText("A safe built-in session was loaded instead");
  await expect(allowanceNotice).toContainText("Reference: 86948113-b4be-423a-b0bc-d86aaae1ba7b");
  await expect(page.getByRole("heading", { name: "Use the session target as your comparison frame" })).toBeVisible();
  await expect(page.getByText("LESSON SERVICE INTERRUPTED", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Prepare this lesson again" })).toHaveCount(0);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Make an unsupported attempt first" })).toBeVisible();
});

test("durable allowance exhaustion without a safe fallback has its own non-retryable state", async ({ page }) => {
  await page.route("**/api/sessions/generate", async (route) => {
    await route.fulfill({
      status: 429,
      contentType: "application/json",
      headers: {
        "Retry-After": "1800",
        "X-Yova-Fallback-Reason": "guided_session_allowance_exhausted",
      },
      body: JSON.stringify({
        error: "This account has used all of its guided-session allowance.",
        code: "guided_session_allowance_exhausted",
        retryable: false,
        retryAfterSeconds: 1800,
      }),
    });
  });
  await createPreviewAccount(page);
  await completeOnboarding(page);

  await page.getByRole("button", { name: "Study something now", exact: true }).first().click();
  await page.getByPlaceholder("Example: Help me understand the product rule and practice using it.").fill(
    "Help me understand the photosynthetic electron transport chain from scratch.",
  );
  await page.getByRole("button", { name: "I haven't learned this yet" }).click();
  await page.getByRole("button", { name: /Choose how YOVA should help/ }).click();
  await page.getByRole("button", { name: /Create it for me/ }).click();
  await page.getByRole("button", { name: /Build and start session/ }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Anything YOVA should account for?").fill(
    "Use my instructor's private rubric for every comparison.",
  );
  await page.getByRole("button", { name: "Prepare this session" }).click();

  const quotaState = page.locator(".session-quota-state");
  await expect(quotaState).toContainText("GUIDED SESSION ALLOWANCE USED");
  await expect(quotaState).toContainText("You can request another generated lesson after");
  await expect(quotaState.locator("time")).toHaveAttribute("datetime", /\d{4}-\d{2}-\d{2}T/);
  await expect(quotaState).toContainText("could not build an offline lesson for this session configuration");
  await expect(page.getByText("LESSON SERVICE INTERRUPTED", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Prepare this lesson again" })).toHaveCount(0);
  await expect(quotaState.getByRole("button", { name: /^Open / })).toBeVisible();
});

test("streamed lesson quota uses its built-in explanation and surfaces the reset", async ({ page }) => {
  await page.route("**/api/sessions/generate", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(streamedResumeSessionResponse()),
    });
  });
  await page.route("**/api/sessions/lesson", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      headers: {
        "Retry-After": "900",
        "X-Yova-Fallback-Reason": "guided_session_allowance_exhausted",
      },
      body: [
        'data: {"type":"lesson.meta","requestId":"86948113-b4be-423a-b0bc-d86aaae1ba7b","model":"built-in"}',
        "",
        'data: {"type":"lesson.replace","content":"# Allowance-safe explanation\\n\\nThis bounded explanation came from the validated lesson brief without another AI call."}',
        "",
        'data: {"type":"lesson.complete","elapsedMs":0,"latencyToFirstTokenMs":null,"inputTokens":0,"cachedInputTokens":0,"outputTokens":0,"wordCount":15,"model":"built-in"}',
        "",
        "",
      ].join("\n"),
    });
  });
  await createPreviewAccount(page);
  await completeOnboarding(page);

  await createOneOffLearningSession(page, "Help me understand retrieval practice and test the idea.");

  await expect(page.getByText("Allowance-safe explanation")).toBeVisible();
  const allowanceNotice = page.locator(".session-issue").filter({
    hasText: "Your guided-session allowance is used up until",
  });
  await expect(allowanceNotice).toContainText("A safe built-in explanation was loaded instead");
  await expect(page.getByText("LESSON SERVICE INTERRUPTED", { exact: true })).toHaveCount(0);
});

test("a confident misconception is repaired now without a duplicate follow-up", async ({ page }) => {
  await page.route("**/api/sessions/generate", async (route) => {
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "Temporary guided-session generation failure." }),
    });
  });
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
  await expect(page.getByRole("heading", { name: "Here is how YOVA plans to start." })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByLabel("Why YOVA chose this approach")).toContainText("Start with evidence, then repair only the gap");
  await page.getByRole("button", { name: "Continue" }).click();
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

  await expect(page.getByText("Repair now, verify later")).toBeVisible({ timeout: 15_000 });
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

test("a built-in fallback fails closed for a teaching-first adjustment", async ({ page }) => {
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

  await expect(page.getByRole("heading", { name: "YOVA could not reach the guided-lesson service." })).toBeVisible();
  await expect(page.getByText(/could not build an offline lesson for this session configuration/i)).toBeVisible();
  await expect(page.getByText(/still needs an initial subject explanation/i)).toBeVisible();
  await expect(page.getByRole("button", { name: "Review session setup" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "See the product rule before using it" })).not.toBeVisible();
  await expect(page.getByText(/safe built-in session was loaded instead/i)).not.toBeVisible();
});

test("an inactive-plan generation response cannot open a stale built-in lesson", async ({ page }) => {
  await page.route("**/api/sessions/generate", async (route) => {
    await route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({ error: "That learning plan is no longer active." }),
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
  await page.getByRole("button", { name: "Prepare this session" }).click();

  await expect(page.getByRole("heading", { name: "YOVA could not prepare a guided lesson for this session setup." })).toBeVisible();
  await expect(page.getByText("That learning plan is no longer active.")).toBeVisible();
  await expect(page.getByRole("button", { name: /guided lesson again/i })).toHaveCount(0);
  await expect(page.getByText(/safe built-in session was loaded instead/i)).not.toBeVisible();
});

test("a shortened inside session uses the generic floor when its curated lesson does not fit", async ({ page }) => {
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
    "Review the product rule and test what I remember.",
  );
  await page.getByRole("button", { name: "I understand the basics but need practice" }).click();
  await page.getByRole("button", { name: /Choose how YOVA should help/ }).click();
  await page.getByRole("button", { name: /Create it for me/ }).click();
  await page.getByRole("button", { name: /Build and start session/ }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Time available right now").selectOption("10");
  await page.getByRole("button", { name: "Prepare this session" }).click();

  await expect(page.getByText(/safe built-in session was loaded instead/i)).toBeVisible();
  await expect(page.getByText("STEP 1 OF 3", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Use the session target as your comparison frame" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "YOVA already knows what this lesson should cover." })).not.toBeVisible();
});

test("a built-in fallback never ignores a learner's custom session requirement", async ({ page }) => {
  const generationBodies: Array<Record<string, unknown>> = [];
  await page.route("**/api/sessions/generate", async (route) => {
    generationBodies.push(route.request().postDataJSON() as Record<string, unknown>);
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
  await page.getByLabel("Time available right now").selectOption("20");
  await page.getByLabel("Anything YOVA should account for?").fill("This session must also cover the quotient rule.");
  await page.getByRole("button", { name: "Prepare this session" }).click();

  await expect(page.getByRole("heading", { name: "YOVA could not reach the guided-lesson service." })).toBeVisible();
  await expect(page.getByText(/could not build an offline lesson for this session configuration/i)).toBeVisible();
  await expect(page.getByText(/safe built-in session was loaded instead/i)).not.toBeVisible();

  await page.getByRole("button", { name: "Try preparing the guided lesson again" }).click();
  await expect.poll(() => generationBodies.length).toBe(2);
  expect(generationBodies[1]?.sessionAdjustment).toEqual(generationBodies[0]?.sessionAdjustment);
  expect(generationBodies[1]?.sessionAdjustment).toMatchObject({
    familiarity: "as_planned",
    availableMinutes: 20,
    note: "This session must also cover the quotient rule.",
  });
  await expect(page.getByRole("heading", { name: "YOVA could not reach the guided-lesson service." })).toBeVisible();
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
  await page.getByRole("dialog", { name: /Review the lesson, then return to the same question/i })
    .locator("footer")
    .getByRole("button", { name: "Back to the question" })
    .click();
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
  const renderedFormula = page.locator(".teaching-core .katex").first();
  await expect(renderedFormula).toBeVisible();
  await expect(renderedFormula.locator("annotation[encoding='application/x-tex']")).toContainText("frac");
  const formulaLayout = await renderedFormula.evaluate((element) => ({
    fontSize: Number.parseFloat(getComputedStyle(element).fontSize),
    fitsItsLine: element.getBoundingClientRect().width <= (element.parentElement?.getBoundingClientRect().width ?? 0) + 1,
  }));
  expect(formulaLayout.fontSize).toBeGreaterThanOrEqual(15);
  expect(formulaLayout.fitsItsLine).toBe(true);
  const workspaceWidth = await page.locator(".session-workspace").evaluate((element) => ({
    client: element.clientWidth,
    scroll: element.scrollWidth,
  }));
  expect(workspaceWidth.scroll).toBeLessThanOrEqual(workspaceWidth.client + 1);
});

test("a teaching-first inside outage does not start with unsupported recall", async ({ page }) => {
  await page.route("**/api/sessions/generate", async (route) => {
    await route.fulfill({
      status: 502,
      contentType: "application/json",
      body: JSON.stringify({
        error: "Live generation did not produce a guided session that passed YOVA's learning checks.",
        code: "guided_session_quality_checks_failed",
        retryable: false,
      }),
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

  await expect(page.getByText("LESSON QUALITY CHECK", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "The generated lesson did not pass YOVA's quality checks." })).toBeVisible();
  await expect(page.getByText(/teaching-first session still needs an initial subject explanation/i)).toBeVisible();
  await expect(page.getByLabel("Study-method workpad")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Use the study method" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Try preparing the guided lesson again" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Review session setup" })).toBeVisible();
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

  const methodWorkpad = page.getByLabel("Study-method workpad");
  const methodBriefing = methodWorkpad.getByLabel("How to study this");
  await expect(methodWorkpad).toBeVisible();
  await expect(methodBriefing).toContainText("HOW TO STUDY THIS");
  await expect(methodBriefing).toContainText("TODAY'S TARGET");
  await expect(methodBriefing).toContainText("What this covers");
  await expect(methodBriefing).toContainText("Finished means");
  await expect(methodBriefing).toContainText("WHY THIS METHOD");
  await expect(methodBriefing).toContainText("Use it like this");
  await expect(methodBriefing).toContainText("Why this fits today");
  await expect(methodBriefing).toContainText(/learner’s own materials/i);
  await expect(methodWorkpad).toContainText("This completes practice, not a knowledge check.");
  await expect(page.locator(".session-activity-header").getByRole("heading", { name: /How to use/i })).toBeVisible();
  await expect(page.getByText(/move to your own source/i)).toBeVisible();
  await expect(page.locator("strong:visible").filter({ hasText: /^Retrieval-based outlining$/ })).toBeVisible();
});

test("an arbitrary outside method workpad completes as practice without changing topic evidence", async ({ page }) => {
  await createPreviewAccount(page);
  await completeOnboarding(page);

  await page.getByRole("button", { name: "Study something now", exact: true }).first().click();
  await page.getByPlaceholder("Example: Help me understand the product rule and practice using it.").fill(
    "Review how thermohaline circulation moves heat using my oceanography textbook",
  );
  await page.getByRole("button", { name: "I understand the basics but need practice" }).click();
  await page.getByRole("button", { name: /Choose how YOVA should help/ }).click();
  await page.getByRole("button", { name: /Guide me outside YOVA/ }).click();
  await page.getByRole("button", { name: /Build and start session/ }).click();
  await confirmSessionSetup(page);

  const workpad = page.getByLabel("Study-method workpad");
  await expect(workpad).toBeVisible();
  await expect(workpad.getByLabel("How to study this")).toContainText(/thermohaline circulation/i);
  await expect(workpad).toContainText("This completes practice, not a knowledge check.");

  await expect.poll(async () => Boolean(await readPreviewPracticeState(page))).toBe(true);
  const before = await readPreviewPracticeState(page);
  if (!before) throw new Error("Expected the outside session in the preview snapshot.");
  expect(before.topicStatuses.length).toBeGreaterThan(0);
  expect(before.sessionStatus).toBe("ready");

  await workpad.getByLabel("Your workpad").fill(
    "Warm, salty surface water moves heat toward higher latitudes, cools, becomes denser, sinks, and joins deep circulation.",
  );
  const topicChecks = workpad.getByRole("group", { name: "Check each covered topic" }).getByRole("checkbox");
  const topicCount = await topicChecks.count();
  expect(topicCount).toBeGreaterThan(0);
  for (let index = 0; index < topicCount; index += 1) {
    await topicChecks.nth(index).check();
  }

  const finishPractice = workpad.getByRole("button", { name: "Finish as ungraded practice" });
  await expect(finishPractice).toBeEnabled();
  await finishPractice.click();

  await expect(page.getByText("UNGRADED PRACTICE COMPLETE", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "The session moves forward. Your knowledge map does not." })).toBeVisible();
  await expect(page.getByText("KNOWLEDGE MAP UPDATED", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Topic evidence", { exact: true })).toBeVisible();
  await expect(page.getByText("None added", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Finish and continue" }).click();

  await expect(page.getByRole("heading", { name: /Good (morning|afternoon|evening), Learner\./ })).toBeVisible();
  await expect.poll(async () => {
    const after = await readPreviewPracticeState(page, before.planId, before.sessionId);
    return after?.completion?.completionMode ?? null;
  }).toBe("unguided_practice");

  const after = await readPreviewPracticeState(page, before.planId, before.sessionId);
  if (!after?.completion) throw new Error("Expected the unguided completion in the preview snapshot.");
  expect(after.sessionStatus).toBe("complete");
  expect(after.topicStatuses).toEqual(before.topicStatuses);
  expect(after.topicStatusesSerialized).toBe(before.topicStatusesSerialized);
  expect(after.completion).toMatchObject({
    completionMode: "unguided_practice",
    correctAnswers: 0,
    totalAnswers: 0,
    observedGap: "Unguided practice completed; no topic evidence was recorded.",
    conceptEvidence: [],
    confidenceEvidence: [],
  });
  expect(after.verificationSession).toMatchObject({
    id: after.completion.id,
    sequence: before.sessionSequence + 1,
    status: "ready",
    learningMode: "study",
    reviewType: "verify",
    topicIds: before.sessionTopicIds,
    contentTargets: before.sessionContentTargets,
    completionEvidence: before.sessionCompletionEvidence,
  });
});

test("a 10-minute outside teaching-first session loads its built-in method lesson", async ({ page }) => {
  await page.route("**/api/sessions/generate", async (route) => {
    await route.fulfill({
      status: 502,
      contentType: "application/json",
      body: JSON.stringify({
        error: "Live generation did not produce a guided session that passed YOVA's learning checks.",
        retryable: false,
      }),
    });
  });
  await createPreviewAccount(page);
  await completeOnboarding(page);

  await page.getByRole("button", { name: "Study something now", exact: true }).first().click();
  await page.getByPlaceholder("Example: Help me understand the product rule and practice using it.").fill(
    "I want to understand how the Krebs cycle actually produces NADH and FADH2",
  );
  await page.getByRole("button", { name: "I haven't learned this yet" }).click();
  await page.getByRole("button", { name: /Choose how YOVA should help/ }).click();
  await page.getByRole("button", { name: /Guide me outside YOVA/ }).click();
  await page.getByRole("button", { name: /Build and start session/ }).click();

  await expect(page.getByRole("heading", { name: "Here is how YOVA plans to start." })).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "I need this taught first" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Time available right now").selectOption("10");
  await page.getByRole("button", { name: "Prepare this session" }).click();

  await expect(page.getByText(/safe built-in session was loaded instead/i)).toBeVisible();
  await expect(page.getByText("STEP 1 OF 3", { exact: true })).toBeVisible();
  await expect(page.locator(".session-activity-header").getByRole("heading", { name: /How to use/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: "YOVA already knows what this lesson should cover." })).not.toBeVisible();
});

test("an overdue outside teaching-first session splits into runnable 10-minute parts", async ({ page }) => {
  await createPreviewAccount(page);
  await completeOnboarding(page);

  await page.getByRole("button", { name: "Study something now", exact: true }).first().click();
  await page.getByPlaceholder("Example: Help me understand the product rule and practice using it.").fill(
    "I want to understand how the Krebs cycle actually produces NADH and FADH2",
  );
  await page.getByRole("button", { name: "15 minutes", exact: true }).click();
  await page.getByRole("button", { name: "I haven't learned this yet" }).click();
  await page.getByRole("button", { name: /Choose how YOVA should help/ }).click();
  await page.getByRole("button", { name: /Guide me outside YOVA/ }).click();
  await page.getByRole("button", { name: /Build and start session/ }).click();

  const setupSummary = page.locator(".session-current-assumption");
  await expect(page.getByRole("heading", { name: "Here is how YOVA plans to start." })).toBeVisible();
  await expect(setupSummary).toContainText("about 15 minutes");
  await page.getByRole("button", { name: "Not now", exact: true }).click();

  await expect.poll(() => page.evaluate(() => {
    const stored = window.localStorage.getItem("yova.preview.v1");
    if (!stored) return null;
    const snapshot = JSON.parse(stored) as {
      plans?: Array<{ sessions?: Array<{ estimatedMinutes?: number; status?: string }> }>;
    };
    const ready = snapshot.plans?.at(-1)?.sessions?.find((session) => session.status === "ready");
    return ready?.estimatedMinutes ?? null;
  })).toBe(15);

  await page.evaluate(() => {
    const stored = window.localStorage.getItem("yova.preview.v1");
    if (!stored) throw new Error("Expected the Study Now plan in the preview snapshot.");
    const snapshot = JSON.parse(stored) as {
      plans?: Array<{ sessions?: Array<{ scheduledFor?: string; status?: string }> }>;
      updatedAt?: string;
    };
    const ready = snapshot.plans?.at(-1)?.sessions?.find((session) => session.status === "ready");
    if (!ready) throw new Error("Expected a ready session to make overdue.");
    ready.scheduledFor = new Date(Date.now() - 6 * 60 * 60 * 1_000).toISOString();
    snapshot.updatedAt = new Date().toISOString();
    window.localStorage.setItem("yova.preview.v1", JSON.stringify(snapshot));
  });
  await page.reload();

  await page.getByRole("button", { name: "Agenda", exact: true }).click();
  await expect(page.getByText("A SESSION IS STILL WAITING", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Ran out of time", exact: true }).click();
  const splitButton = page.getByRole("button", {
    name: "Recommended: Split into 10-min sessions",
    exact: true,
  });
  await expect(splitButton).toBeVisible();
  await splitButton.click();

  await expect(page.locator(".agenda-recovery-result")).toContainText(
    "Split applied. Part 1 and each remaining part now have a 10-minute window.",
  );
  await expect(page.getByRole("heading", { name: "Here is how YOVA plans to start." })).not.toBeVisible();
  await expect(page.getByRole("button", { name: "Start Part 1 (10 min)", exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => {
    const stored = window.localStorage.getItem("yova.preview.v1");
    if (!stored) return [];
    const snapshot = JSON.parse(stored) as {
      plans?: Array<{
        sessions?: Array<{
          title?: string;
          estimatedMinutes?: number;
          status?: string;
        }>;
      }>;
    };
    return (snapshot.plans?.at(-1)?.sessions ?? []).map((session) => ({
      title: session.title,
      minutes: session.estimatedMinutes,
      status: session.status,
    }));
  })).toEqual([
    expect.objectContaining({ title: expect.stringContaining("Part 1 of 2"), minutes: 10, status: "ready" }),
    expect.objectContaining({ title: expect.stringContaining("Part 2 of 2"), minutes: 10, status: "upcoming" }),
  ]);

  await page.getByRole("button", { name: "Start Part 1 (10 min)", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Here is how YOVA plans to start." })).toBeVisible();
  await expect(setupSummary).toContainText("about 10 minutes");
  await expect(setupSummary).not.toContainText("about 15 minutes");

  await page.route("**/api/sessions/generate", async (route) => {
    await route.fulfill({
      status: 502,
      contentType: "application/json",
      body: JSON.stringify({
        error: "Live generation did not produce a guided session that passed YOVA's learning checks.",
        retryable: false,
      }),
    });
  });
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Prepare this session" }).click();

  await expect(page.getByText(/safe built-in session was loaded instead/i)).toBeVisible();
  await expect(page.getByText("STEP 1 OF 3", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "YOVA already knows what this lesson should cover." })).not.toBeVisible();
});

test("an overdue arbitrary inside session splits and loads the generic 10-minute fallback", async ({ page }) => {
  await createPreviewAccount(page);
  await completeOnboarding(page);

  await page.getByRole("button", { name: "Study something now", exact: true }).first().click();
  await page.getByPlaceholder("Example: Help me understand the product rule and practice using it.").fill(
    "Review eigenvalues and eigenvectors for practice",
  );
  await page.getByRole("button", { name: "15 minutes", exact: true }).click();
  await page.getByRole("button", { name: "I understand the basics but need practice" }).click();
  await page.getByRole("button", { name: /Choose how YOVA should help/ }).click();
  await page.getByRole("button", { name: /Create it for me/ }).click();
  await page.getByRole("button", { name: /Build and start session/ }).click();

  const setupSummary = page.locator(".session-current-assumption");
  await expect(page.getByRole("heading", { name: "Here is how YOVA plans to start." })).toBeVisible();
  await expect(setupSummary).toContainText("about 15 minutes");
  await page.getByRole("button", { name: "Not now", exact: true }).click();

  await page.evaluate(() => {
    const stored = window.localStorage.getItem("yova.preview.v1");
    if (!stored) throw new Error("Expected the inside-YOVA Study Now plan in the preview snapshot.");
    const snapshot = JSON.parse(stored) as {
      plans?: Array<{ sessions?: Array<{
        scheduledFor?: string;
        status?: string;
        contentTargets?: string[];
        completionEvidence?: string[];
      }> }>;
      updatedAt?: string;
    };
    const ready = snapshot.plans?.at(-1)?.sessions?.find((session) => session.status === "ready");
    if (!ready) throw new Error("Expected a ready inside-YOVA session to make overdue.");
    ready.scheduledFor = new Date(Date.now() - 6 * 60 * 60 * 1_000).toISOString();
    // Acronym-only targets have no tokens in the curated-template heuristic.
    // The generic fallback must use its exact saved-target contract instead.
    ready.contentTargets = ["DNA and RNA"];
    ready.completionEvidence = ["Explain the saved relationship in your own words"];
    snapshot.updatedAt = new Date().toISOString();
    window.localStorage.setItem("yova.preview.v1", JSON.stringify(snapshot));
  });
  await page.reload();

  await page.getByRole("button", { name: "Agenda", exact: true }).click();
  await expect(page.getByText("A SESSION IS STILL WAITING", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Ran out of time", exact: true }).click();
  const splitButton = page.getByRole("button", {
    name: "Recommended: Split into 10-min sessions",
    exact: true,
  });
  await expect(splitButton).toBeVisible();
  await splitButton.click();

  await expect(page.locator(".agenda-recovery-result")).toContainText(
    "Split applied. Part 1 and each remaining part now have a 10-minute window.",
  );
  await expect(page.getByRole("button", { name: "Start Part 1 (10 min)", exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => {
    const stored = window.localStorage.getItem("yova.preview.v1");
    if (!stored) return [];
    const snapshot = JSON.parse(stored) as {
      plans?: Array<{ sessions?: Array<{ estimatedMinutes?: number; status?: string }> }>;
    };
    return (snapshot.plans?.at(-1)?.sessions ?? []).map((session) => ({
      minutes: session.estimatedMinutes,
      status: session.status,
    }));
  })).toEqual([
    expect.objectContaining({ minutes: 10, status: "ready" }),
    expect.objectContaining({ minutes: 10, status: "upcoming" }),
  ]);

  await page.getByRole("button", { name: "Start Part 1 (10 min)", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Here is how YOVA plans to start." })).toBeVisible();
  await expect(setupSummary).toContainText("about 10 minutes");
  await expect(setupSummary).not.toContainText("about 15 minutes");

  await page.route("**/api/sessions/generate", async (route) => {
    await route.fulfill({
      status: 502,
      contentType: "application/json",
      body: JSON.stringify({
        error: "Live generation did not produce a guided session that passed YOVA's learning checks.",
        retryable: false,
      }),
    });
  });
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Prepare this session" }).click();

  await expect(page.getByText(/safe built-in session was loaded instead/i)).toBeVisible();
  await expect(page.getByText("STEP 1 OF 3", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Use the session target as your comparison frame" })).toBeVisible();
  await expect(page.getByText("Objective check and application", { exact: true }).filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByLabel("How YOVA adapted this session")).toContainText(
    "This safe built-in workflow uses the target already saved in your plan.",
  );
  await expect(page.getByRole("heading", { name: "YOVA already knows what this lesson should cover." })).not.toBeVisible();

  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Somewhat sure" }).click();
  const learnerAttempt = "An eigenvector keeps its direction under a linear transformation, while its eigenvalue describes the scaling factor.";
  await page.getByLabel("Attempt from memory").fill(learnerAttempt);
  await page.getByRole("button", { name: "Check my answer" }).click();

  await expect(page.locator(".learner-attempt-card")).toContainText(learnerAttempt);
  await expect(page.getByText("COMPARISON CHECK", { exact: true })).toBeVisible();
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

test("a resumed streamed question can reopen its prior lesson by persisted activity index", async ({ page }) => {
  const lessonActivityIndexes: number[] = [];
  await page.route("**/api/sessions/generate", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(streamedResumeSessionResponse()),
    });
  });
  await page.route("**/api/sessions/lesson", async (route) => {
    const body = route.request().postDataJSON() as { activityIndex?: number };
    if (typeof body.activityIndex === "number") lessonActivityIndexes.push(body.activityIndex);
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: [
        'data: {"type":"lesson.meta","requestId":"30000000-0000-4000-8000-000000000001","model":"test-model"}',
        "",
        'data: {"type":"lesson.delta","delta":"# Restored streamed explanation\\n\\nRetrieval shows what you can produce before reviewing the answer."}',
        "",
        'data: {"type":"lesson.complete","elapsedMs":20,"latencyToFirstTokenMs":5,"inputTokens":20,"cachedInputTokens":0,"outputTokens":18,"wordCount":13,"model":"test-model"}',
        "",
        "",
      ].join("\n"),
    });
  });

  await createPreviewAccount(page);
  await completeOnboarding(page);
  await page.getByRole("button", { name: "Study something now", exact: true }).first().click();
  await page.getByPlaceholder("Example: Help me understand the product rule and practice using it.").fill(
    "Help me understand retrieval practice and test the idea.",
  );
  await page.getByRole("button", { name: "I haven't learned this yet" }).click();
  await page.getByRole("button", { name: /Choose how YOVA should help/ }).click();
  await page.getByRole("button", { name: /Create it for me/ }).click();
  await page.getByRole("button", { name: /Build and start session/ }).click();
  await confirmSessionSetup(page);

  await expect(page.getByText("Restored streamed explanation")).toBeVisible();
  await page.getByRole("button", { name: "Answer the question" }).click();
  await expect(page.getByRole("heading", { name: "Choose the retrieval sequence" })).toBeVisible();
  await leaveSession(page, "1 of 3 required steps finished");

  await page.getByRole("button", { name: "Continue session" }).click();
  await expect(page.getByRole("heading", { name: "Choose the retrieval sequence" })).toBeVisible();
  expect(lessonActivityIndexes).toEqual([0]);
  await page.getByRole("button", { name: "Review the lesson" }).click();

  await expect.poll(() => lessonActivityIndexes.length).toBe(2);
  expect(lessonActivityIndexes).toEqual([0, 0]);
  await expect(page.getByRole("dialog", { name: /Review the lesson, then return to the same question/i }))
    .toContainText("Restored streamed explanation");
});

test("a refresh recovers semantic progress without saving draft answers or inventing an interruption", async ({ page }) => {
  test.setTimeout(90_000);
  let generationRequests = 0;

  await page.route("**/api/sessions/generate", async (route) => {
    generationRequests += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(streamedResumeSessionResponse()),
    });
  });
  await page.route("**/api/sessions/lesson", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: [
        'data: {"type":"lesson.meta","requestId":"30000000-0000-4000-8000-000000000021","model":"test-model"}',
        "",
        'data: {"type":"lesson.delta","delta":"# Refresh-safe explanation\\n\\nRetrieval shows what you can produce before reviewing the answer."}',
        "",
        'data: {"type":"lesson.complete","elapsedMs":20,"latencyToFirstTokenMs":5,"inputTokens":20,"cachedInputTokens":0,"outputTokens":18,"wordCount":13,"model":"test-model"}',
        "",
        "",
      ].join("\n"),
    });
  });
  await page.route("**/api/sessions/evaluate", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        verdict: "secure",
        feedback: "Your explanation connects the unsupported attempt to finding the knowledge that still needs repair.",
        matchedIdeas: ["The attempt happens before review."],
        missingIdeas: [],
        mode: "preview",
      }),
    });
  });

  await createPreviewAccount(page);
  await completeOnboarding(page);
  await page.getByRole("button", { name: "Study something now", exact: true }).first().click();
  await page.getByPlaceholder("Example: Help me understand the product rule and practice using it.").fill(
    "Help me understand retrieval practice and test the idea.",
  );
  await page.getByRole("button", { name: "I haven't learned this yet" }).click();
  await page.getByRole("button", { name: /Choose how YOVA should help/ }).click();
  await page.getByRole("button", { name: /Create it for me/ }).click();
  await page.getByRole("button", { name: /Build and start session/ }).click();
  await confirmSessionSetup(page);

  await expect(page.getByText("Refresh-safe explanation")).toBeVisible();
  await page.getByRole("button", { name: "Answer the question" }).click();
  await expect(page.getByRole("heading", { name: "Choose the retrieval sequence" })).toBeVisible();
  await expect.poll(() => readRecoveryState(page)).toMatchObject({
    checkpointStatus: "working",
    completedSteps: 1,
    sessionInterruptions: 0,
    hasSessionResource: true,
  });

  await page.reload();
  await expect(page.getByText("Continue where you left off")).toBeVisible();
  await expect(page.getByText("1 section saved", { exact: true })).toBeVisible();
  expect(generationRequests).toBe(1);
  await expect.poll(() => readRecoveryState(page)).toMatchObject({ sessionInterruptions: 0 });
  await page.getByRole("button", { name: "Continue session" }).click();
  await expect(page.getByRole("heading", { name: "Choose the retrieval sequence" })).toBeVisible();
  await expect(page.getByText(/completed sections are saved; an unfinished answer was not stored/i)).toBeVisible();
  expect(generationRequests).toBe(1);

  const confidenceCheck = page.getByRole("group", { name: /One quick confidence check/ });
  if (await confidenceCheck.isVisible()) {
    await page.getByRole("button", { name: "Somewhat sure" }).click();
  }
  await page.getByRole("button", { name: "Attempt, then review" }).click();
  await expect(page.getByText("Correct.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Explain why retrieval comes first" })).toBeVisible();

  const freeResponseConfidence = page.getByRole("group", { name: /One quick confidence check/ });
  if (await freeResponseConfidence.isVisible()) {
    await page.getByRole("button", { name: "Somewhat sure" }).click();
  }
  const draftMarker = "PRIVATE-DRAFT-7c2d9e should never be persisted";
  const freeResponse = page.locator(".recall-response textarea");
  await freeResponse.fill(draftMarker);
  await expect.poll(async () => {
    const state = await readRecoveryState(page);
    return state.completedSteps;
  }).toBe(2);
  const localStorageBeforeReload = await page.evaluate(() => JSON.stringify(
    Object.fromEntries(Array.from({ length: window.localStorage.length }, (_, index) => {
      const key = window.localStorage.key(index) ?? "";
      return [key, window.localStorage.getItem(key)];
    })),
  ));
  expect(localStorageBeforeReload).not.toContain(draftMarker);

  await page.reload();
  await expect(page.getByText("Continue where you left off")).toBeVisible();
  await page.getByRole("button", { name: "Continue session" }).click();
  await expect(page.getByRole("heading", { name: "Explain why retrieval comes first" })).toBeVisible();
  await expect(page.locator(".recall-response textarea")).toHaveValue("");
  expect(generationRequests).toBe(1);
  await expect.poll(() => readRecoveryState(page)).toMatchObject({ sessionInterruptions: 0 });

  const restoredConfidence = page.getByRole("group", { name: /One quick confidence check/ });
  if (await restoredConfidence.isVisible()) {
    await page.getByRole("button", { name: "Somewhat sure" }).click();
  }
  await page.locator(".recall-response textarea").fill(
    "Trying first reveals which knowledge is available without visible support and what still needs repair.",
  );
  await page.getByRole("button", { name: "Check my answer" }).click();
  await expect(page.getByText("YOVA'S FORMATIVE CHECK")).toBeVisible();
  await page.getByRole("button", { name: "I got the key idea" }).click();
  await page.getByRole("button", { name: "Finish this content" }).click();
  await expect(page.getByRole("heading", { name: "Complete this learning item" })).toBeVisible();
  await expect.poll(() => readRecoveryState(page)).toMatchObject({
    checkpointStatus: "awaiting_finish",
    completedSteps: 3,
    sessionCompletions: 0,
    sessionInterruptions: 0,
  });

  await page.reload();
  await expect(page.getByText("Continue where you left off")).toBeVisible();
  await expect(page.getByText("Ready to finish", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Review and finish" }).click();
  await expect(page.getByRole("heading", { name: "Complete this learning item" })).toBeVisible();
  await expect(page.getByText(/completed session was recovered/i)).toBeVisible();
  expect(generationRequests).toBe(1);
  const finishingRunId = (await readRecoveryState(page)).lastCheckpointRunId;
  expect(finishingRunId).not.toBeNull();
  await page.getByRole("button", { name: "Finish and continue" }).click();
  await expect(page.getByRole("heading", { name: /Good (morning|afternoon|evening), Learner\./ })).toBeVisible();
  await expect.poll(() => readRecoveryState(page)).toMatchObject({
    checkpointStatus: null,
    sessionCompletions: 1,
    sessionInterruptions: 0,
  });
  const finishedRecoveryState = await readRecoveryState(page);
  expect(finishedRecoveryState.completionId).toBe(finishingRunId);

  await page.reload();
  await expect(page.getByText("Continue where you left off")).not.toBeVisible();
  await expect.poll(() => readRecoveryState(page)).toMatchObject({
    checkpointStatus: null,
    sessionCompletions: 1,
    sessionInterruptions: 0,
  });
  expect(generationRequests).toBe(1);
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
  const livePlanningIssue = page.locator(".generation-notice[role='alert']");
  await expect(livePlanningIssue).toContainText("Live AI planning failed");
  await expect(livePlanningIssue.getByRole("button", { name: "Retry live planning" })).toBeVisible();
  await expect(livePlanningIssue).not.toContainText("reliable planning engine");
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
  const capacityButtons = page.locator(".agenda-capacity-options button");
  await expect(capacityButtons).toHaveCount(5);
  await expect(page.locator(".agenda-capacity-options .duration-value")).toHaveCount(5);
  await expect(page.locator(".agenda-capacity-options .duration-unit")).toHaveCount(5);
  const capacityTypography = await page.locator(".agenda-capacity-planner").evaluate((planner) => {
    const buttons = [...planner.querySelectorAll<HTMLButtonElement>(".agenda-capacity-options button")];
    const values = [...planner.querySelectorAll<HTMLElement>(".duration-value")];
    const units = [...planner.querySelectorAll<HTMLElement>(".duration-unit")];
    const heading = planner.querySelector<HTMLElement>("h2");
    return {
      buttonHeights: buttons.map((button) => button.getBoundingClientRect().height),
      valueFamilies: values.map((value) => getComputedStyle(value).fontFamily),
      valueLineHeights: values.map((value) => Number.parseFloat(getComputedStyle(value).lineHeight)),
      valueTracking: values.map((value) => {
        const tracking = Number.parseFloat(getComputedStyle(value).letterSpacing);
        return Number.isFinite(tracking) ? tracking : 0;
      }),
      unitSizes: units.map((unit) => Number.parseFloat(getComputedStyle(unit).fontSize)),
      headingTracking: heading ? Math.abs(Number.parseFloat(getComputedStyle(heading).letterSpacing)) : Number.POSITIVE_INFINITY,
    };
  });
  expect(capacityTypography.buttonHeights.every((height) => height >= 44)).toBe(true);
  expect(capacityTypography.valueFamilies.every((family) => family.includes("Inter"))).toBe(true);
  expect(capacityTypography.valueLineHeights.every((height) => height >= 17 && height <= 19)).toBe(true);
  expect(capacityTypography.valueTracking.every((tracking) => Math.abs(tracking) < 0.01)).toBe(true);
  expect(capacityTypography.unitSizes.every((size) => size >= 12)).toBe(true);
  expect(capacityTypography.headingTracking).toBeLessThanOrEqual(0.5);
  await expectNoHorizontalOverflow(page, ".agenda-capacity-planner");
  await page.getByRole("button", { name: "I have 15 minutes today" }).click();
  await expect(page.locator(".agenda-capacity-result")).not.toHaveClass(/blocked/);
  await expect(page.locator(".agenda-capacity-result")).toContainText(/Today already fits|No change needed/);
  await expect(page.getByText(/planned sessions/).first()).toBeVisible();
});

test("archived, draft, and deleted-plan projections stay out of current-work surfaces", async ({ page }) => {
  await createPreviewAccount(page);
  await completeOnboarding(page);

  await page.evaluate(() => {
    const stored = window.localStorage.getItem("yova.preview.v1");
    if (!stored) throw new Error("Expected a preview snapshot after onboarding.");
    const snapshot = JSON.parse(stored) as Record<string, unknown>;
    const now = new Date();
    const scheduledFor = new Date(now.getTime() + 60 * 60 * 1_000).toISOString();
    const dueAt = new Date(now.getTime() + 2 * 60 * 60 * 1_000).toISOString();
    const createdAt = new Date(now.getTime() - 60 * 60 * 1_000).toISOString();
    const session = (id: string, title: string) => ({
      id,
      sequence: 1,
      title,
      objective: `Finish ${title}`,
      method: "Guided learning",
      methodReason: "Visibility regression fixture",
      scheduledFor,
      estimatedMinutes: 25,
      amountLabel: "One focused section",
      learningMode: "learn",
      status: "ready",
    });
    const plan = (id: string, learningItemId: string, title: string, status: "draft" | "active" | "archived") => ({
      id,
      learningItemId,
      title,
      topic: title,
      kind: "topic",
      deadline: dueAt,
      status,
      sourceMode: "yova_generated",
      studyMode: "inside_yova",
      learningIntent: "learn",
      rationale: "Visibility regression fixture",
      createdAt,
      sessions: [session(`${id}-session`, `${title} session`)],
    });

    snapshot.plans = [
      plan("active-plan", "active-item", "Visible active biology plan", "active"),
      plan("archived-plan", "archived-item", "Hidden archived calculus plan", "archived"),
      plan("draft-plan", "draft-item", "Hidden draft chemistry plan", "draft"),
    ];
    snapshot.deadlineMilestones = [
      { id: "active-deadline", title: "Visible biology deadline", description: "Active linked work", dueAt, status: "open", linkedLearningItemId: "active-item", createdAt },
      { id: "archived-deadline", title: "Hidden archived deadline", description: "Archived linked work", dueAt, status: "open", linkedLearningItemId: "archived-item", createdAt },
      { id: "draft-deadline", title: "Hidden draft deadline", description: "Draft linked work", dueAt, status: "open", linkedLearningItemId: "draft-item", createdAt },
      { id: "deleted-deadline", title: "Hidden deleted-plan deadline", description: "Orphaned linked work", dueAt, status: "open", linkedLearningItemId: "deleted-item", createdAt },
    ];
    snapshot.updatedAt = new Date().toISOString();
    window.localStorage.setItem("yova.preview.v1", JSON.stringify(snapshot));
  });
  await page.reload();

  await expect(page.getByText("Visible active biology plan").first()).toBeVisible();
  await expect(page.getByText("Hidden archived calculus plan")).toHaveCount(0);
  await expect(page.getByText("Hidden draft chemistry plan")).toHaveCount(0);

  await page.getByRole("button", { name: "Agenda", exact: true }).click();
  await expect(page.getByText("Visible active biology plan").first()).toBeVisible();
  await expect(page.getByText("Visible biology deadline").first()).toBeVisible();
  await expect(page.getByText("Hidden archived calculus plan")).toHaveCount(0);
  await expect(page.getByText("Hidden archived deadline")).toHaveCount(0);
  await expect(page.getByText("Hidden draft deadline")).toHaveCount(0);
  await expect(page.getByText("Hidden deleted-plan deadline")).toHaveCount(0);

  await page.getByRole("button", { name: "Ask YOVA", exact: true }).click();
  const contextOptions = page.getByRole("combobox", { name: "Ask YOVA context" }).locator("option");
  await expect(contextOptions.filter({ hasText: "Visible active biology plan" })).toHaveCount(1);
  await expect(contextOptions.filter({ hasText: "Hidden archived calculus plan" })).toHaveCount(0);
  await expect(contextOptions.filter({ hasText: "Hidden draft chemistry plan" })).toHaveCount(0);

  await page.getByRole("button", { name: "Learning", exact: true }).click();
  await page.getByRole("button", { name: /Archive/ }).click();
  await expect(page.getByText("Hidden archived calculus plan").first()).toBeVisible();

  await page.getByRole("button", { name: "Open goal" }).click();
  await expect(page.getByRole("heading", { name: "Hidden archived calculus plan" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Archived goal history" })).toContainText("0 of 1 sessions");
  await page.getByRole("button", { name: "Restore" }).click();
  await expect(page.getByRole("button", { name: /Active/ })).toHaveClass(/active/);
  await expect(page.getByText("Hidden archived calculus plan").first()).toBeVisible();

  await page.locator(".learning-goal-card").filter({ hasText: "Hidden archived calculus plan" }).getByRole("button", { name: "Open goal" }).click();
  await page.getByRole("button", { name: "Archive", exact: true }).click();
  await expect(page.locator(".tabs").getByRole("button", { name: /Archive/ })).toHaveClass(/active/);
  await page.getByRole("button", { name: "Open goal" }).click();
  await page.getByRole("button", { name: "Delete permanently" }).click();
  const deletionDialog = page.getByRole("dialog", { name: "Delete this archived goal?" });
  await expect(deletionDialog).toContainText("sessions, results, tutor conversation, linked deadlines, and attached materials");
  await deletionDialog.getByLabel("Type DELETE to confirm").fill("DELETE");
  await deletionDialog.getByRole("button", { name: "Permanently delete goal" }).click();
  await expect(page.getByText("Hidden archived calculus plan")).toHaveCount(0);
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

async function readPreviewPracticeState(
  page: Page,
  planId?: string,
  sessionId?: string,
) {
  return page.evaluate(({ requestedPlanId, requestedSessionId }) => {
    const stored = window.localStorage.getItem("yova.preview.v1");
    if (!stored) return null;

    const snapshot = JSON.parse(stored) as {
      plans?: Array<{
        id?: string;
        sessions?: Array<{
          id?: string;
          sequence?: number;
          status?: string;
          learningMode?: string;
          topicIds?: string[];
          contentTargets?: string[];
          completionEvidence?: string[];
          reviewType?: string;
        }>;
        knowledgeMap?: { topics?: Array<{ id?: string; status?: string }> };
      }>;
      sessionCompletions?: Array<{
        id?: string;
        planId?: string;
        planSessionId?: string;
        completionMode?: string;
        correctAnswers?: number;
        totalAnswers?: number;
        observedGap?: string;
        conceptEvidence?: unknown[];
        confidenceEvidence?: unknown[];
      }>;
    };
    const plan = requestedPlanId
      ? snapshot.plans?.find((candidate) => candidate.id === requestedPlanId)
      : snapshot.plans?.at(-1);
    const session = requestedSessionId
      ? plan?.sessions?.find((candidate) => candidate.id === requestedSessionId)
      : plan?.sessions?.find((candidate) => candidate.status === "ready") ?? plan?.sessions?.at(0);
    if (!plan?.id || !session?.id) return null;
    const completion = snapshot.sessionCompletions?.find((candidate) => (
      candidate.planId === plan.id
      && candidate.planSessionId === session.id
    )) ?? null;
    const verificationSession = plan.sessions?.find((candidate) => (
      candidate.sequence === (session.sequence ?? 0) + 1
      && candidate.reviewType === "verify"
    )) ?? null;
    const topicStatuses = (plan.knowledgeMap?.topics ?? []).map((topic) => ({
      id: topic.id ?? null,
      status: topic.status ?? null,
    }));

    return {
      planId: plan.id,
      sessionId: session.id,
      sessionSequence: session.sequence ?? 0,
      sessionStatus: session.status ?? null,
      sessionTopicIds: session.topicIds ?? [],
      sessionContentTargets: session.contentTargets ?? [],
      sessionCompletionEvidence: session.completionEvidence ?? [],
      topicStatuses,
      topicStatusesSerialized: JSON.stringify(topicStatuses),
      verificationSession,
      completion,
    };
  }, {
    requestedPlanId: planId,
    requestedSessionId: sessionId,
  });
}

async function readRecoveryState(page: Page) {
  return page.evaluate(() => {
    let checkpoints: Array<{ runId?: string; status?: string; completedSteps?: number }> = [];
    let snapshot: {
      plans?: Array<{ sessions?: Array<{ resource?: unknown }> }>;
      sessionCompletions?: Array<{ id?: string }>;
      sessionInterruptions?: unknown[];
    } = {};

    try {
      const rawCheckpoints = window.localStorage.getItem("yova.active-session-checkpoints.v1");
      const parsedCheckpoints: unknown = rawCheckpoints ? JSON.parse(rawCheckpoints) : [];
      checkpoints = Array.isArray(parsedCheckpoints)
        ? parsedCheckpoints as Array<{ runId?: string; status?: string; completedSteps?: number }>
        : [];
    } catch {
      checkpoints = [];
    }

    try {
      const rawSnapshot = window.localStorage.getItem("yova.preview.v1");
      const parsedSnapshot: unknown = rawSnapshot ? JSON.parse(rawSnapshot) : {};
      snapshot = parsedSnapshot && typeof parsedSnapshot === "object"
        ? parsedSnapshot as typeof snapshot
        : {};
    } catch {
      snapshot = {};
    }

    const checkpoint = checkpoints.at(-1);
    return {
      checkpointStatus: checkpoint?.status ?? null,
      completedSteps: checkpoint?.completedSteps ?? null,
      lastCheckpointRunId: checkpoint?.runId ?? null,
      sessionCompletions: snapshot.sessionCompletions?.length ?? 0,
      completionId: snapshot.sessionCompletions?.at(-1)?.id ?? null,
      sessionInterruptions: snapshot.sessionInterruptions?.length ?? 0,
      hasSessionResource: Boolean(snapshot.plans?.[0]?.sessions?.[0]?.resource),
    };
  });
}

async function completeOnboarding(page: Page) {
  await page.getByRole("button", { name: /Personalize YOVA/ }).click();

  for (const [index, answer] of onboardingAnswers.entries()) {
    await page.getByRole("button", { name: answer, exact: true }).click();
    const nextLabel = index === onboardingAnswers.length - 1 ? "Build my setup" : "Continue";
    await page.getByRole("button", { name: nextLabel }).click();
  }

  await expect(page.getByRole("heading", { name: "YOVA will begin like this." })).toBeVisible();
  await page.getByRole("button", { name: "Open YOVA" }).click();
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

async function createOneOffLearningSession(
  page: Page,
  request: string,
  learningMode: "learn" | "study" = "learn",
) {
  await page.locator(".quick-actions button").filter({ hasText: "Study something now" }).click();
  await page.getByPlaceholder("Example: Help me understand the product rule and practice using it.").fill(request);
  await page.getByRole("button", {
    name: learningMode === "learn"
      ? "I haven't learned this yet"
      : "I understand the basics but need practice",
  }).click();
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

function streamedResumeSessionResponse() {
  const topicId = "30000000-0000-4000-8000-000000000010";
  return {
    planSessionId: "30000000-0000-4000-8000-000000000011",
    session: {
      topicIds: [topicId],
      schemaVersion: 17,
      model: "test-model",
      generatedAt: "2026-08-11T18:00:00.000Z",
      cacheContext: {
        effectiveMinutes: 25,
        adjustmentFingerprint: "a".repeat(64),
      },
      routingContext: {
        taskType: "conceptual_learning",
        knowledgeStage: "novice",
      },
      rationale: "Teach one bounded retrieval model before checking whether the learner can identify and explain it.",
      coverage: {
        focus: "Understand why retrieval happens before answer review.",
        essentialIdeas: ["Retrieval happens before answer review"],
        completionEvidence: ["Identify and explain why an answer is attempted before review"],
        evidenceMap: [{
          essentialIdea: "Retrieval happens before answer review",
          activityConcept: "Retrieval practice",
        }],
        deferredContent: [],
      },
      methodBriefing: {
        learningMode: "learn",
        taskType: "conceptual_learning",
        methodId: "retrieval_practice",
        name: "Retrieval practice",
        what: "Produce an answer from memory before looking at the explanation.",
        why: "This makes current knowledge visible before the learner reviews and repairs the answer.",
        how: [
          "Read the bounded model before the first check.",
          "Attempt the answer from memory, then repair the exposed gap.",
        ],
        completion: "The learner identifies the sequence and explains why retrieval comes first.",
        personalization: ["The learner asked for a clear example before the independent explanation."],
      },
      sourceGrounding: null,
      deliveryPolicy: {
        schemaVersion: 1,
        evidenceStatus: "starting_hypothesis",
        presentation: {
          mode: "example_first",
          label: "Example first",
          instruction: "Begin with one concrete case before naming the general rule.",
        },
        repair: {
          mode: "hint_first",
          label: "Hint first",
          instruction: "After a miss, reveal one bounded cue before the complete correction.",
        },
        retention: {
          mode: "retrieval",
          label: "Recall without cues",
          instruction: "Require retrieval without visible notes before answer review.",
        },
        workspace: {
          mode: "one_step",
          label: "One step at a time",
          instruction: "Keep only the current action prominent while preserving the path preview.",
        },
        pacing: {
          firstActionMinutes: 4,
          maximumActivities: 5,
          reason: "Use a bounded first explanation and preserve the required checks.",
        },
        learnerFacingReasons: ["The learner asked for a concrete example before the rule."],
        signalsUsed: ["A concrete example before the rule"],
      },
      deliveryInstructions: {
        schemaVersion: 1,
        explanationDensity: "balanced",
        tone: "encouraging",
        analogyUse: "only_when_helpful",
        workedExamples: "lead_with_example",
        structure: "task_aligned",
        pacing: {
          firstActionMinutes: 4,
          maximumActivities: 5,
          instruction: "Keep the first step bounded while preserving every essential idea.",
        },
        learnerContext: ["Use current evidence as a guide rather than a fixed learning style."],
        contentRequirements: {
          coverAllEssentialIdeas: true,
          includeConcreteWorkedExample: true,
          includeCommonMixup: true,
          preservePrerequisiteOrder: true,
        },
      },
      activities: [
        {
          topicId,
          methodPhase: "model",
          estimatedMinutes: 4,
          requiredForCompletion: true,
          type: "instruction",
          concept: null,
          label: "Learn",
          title: "Build the retrieval model",
          body: "Read the streamed explanation before answering the first question.",
          teaching: null,
          lessonBrief: {
            version: 1,
            topicIds: [topicId],
            essentialIdeas: ["Retrieval happens before answer review"],
            sourceChunks: [],
            knowledgeSource: "model_knowledge",
            evidenceContext: {
              confirmedGaps: [],
              secureKnowledge: [],
              priorMisconceptions: [],
            },
            contentRequirements: {
              teachEveryEssentialIdea: true,
              includeConcreteExample: true,
              includeCommonMixup: true,
              preservePrerequisiteOrder: true,
            },
          },
          practiceIntent: null,
          misconceptionSummary: null,
          choices: [],
          correctAnswer: null,
          feedback: null,
        },
        {
          topicId,
          methodPhase: "retrieve",
          estimatedMinutes: 3,
          requiredForCompletion: true,
          type: "multiple_choice",
          concept: "Retrieval practice",
          label: "Check",
          title: "Choose the retrieval sequence",
          body: "Which sequence makes unsupported knowledge visible before review?",
          teaching: null,
          lessonBrief: null,
          practiceIntent: "misconception_discrimination",
          misconceptionSummary: "Confuses retrieval with rereading already visible wording.",
          choices: ["Attempt, then review", "Review, then copy", "Only reread"],
          correctAnswer: "Attempt, then review",
          feedback: "Retrieval requires producing an answer before looking at the explanation.",
        },
        {
          topicId,
          methodPhase: "repair",
          estimatedMinutes: 3,
          requiredForCompletion: true,
          type: "free_response",
          concept: "Retrieval practice",
          label: "Explain",
          title: "Explain why retrieval comes first",
          body: "Explain why attempting an answer before review reveals a useful learning gap.",
          teaching: null,
          lessonBrief: null,
          practiceIntent: null,
          misconceptionSummary: null,
          choices: [],
          correctAnswer: "Trying first reveals which knowledge is available without visible support.",
          feedback: "A strong answer connects the unsupported attempt to finding what needs repair.",
        },
      ],
    },
    generation: {
      mode: "openai",
      persistence: "browser",
    },
  };
}
