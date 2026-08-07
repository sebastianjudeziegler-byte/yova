import { expect, test, type Page } from "@playwright/test";

const onboardingAnswers = [
  "I struggle to start",
  "Give me clear structure with flexibility",
  "20–30 minutes",
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

  await expect(page.getByRole("heading", { name: "Closed-note retrieval" })).toBeVisible();
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
  await leaveSession(page, "2 of 6 required steps finished");
  await expect(page.getByText("Continue where you left off")).toBeVisible();
  await page.getByRole("button", { name: "Continue session" }).click();
  await expect(page.getByText("Repair now, verify later")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Explain Cellular respiration sequence again in your own words" })).toBeVisible();
  await expect(page.getByText(/not saved as proof of mastery/i)).not.toBeVisible();
  await page.getByLabel("Corrected idea in your own words").fill(
    "Glycolysis happens first, followed by the Krebs cycle and electron transport chain.",
  );
  await page.getByRole("button", { name: "Check my answer" }).click();
  await expect(page.getByText("YOVA'S FORMATIVE CHECK")).toBeVisible();
  await expect(page.getByText("The key idea is present.")).toBeVisible();
  await page.getByRole("button", { name: "I got the key idea" }).click();
  await expect(page.getByText(/not saved as proof of mastery/i)).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();

  await page.getByRole("button", { name: "Somewhat sure" }).click();
  await page.getByRole("button", { name: "Cytoplasm" }).click();
  await page.getByRole("button", { name: "Continue" }).click();

  await page.getByRole("button", { name: "Somewhat sure" }).click();
  await page.getByLabel("Attempt from memory").fill(
    "Glycolysis occurs in the cytoplasm and does not directly require oxygen.",
  );
  await page.getByRole("button", { name: "Check my answer" }).click();
  await page.getByRole("button", { name: "I got the key idea" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Finish this content" }).click();

  await expect(page.getByText("2 of 3")).toBeVisible();
  await expect(page.getByText("Evidence checks")).toBeVisible();
  await expect(page.getByText("Recorded, not graded")).toBeVisible();
  await expect(page.getByText("1 immediate repair completed")).toBeVisible();
  await expect(page.getByText("Cellular respiration sequence", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "A delayed verification check" })).toBeVisible();
  await page.getByRole("button", { name: "Save and see what’s next" }).click();

  await expect(page.getByRole("heading", { name: /Repair and verify Cellular respiration sequence/i })).toBeVisible();
  await expect(page.getByText("Misconception repair and delayed transfer", { exact: true })).toBeVisible();
  await expect(page.getByText("Adjusted using your last session")).toBeVisible();

  await page.reload();
  await expect(page.getByRole("heading", { name: /Repair and verify Cellular respiration sequence/i })).toBeVisible();
  await expect(page.getByText("1 of 2 sessions complete")).toBeVisible();
  await expect(page.getByText("Adjusted using your last session")).toBeVisible();

  await page.getByRole("button", { name: "Agenda", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Retrieval queue" })).toBeVisible();
  await expect(page.getByText("Cellular respiration sequence", { exact: true })).toBeVisible();
  await expect(page.getByText(/Return tomorrow|Due for retrieval/)).toBeVisible();

  await page.getByRole("button", { name: "Learning", exact: true }).click();
  await expect(page.getByRole("heading", { name: "What you’re working toward" })).toBeVisible();
  await expect(page.getByText("Active goals")).toBeVisible();
  await page.getByRole("button", { name: /Open goal/ }).click();
  await expect(page.getByRole("heading", { name: "Concept review schedule" })).toBeVisible();
  await expect(page.getByText("Cellular respiration sequence", { exact: true })).toBeVisible();
  await expect(page.getByText(/Return tomorrow|Due for retrieval/)).toBeVisible();
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

  await expect(page.getByRole("heading", { name: "Use money concepts as decision tools" })).toBeVisible();
  await expect(page.getByLabel("Support progression").first()).toContainText("Support fades inside this session");
  const teachingRoadmap = page.getByLabel("Session method sequence").first();
  await expect(teachingRoadmap).toContainText("See a complete model");
  await expect(teachingRoadmap).toContainText("Practice with less help");
  await expect(teachingRoadmap).toContainText("Perform independently");
  await expect(teachingRoadmap).toContainText("Apply it in a new context");
  await expect(page.getByLabel("Method phase 1 of 4")).toContainText("See a complete model");
  await expect(page.getByText(/A budget directs limited income/)).toBeVisible();
  await expect(page.getByRole("group", { name: /Before answering/ })).not.toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByRole("heading", { name: "Trace one financial choice" })).toBeVisible();
  await expect(page.getByText(/If \$100 earns 10%/)).toBeVisible();
  await expect(page.getByRole("group", { name: /Before answering/ })).not.toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByRole("heading", { name: "What makes the second year compound growth?" })).toBeVisible();
  await expect(page.getByRole("group", { name: /Before answering/ })).not.toBeVisible();
  await page.getByRole("button", { name: "The earlier gain remains in the base" }).click();
  await expect(page.getByText("Correct.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByRole("heading", { name: "Explain compound growth in your own words" })).toBeVisible();
  await expect(page.getByLabel("Method phase 3 of 4")).toContainText("Perform independently");
  await expect(page.getByRole("group", { name: /Before answering/ })).toBeVisible();
  await page.getByRole("button", { name: "Somewhat sure" }).click();
  await page.getByLabel("Perform independently").fill("The amount gets bigger.");
  await page.getByRole("button", { name: "Check my answer" }).click();
  await expect(page.getByText("One or more key ideas need repair.")).toBeVisible();
  await page.getByRole("button", { name: "Repair this idea" }).click();

  await expect(page.getByText(/Use these missing ideas in your correction:/)).toBeVisible();
  await page.getByLabel("Corrected idea in your own words").fill(
    "Earlier gains stay in the base, so later percentage gains apply to the original amount and its accumulated growth.",
  );
  await page.getByRole("button", { name: "Check my answer" }).click();
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

  await expect(page.getByRole("heading", { name: "Recall the product-rule structure" })).toBeVisible();
  await expect(page.getByText(/product rule adds two terms/i)).not.toBeVisible();
  await expect(page.getByText("See the structure before trying it alone", { exact: true })).not.toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Which expression correctly applies the product rule?" })).toBeVisible();
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

  await expect(page.getByRole("heading", { name: "YOVA did not substitute unrelated content." })).toBeVisible();
  await expect(page.getByText(/stopped instead of substituting generic content/i)).toBeVisible();
  await expect(page.getByText("See the structure before trying it alone", { exact: true })).not.toBeVisible();
  await expect(page.getByRole("heading", { name: "What should happen after an initial explanation?" })).not.toBeVisible();
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

  await expect(page.getByRole("heading", { name: "Use money concepts as decision tools" })).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await leaveSession(page, "1 of 5 required steps finished");

  await expect(page.getByText("Continue where you left off")).toBeVisible();
  await expect(page.getByText("1 section saved", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Continue session" }).click();
  await expect(page.getByRole("heading", { name: "Trace one financial choice" })).toBeVisible();
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
  await page.getByRole("button", { name: "Check my answer" }).click();
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

  await page.getByRole("button", { name: "Learning", exact: true }).click();
  await expect(page.getByRole("heading", { name: "What you’re working toward" })).toBeVisible();

  await page.getByRole("button", { name: "Agenda", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Today and this week" })).toBeVisible();

  await page.getByRole("button", { name: "Ask YOVA", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Get help in context" })).toBeVisible();

  await page.getByRole("button", { name: "You", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your learning, in one place" })).toBeVisible();

  await page.getByRole("button", { name: "Home", exact: true }).click();
  await page.getByRole("button", { name: /Create a plan For a test/ }).click();
  await expect(page.getByRole("heading", { name: "What do you need to learn or prepare for?" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();

  await page.getByRole("button", { name: "Study something now", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "What do you want help with?" })).toBeVisible();
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
});

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
  await page.getByRole("button", { name: "Save progress and leave" }).click();
}
