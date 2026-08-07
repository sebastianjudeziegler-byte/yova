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
  "None",
  "Nothing else for now",
] as const;

test("a confident misconception is repaired now and verified later", async ({ page }) => {
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
  await expect(page.getByText(/not saved as proof of mastery/i)).toBeVisible();
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
  await expect(page.getByText("Cellular respiration sequence", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Add a short delayed check" })).toBeVisible();
  await expect(page.getByText("Nothing changes until you approve it.")).toBeVisible();
  await page.getByRole("button", { name: "Update my plan" }).click();

  await expect(page.getByRole("heading", { name: /Repair and verify Cellular respiration sequence/i })).toBeVisible();
  await expect(page.getByText("Misconception repair and delayed transfer", { exact: true })).toBeVisible();
  await expect(page.getByText("Adjusted using your last session")).toBeVisible();

  await page.reload();
  await expect(page.getByRole("heading", { name: /Repair and verify Cellular respiration sequence/i })).toBeVisible();
  await expect(page.getByText("1 of 2 sessions complete")).toBeVisible();
  await expect(page.getByText("Adjusted using your last session")).toBeVisible();

  await page.route("**/api/sessions/generate", async (route) => {
    const request = route.request().postDataJSON() as { planSessionId: string };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(quickScheduledReviewResponse(request.planSessionId)),
    });
  });
  await page.getByRole("button", { name: "Start session", exact: true }).click();
  await expect(page.getByRole("dialog", { name: /Start Repair and verify Cellular respiration sequence now/i })).toBeVisible();
  await page.getByRole("button", { name: "Start now, keep dates" }).click();
  await expect(page.getByRole("heading", { name: "Which stage begins cellular respiration?" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Here is how YOVA plans to start." })).not.toBeVisible();
  await expect(page.locator(".quick-review-promise")).toContainText("Why this is appearing now");
  await expect(page.locator(".quick-review-promise")).toContainText("Each question includes all the context you need");
  await expect(page.locator(".quick-review-promise")).toContainText("Nothing is graded");
  await expect(page.locator(".answer-grid button")).toHaveCount(4);
  await expect(page.getByRole("group", { name: /One quick confidence check/ })).not.toBeVisible();
  await openMobileSessionGuide(page);
  await expect(page.locator(".session-method-playbook:visible")).toHaveAttribute("aria-label", "How to use Retrieval practice");
  await leaveSession(page, "0 of 3 required steps finished");
  await page.unroute("**/api/sessions/generate");

  await page.getByRole("button", { name: "Agenda", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Retrieval queue" })).toBeVisible();
  await expect(page.getByText("Cellular respiration sequence", { exact: true })).toBeVisible();
  await expect(page.getByText(/Return tomorrow|Return in 2 days|Due for retrieval/)).toBeVisible();

  await page.getByRole("button", { name: "Learning", exact: true }).click();
  await expect(page.getByRole("heading", { name: "What you’re working toward" })).toBeVisible();
  await expect(page.getByText("Active goals")).toBeVisible();
  await page.getByRole("button", { name: /Open goal/ }).click();
  await expect(page.getByRole("heading", { name: "Concept review schedule" })).toBeVisible();
  await expect(page.getByText("Cellular respiration sequence", { exact: true })).toBeVisible();
  await expect(page.getByText(/Return tomorrow|Return in 2 days|Due for retrieval/)).toBeVisible();
  await expect(page.getByText(/not predictions that a concept is permanently mastered/i)).toBeVisible();
});

test("a new topic is taught before YOVA asks for independent performance", async ({ page }) => {
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

  await expect(page.getByRole("heading", { name: "Use money concepts as decision tools" })).toBeVisible();
  await openMobileSessionGuide(page);
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
  await expect(page.getByText("INTERACTIVE MODEL", { exact: true })).not.toBeVisible();
  await expect(page.getByRole("group", { name: /One quick confidence check/ })).not.toBeVisible();
  await page.getByRole("button", { name: "Next: Explore the model" }).click();
  await expect(page.getByText("INTERACTIVE MODEL", { exact: true })).toBeVisible();
  await expect(page.getByLabel(/Interactive model:/)).toBeVisible();
  await expect(page.getByRole("tablist", { name: "Model parts" }).getByRole("tab")).toHaveCount(3);
  await page.getByRole("button", { name: "Next part" }).click();
  await expect(page.getByLabel(/Interactive model:/)).toContainText("2 of 3");
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByRole("heading", { name: "Trace one financial choice" })).toBeVisible();
  await expect(page.getByText(/If \$100 earns 10%/).first()).toBeVisible();
  await expect(page.getByRole("group", { name: /One quick confidence check/ })).not.toBeVisible();
  await page.getByRole("button", { name: "Next: Explore the model" }).click();
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByRole("heading", { name: "What makes the second year compound growth?" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Review the model" })).toBeVisible();
  await page.getByRole("button", { name: "Review the model" }).click();
  await expect(page.getByRole("dialog", { name: /Review the model, then return to the same question/i })).toBeVisible();
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
  await expect(page.getByText("REFERENCE ANSWER")).toBeVisible();
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

  await expect(page.getByRole("heading", { name: "Recall the product-rule structure" })).toBeVisible();
  await expect(page.getByText(/product rule adds two terms/i)).not.toBeVisible();
  await expect(page.getByText("See the structure before trying it alone", { exact: true })).not.toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Which expression correctly applies the product rule?" })).toBeVisible();
  await expect(page.locator(".answer-grid .katex")).toHaveCount(4);
  await expect(page.locator(".session-workspace")).not.toContainText("$f'g + fg'$");
  const workspaceWidth = await page.locator(".session-workspace").evaluate((element) => ({
    client: element.clientWidth,
    scroll: element.scrollWidth,
  }));
  expect(workspaceWidth.scroll).toBeLessThanOrEqual(workspaceWidth.client + 1);

  await page.getByRole("button", { name: "Somewhat sure" }).click();
  await page.locator(".answer-grid button").first().click();
  await expect(page.getByText("Correct.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByRole("heading", { name: /derivative of/ })).toBeVisible();
  await page.locator(".answer-grid button").first().click();
  await expect(page.getByText("Correct.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByRole("heading", { name: /Differentiate/ })).toBeVisible();
  await expect(page.getByLabel("Show your reasoning")).toBeVisible();
  await page.getByLabel("Reasoning step 1").fill("Use the product rule with x^3 as the first factor and e^x as the second.");
  await page.getByLabel("Reasoning step 2").fill("Differentiate each factor once: 3x^2e^x + x^3e^x.");
  await page.getByLabel("Final answer").fill("3x^2e^x + x^3e^x");
  await page.getByRole("button", { name: "Check my work" }).dispatchEvent("click");
  await expect(page.getByText("YOVA'S FORMATIVE CHECK")).toBeVisible();
  await expect(page.getByText("The key idea is present.")).toBeVisible();
  const workpadWidth = await page.getByLabel("Show your reasoning").evaluate((element) => ({
    client: element.clientWidth,
    scroll: element.scrollWidth,
  }));
  expect(workpadWidth.scroll).toBeLessThanOrEqual(workpadWidth.client + 1);
});

test("a failed unknown-topic lesson stops instead of showing generic learning-method filler", async ({ page }) => {
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

  await expect(page.getByRole("heading", { name: "This lesson needs another pass." })).toBeVisible();
  await expect(page.getByText(/Your progress is unchanged/i)).toBeVisible();
  await expect(page.getByText("See the structure before trying it alone", { exact: true })).not.toBeVisible();
  await expect(page.getByRole("heading", { name: "What should happen after an initial explanation?" })).not.toBeVisible();
  await page.getByRole("button", { name: "Add context and retry" }).click();
  await expect(page.getByRole("heading", { name: "Here is how YOVA plans to start." })).toBeVisible();
  await expect(page.getByText(/Build a clear first mental model of Help me understand eigenvalues and eigenvectors from scratch/)).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  const recoveryContext = page.getByLabel("Anything YOVA should account for?");
  await expect(recoveryContext).toBeVisible();
  await recoveryContext.fill("Focus on what eigenvectors represent geometrically before calculating them.");
  await expect(page.getByRole("button", { name: "Prepare this session" })).toBeEnabled();
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
  await expect(page.getByRole("heading", { name: "A realistic learning week" })).toBeVisible();
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
  await page.getByRole("button", { name: /Create a plan For a test/ }).click();
  await expect(page.getByRole("heading", { name: "What do you need to learn or prepare for?" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();

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

test("a multi-session plan uses one clear source decision from setup to Learning", async ({ page }) => {
  await createPreviewAccount(page);
  await completeOnboarding(page);

  await page.getByRole("button", { name: /Create a plan For a test/ }).click();
  await page.getByPlaceholder("Example: I have a biology test next Friday on photosynthesis and cellular respiration.").fill(
    "I have a biology test next Friday on cellular respiration.",
  );
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByRole("heading", { name: "Where should the learning come from?" })).toBeVisible();
  await expect(page.getByText("YOUR GOAL")).toBeVisible();
  await page.getByRole("button", { name: /Create it for me/ }).click();
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByRole("heading", { name: "When can you realistically study?" })).toBeVisible();
  const enabledMinuteSelectors = page.locator("select[aria-label$='available minutes']:not([disabled])");
  for (let index = 0; index < await enabledMinuteSelectors.count(); index += 1) {
    await enabledMinuteSelectors.nth(index).selectOption("45");
  }
  await page.getByRole("button", { name: "Continue" }).click();

  await page.getByRole("button", { name: "Produce ATP" }).click();
  await page.getByRole("button", { name: "Next question" }).click();
  await page.getByRole("button", { name: "Cytoplasm" }).click();
  await page.getByRole("button", { name: "Next question" }).click();
  await page.getByRole("button", { name: "Somewhat confident" }).click();
  await page.getByRole("button", { name: "Review information" }).click();

  await expect(page.getByRole("heading", { name: "Everything YOVA will use" })).toBeVisible();
  await expect(page.getByText("Guided inside YOVA with YOVA-created teaching and practice")).toBeVisible();
  await page.getByRole("button", { name: "Generate my plan" }).click();

  await expect(page.getByText("Plan ready")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Does this plan match what you need?" })).toBeVisible();
  await expect(page.getByText("Nothing is active until you confirm it below.")).toBeVisible();
  await page.getByRole("button", { name: "Change schedule" }).click();
  await expect(page.getByRole("heading", { name: "When can you realistically study?" })).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Review information" }).click();
  await page.getByRole("button", { name: "Generate my plan" }).click();
  await expect(page.getByText("Plan ready")).toBeVisible();
  await page.getByRole("button", { name: "Use this plan" }).click();
  await expect(page.getByRole("heading", { name: "Your plan" })).toBeVisible();
  await expect(page.getByText("Created by YOVA", { exact: true })).toBeVisible();

  const initialSessionCount = await page.locator(".timeline-row").count();
  expect(initialSessionCount).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Adjust", exact: true }).click();
  await expect(page.getByText(/Shorter windows can create more sessions/)).toBeVisible();
  await page.getByRole("combobox", { name: /Future session window/ }).selectOption("15");
  await page.getByRole("button", { name: "Rebuild unfinished plan" }).click();

  await expect.poll(async () => page.locator(".timeline-row").count()).toBeGreaterThan(initialSessionCount);
  const adjustedDurations = await page.locator(".timeline-row > span:last-child").allTextContents();
  expect(adjustedDurations.length).toBeGreaterThan(initialSessionCount);
  expect(adjustedDurations.every((duration) => Number.parseInt(duration, 10) <= 15)).toBe(true);
  await expect(page.getByText(/sessions complete/).first()).toBeVisible();

  await page.getByRole("button", { name: "Ask YOVA", exact: true }).click();
  const tutorContext = page.getByRole("combobox", { name: "Ask YOVA context" });
  await expect(tutorContext).toHaveValue("general");
  await tutorContext.selectOption({ label: "AP Biology Unit 3" });
  await expect(page.getByText("Using learning context")).toBeVisible();
  await expect(page.getByText("YOVA can use this goal's materials, next session, and learner evidence.")).toBeVisible();
  await page.getByRole("button", { name: "Learning", exact: true }).click();
  await page.getByRole("button", { name: "Ask YOVA", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Ask YOVA context" })).toHaveValue("general");

  await page.getByRole("button", { name: "Agenda", exact: true }).click();
  const moveOverdue = page.getByRole("button", { name: "Move to tomorrow" });
  if (await moveOverdue.isVisible()) await moveOverdue.click();
  await expect(page.getByRole("heading", { name: "A realistic learning week" })).toBeVisible();
  await expect(page.getByText("What YOVA is planning around")).toBeVisible();
  await page.getByRole("button", { name: "I have 15 minutes today" }).click();
  await expect(page.locator(".agenda-capacity-result")).not.toHaveClass(/blocked/);
  await expect(page.locator(".agenda-capacity-result")).toContainText(/TODAY ALREADY FITS|NO CHANGE NEEDED/);
  const nextAgendaSession = page.locator(".agenda-day article.ready").first();
  await expect(nextAgendaSession).toBeVisible();
  await nextAgendaSession.getByRole("button", { name: "Start", exact: true }).click();
  const earlyStartDialog = page.getByRole("dialog", { name: /Start .* now\?/ });
  if (await earlyStartDialog.isVisible()) {
    await expect(page.getByText("Recommended: pull the agenda forward")).toBeVisible();
    await page.getByRole("button", { name: "Start and adjust agenda" }).click();
  }
  await expect(page.getByRole("heading", { name: "Here is how YOVA plans to start." })).toBeVisible();
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
  await expect(page.getByRole("button", { name: /Add an article or YouTube video/ })).toBeVisible();
  await page.getByRole("button", { name: /Add an article or YouTube video/ }).click();
  await expect(page.getByRole("region", { name: "Add material from a link" })).toContainText("Public article");
  await expect(page.getByRole("region", { name: "Add material from a link" })).toContainText("YouTube transcript");
  await expect(page.getByText(/does not bypass paywalls or sign-ins/i)).toBeVisible();
});

async function openMobileSessionGuide(page: Page) {
  const mobileGuide = page.locator(".session-guide-mobile");
  if (await mobileGuide.isVisible()) await mobileGuide.locator(":scope > summary").click();
}

async function expectNoHorizontalOverflow(page: Page, selector: string) {
  const width = await page.locator(selector).first().evaluate((element) => ({
    client: element.clientWidth,
    scroll: element.scrollWidth,
  }));
  expect(width.scroll).toBeLessThanOrEqual(width.client + 1);
}

async function createPreviewAccount(page: Page) {
  await page.goto("/");
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

function quickScheduledReviewResponse(planSessionId: string) {
  const concept = "Cellular respiration sequence";
  const questions = [
    {
      methodPhase: "retrieve",
      title: "Which stage begins cellular respiration?",
      body: "Choose from memory before using the feedback to check the sequence.",
      choices: ["Glycolysis", "Krebs cycle", "Electron transport chain", "Fermentation"],
      correctAnswer: "Glycolysis",
      feedback: "Glycolysis begins cellular respiration before the Krebs cycle and electron transport chain.",
    },
    {
      methodPhase: "discriminate",
      title: "Which order matches the main aerobic pathway?",
      body: "Distinguish the complete sequence from the tempting reversed alternatives.",
      choices: [
        "Glycolysis, Krebs cycle, electron transport chain",
        "Krebs cycle, glycolysis, electron transport chain",
        "Electron transport chain, Krebs cycle, glycolysis",
        "Fermentation, glycolysis, Krebs cycle",
      ],
      correctAnswer: "Glycolysis, Krebs cycle, electron transport chain",
      feedback: "The main sequence moves from glycolysis to the Krebs cycle and then the electron transport chain.",
    },
    {
      methodPhase: "transfer",
      title: "A pathway is blocked before the Krebs cycle. Which stage can still occur first?",
      body: "Apply the sequence to a slightly different situation without reopening the lesson.",
      choices: ["Glycolysis", "Electron transport chain", "Krebs cycle", "ATP synthase only"],
      correctAnswer: "Glycolysis",
      feedback: "Glycolysis occurs before the Krebs cycle, so it is the stage that can begin first in this sequence.",
    },
  ];

  return {
    planSessionId,
    session: {
      schemaVersion: 13,
      model: "e2e-scheduled-review",
      generatedAt: new Date().toISOString(),
      rationale: "A short delayed retrieval gives YOVA evidence without turning the return into another full lesson.",
      coverage: {
        focus: "Retrieve and distinguish the cellular respiration sequence after a delay.",
        essentialIdeas: [concept],
        completionEvidence: ["Answer all three multiple-choice questions before reviewing the result."],
        evidenceMap: [{ essentialIdea: concept, activityConcept: concept }],
        deferredContent: [],
      },
      methodBriefing: {
        learningMode: "study",
        taskType: "conceptual_learning",
        methodId: "retrieval_practice",
        name: "Retrieval practice",
        what: "Produce an answer from memory before looking at corrective feedback.",
        why: "A short delayed attempt checks whether the repaired sequence remains available after time has passed.",
        how: [
          "Answer one multiple-choice question from memory.",
          "Use the feedback to repair only what was missing.",
          "Continue to a differently worded check.",
        ],
        completion: "All three scheduled questions have been answered once.",
        personalization: ["YOVA reduced this return to three low-pressure choices so it stays easy to begin."],
      },
      sourceGrounding: null,
      supportPlan: {
        level: "independent_start",
        title: "Quick retrieval check",
        explanation: "Answer before feedback, then use the result to decide whether this idea needs another return.",
        evidenceLabel: "This is a lightweight return signal, not proof of permanent mastery.",
        concept,
      },
      deliveryPolicy: {
        schemaVersion: 1,
        evidenceStatus: "observed_pattern",
        presentation: {
          mode: "task_aligned",
          label: "Answer first",
          instruction: "Show the question before any explanation or corrective feedback.",
        },
        repair: {
          mode: "direct_correction",
          label: "Concise correction",
          instruction: "Name the corrected relationship directly after a missed answer.",
        },
        retention: {
          mode: "retrieval",
          label: "Quick retrieval",
          instruction: "Ask for an answer before feedback, then use a fresh question to check the idea.",
        },
        workspace: {
          mode: "one_step",
          label: "One question at a time",
          instruction: "Keep the review calm, direct, and easy to resume by showing one question at a time.",
        },
        pacing: {
          firstActionMinutes: 1,
          maximumActivities: 3,
          reason: "Scheduled retrieval should be a small return to prior content, not another full study session.",
        },
        learnerFacingReasons: ["This scheduled return uses three choices so the learner can begin with very little friction."],
        signalsUsed: ["previous missed answer"],
      },
      activities: questions.map((question, index) => ({
        ...question,
        concept,
        estimatedMinutes: index === 0 ? 1 : 2,
        requiredForCompletion: true,
        label: `Quick check ${index + 1}`,
        teaching: null,
        type: "multiple_choice",
      })),
    },
    generation: { mode: "openai", persistence: "browser" },
  };
}
