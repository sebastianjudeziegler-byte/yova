import { expect, test, type Page } from "@playwright/test";

const PUBLIC_DRAFT_STORAGE_KEY = "yova.canonical-profile.public-draft.v1";
const QUESTION_COUNT = 11;

test.describe("YOVA canonical Study Profile", () => {
  test.describe.configure({ timeout: 90_000 });

  test("builds the canonical 11-question profile, imports it into an account, and skips duplicate onboarding", async ({ page }, testInfo) => {
    const email = `canonical-profile-${testInfo.project.name}-${Date.now()}@example.com`;

    await page.goto("/study-profile/setup?utm_source=playwright&utm_campaign=canonical-profile-e2e");

    await expect(page.getByRole("heading", {
      name: "Tell YOVA how you want to work together.",
    })).toBeVisible();
    await expect(page.getByText("Answer 11 short, optional questions", { exact: false })).toBeVisible();
    await expect(page.getByText("not a personality type", { exact: false })).toBeVisible();
    await page.getByRole("button", { name: "Build my study profile" }).click();

    await expectQuestion(page, 1);
    const customize = page.getByRole("button", { name: "Let me customize from valid options" });
    await expect(customize).toHaveAttribute("aria-pressed", "false");
    await customize.click();
    await expect(customize).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Continue" }).click();

    await expectQuestion(page, 2);
    await page.getByRole("button", { name: "Back" }).click();
    await expectQuestion(page, 1);
    await expect(page.getByRole("button", { name: "Let me customize from valid options" }))
      .toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Continue" }).click();

    await expectQuestion(page, 2);
    await page.getByRole("button", { name: "I pause because the first step is unclear" }).click();
    await page.getByRole("button", { name: "Continue" }).click();

    for (let questionNumber = 3; questionNumber < QUESTION_COUNT; questionNumber += 1) {
      await expectQuestion(page, questionNumber);
      await page.getByRole("button", { name: "Skip for now" }).click();
    }

    await expectQuestion(page, QUESTION_COUNT);
    await page.getByRole("button", { name: "Evening", exact: true }).click();
    await page.getByRole("button", { name: "Review my setup" }).click();

    await expect(page.getByRole("heading", { name: "How YOVA will work with you" })).toBeVisible();
    await expect(page.getByText(
      "YOVA will let you customize from routes that remain valid for the task.",
      { exact: true },
    )).toBeVisible();
    await expect(page.getByText("YOVA may suggest evening", { exact: false })).toBeVisible();

    await expect.poll(() => readPublicDraft(page)).toMatchObject({
      schemaVersion: "canonical_learner_profile_v1",
      questionnaireVersion: "canonical_profile_questionnaire_v1",
      signals: [
        { signalId: "control_mode", value: "ill_customize", provenance: "direct_answer" },
        { signalId: "starting_friction", value: "unclear_first_step", provenance: "direct_answer" },
        { signalId: "preferred_working_period", value: "evening", provenance: "direct_answer" },
      ],
    });

    await page.getByRole("link", { name: "Use this profile in YOVA" }).click();
    await expect(page.getByRole("heading", { name: "Know what to study next." })).toBeVisible();
    // Keep the browser-auth mutation local to the development fixture. The
    // profile handoff itself is the same-origin storage boundary used by
    // the real account flow.
    await page.goto("/?qa=preview");
    await page.getByRole("button", { name: "Build my plan" }).click();
    await expect(page.getByRole("heading", { name: "Start building your YOVA." })).toBeVisible();
    await page.getByLabel("First name").fill("Profile Tester");
    await page.getByLabel("Email address").fill(email);
    await page.getByRole("button", { name: "Continue" }).click();

    await expect(page.getByRole("heading", { name: "YOVA will begin like this." })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Make YOVA fit how you actually study." })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Personalize YOVA" })).toHaveCount(0);
    await expect(page.getByText(
      "YOVA will let you customize from routes that remain valid for the task.",
      { exact: true },
    )).toBeVisible();
    await expect.poll(() => readPublicDraft(page)).not.toBeNull();

    await page.getByRole("button", { name: "Open YOVA" }).click();
    await expect(page.getByRole("navigation", { name: "Main navigation" })).toBeVisible();
    await expect.poll(() => readPublicDraft(page)).toBeNull();
  });

  test("restores only a valid saved canonical draft", async ({ page }) => {
    await page.goto("/study-profile/setup");
    await page.evaluate((key) => {
      window.localStorage.setItem(key, JSON.stringify({
        schemaVersion: "canonical_learner_profile_v1",
        questionnaireVersion: "canonical_profile_questionnaire_v1",
        signals: [{
          signalId: "control_mode",
          value: "help_me_choose",
          source: "canonical_questionnaire",
          sourceQuestionId: "profile_control_mode",
          provenance: "direct_answer",
        }],
      }));
    }, PUBLIC_DRAFT_STORAGE_KEY);
    await page.goto("/study-profile/setup");
    await page.getByRole("button", { name: "Build my study profile" }).click();

    await expectQuestion(page, 1);
    await expect(page.getByRole("button", {
      name: "Show a short recommendation and alternatives",
    })).toHaveAttribute("aria-pressed", "true");

    await page.evaluate((key) => {
      window.localStorage.setItem(key, JSON.stringify({ signals: "forged" }));
    }, PUBLIC_DRAFT_STORAGE_KEY);
    await page.goto("/study-profile/setup");
    await page.getByRole("button", { name: "Build my study profile" }).click();
    await expect(page.getByRole("button", {
      name: "Show a short recommendation and alternatives",
    })).toHaveAttribute("aria-pressed", "false");
  });

  test("finishes safely and explains the fallback when browser storage is unavailable", async ({ page }) => {
    await page.addInitScript(() => {
      Storage.prototype.getItem = () => { throw new DOMException("blocked", "SecurityError"); };
      Storage.prototype.setItem = () => { throw new DOMException("blocked", "SecurityError"); };
      Storage.prototype.removeItem = () => { throw new DOMException("blocked", "SecurityError"); };
    });

    await page.goto("/study-profile/setup");
    await page.getByRole("button", { name: "Build my study profile" }).click();
    await finishBySkipping(page);

    await expect(page.getByRole("heading", { name: "How YOVA will work with you" })).toBeVisible();
    await expect(page.getByRole("alert").filter({
      hasText: "This browser blocked local storage",
    })).toBeVisible();
    await expect(page.getByRole("link", { name: "Use this profile in YOVA" })).toBeVisible();
  });

  test("exposes semantic progress, pressed choices, and predictable keyboard focus", async ({ page }) => {
    await page.goto("/study-profile/setup");
    await page.getByRole("button", { name: "Build my study profile" }).click();

    const progress = page.getByRole("progressbar", { name: "Study Profile progress" });
    await expect(progress).toHaveAttribute("aria-valuemin", "1");
    await expect(progress).toHaveAttribute("aria-valuemax", "11");
    await expect(progress).toHaveAttribute("aria-valuenow", "1");
    await expect(progress).toHaveAttribute("aria-valuetext", "Question 1 of 11");
    await expect(page.getByRole("heading", {
      name: "How should YOVA involve you when more than one study route would work?",
    })).toBeFocused();

    const firstOption = page.getByRole("button", { name: "Choose the route for me" });
    await firstOption.focus();
    await page.keyboard.press("Enter");
    await expect(firstOption).toHaveAttribute("aria-pressed", "true");
    await expectQuestion(page, 1);

    await page.getByRole("button", { name: "Continue" }).click();
    await expect(progress).toHaveAttribute("aria-valuenow", "2");
    await expect(progress).toHaveAttribute("aria-valuetext", "Question 2 of 11");
    await expect(page.getByRole("heading", {
      name: "You planned to study, and the time arrives. What most often happens?",
    })).toBeFocused();
    await expect(page.locator('[role="group"]')).toHaveCount(1);
  });

  test("keeps landing, questionnaire, and summary inside narrow mobile viewports", async ({ browser }, testInfo) => {
    for (const width of [320, 375, 390]) {
      const context = await browser.newContext({
        baseURL: testInfo.project.use.baseURL,
        deviceScaleFactor: testInfo.project.use.deviceScaleFactor,
        hasTouch: testInfo.project.use.hasTouch,
        isMobile: testInfo.project.use.isMobile,
        userAgent: testInfo.project.use.userAgent,
        viewport: { width, height: 844 },
      });
      const viewportPage = await context.newPage();

      try {
        await viewportPage.goto("/study-profile/setup");
        await expect(viewportPage.getByRole("heading", {
          name: "Tell YOVA how you want to work together.",
        })).toBeVisible();
        await expectNoHorizontalOverflow(viewportPage);

        await viewportPage.getByRole("button", { name: "Build my study profile" }).click();
        await expectQuestion(viewportPage, 1);
        await expectNoHorizontalOverflow(viewportPage);

        await finishBySkipping(viewportPage);
        await expect(viewportPage.getByRole("heading", {
          name: "How YOVA will work with you",
        })).toBeVisible();
        await expectNoHorizontalOverflow(viewportPage);
      } finally {
        await context.close();
      }
    }
  });
});

