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
  await expect(page.getByLabel("Support progression")).toContainText("Start without support");
  const retrievalRoadmap = page.getByLabel("Session method sequence");
  await expect(retrievalRoadmap).toContainText("Attempt from memory");
  await expect(retrievalRoadmap).toContainText("Compare and repair");
  await expect(page.getByLabel("Method phase 1 of 3")).toContainText("Orient to the target");
  await expect(page.getByText(/Retrieval verifies that confident recognition/)).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();

  await page.getByRole("button", { name: "Very sure" }).click();
  await page.getByRole("button", { name: "Krebs cycle" }).click();
  await expect(page.getByText(/possible misconception/i)).toBeVisible();
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
  await page.getByRole("button", { name: "Complete session" }).click();

  await expect(page.getByText("Repair now, verify later")).toBeVisible();
  await expect(page.getByText(/not saved as proof of mastery/i)).not.toBeVisible();
  await page.getByLabel("Corrected idea in your own words").fill(
    "Glycolysis happens first, followed by the Krebs cycle and electron transport chain.",
  );
  await page.getByRole("button", { name: "Check my answer" }).click();
  await page.getByRole("button", { name: "I got the key idea" }).click();
  await expect(page.getByText(/not saved as proof of mastery/i)).toBeVisible();
  await page.getByRole("button", { name: "Complete session" }).click();

  await expect(page.getByText("2 of 3")).toBeVisible();
  await expect(page.getByText("1 immediate repair completed")).toBeVisible();
  await expect(page.getByText("Delayed verification", { exact: true })).toBeVisible();
  await expect(page.getByText("YOVA will verify this after a delay")).toBeVisible();
  await page.getByRole("button", { name: "Save result and return Home" }).click();

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
  await expect(page.getByLabel("Support progression")).toContainText("Support fades inside this session");
  const teachingRoadmap = page.getByLabel("Session method sequence");
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
  await expect(page.getByRole("group", { name: /Before answering/ })).toBeVisible();
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

  await expect(page.getByText("Plan active")).toBeVisible();
  await page.getByRole("button", { name: "Go to Learning" }).click();
  await expect(page.getByRole("heading", { name: "Your plan" })).toBeVisible();
  await expect(page.getByText("Created by YOVA", { exact: true })).toBeVisible();
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