async function expectQuestion(page: Page, questionNumber: number) {
  await expect(page.getByText(`${questionNumber} of ${QUESTION_COUNT}`, { exact: true })).toBeVisible();
  await expect(page.getByRole("progressbar", { name: "Study Profile progress" }))
    .toHaveAttribute("aria-valuenow", String(questionNumber));
  await expect(page.locator('[role="group"]')).toHaveCount(1);
  expect(await page.locator('[role="group"] button').count()).toBeGreaterThanOrEqual(5);
}

async function finishBySkipping(page: Page) {
  for (let questionNumber = 1; questionNumber < QUESTION_COUNT; questionNumber += 1) {
    await expectQuestion(page, questionNumber);
    await page.getByRole("button", { name: "Skip for now" }).click();
  }
  await expectQuestion(page, QUESTION_COUNT);
  await page.getByRole("button", { name: "Review my setup" }).click();
}

async function readPublicDraft(page: Page) {
  return page.evaluate((key) => {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) as unknown : null;
  }, PUBLIC_DRAFT_STORAGE_KEY);
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => {
    const root = document.scrollingElement ?? document.documentElement;
    const offenders = Array.from(document.querySelectorAll<HTMLElement>("body *"))
      .map((element) => {
        const bounds = element.getBoundingClientRect();
        return {
          tag: element.tagName.toLowerCase(),
          clientWidth: element.clientWidth,
          scrollWidth: element.scrollWidth,
          left: Math.round(bounds.left),
          right: Math.round(bounds.right),
          width: Math.round(bounds.width),
        };
      })
      .filter((element) => (
        element.scrollWidth > element.clientWidth + 1
        || element.width > window.innerWidth + 1
        || element.left < -1
        || element.right > window.innerWidth + 1
      ))
      .slice(0, 12);

    return {
      clientWidth: root.clientWidth,
      scrollWidth: root.scrollWidth,
      offenders,
    };
  });

  expect(
    overflow.scrollWidth,
    `Horizontal overflow at ${await page.evaluate(() => window.innerWidth)}px: ${JSON.stringify(overflow.offenders)}`,
  ).toBeLessThanOrEqual(overflow.clientWidth + 1);
}
