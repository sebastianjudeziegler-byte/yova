import { expect, test, type Page } from "@playwright/test";

const DRAFT_STORAGE_KEY = "yova.study-profile.draft.v1";
const STUDY_PROFILE_SUPPORT_MAILTO = "mailto:hello@yovaapp.com?subject=YOVA%20Study%20Profile%20support";
const PRIVACY_REQUEST_MAILTO = "mailto:hello@yovaapp.com?subject=YOVA%20privacy%20or%20deletion%20request";

test.describe("YOVA Study Profile", () => {
  test("creates a practical private report that survives refresh and joins the waitlist", async ({ page }) => {
    test.setTimeout(60_000);
    const email = `study-profile-${Date.now()}@example.com`;

    await page.goto("/study-profile?utm_source=playwright&utm_campaign=study-profile-e2e");

    await expect(page.getByRole("heading", {
      name: "Find study methods that fit how you actually work.",
    })).toBeVisible();
    await expect(page.getByText("12 questions · about 3 minutes")).toBeVisible();
    await page.getByRole("button", { name: "Get my recommendations" }).first().click();

    await expectOnlyQuestion(page, 1);
    const questionOne = page.getByRole("radiogroup", { name: "Answers for question 1" });
    await questionOne.getByRole("radio").first().click();
    await expectOnlyQuestion(page, 2);

    await page.getByRole("button", { name: "Back", exact: true }).click();
    await expectOnlyQuestion(page, 1);
    await expect(questionOne.getByRole("radio").first()).toHaveAttribute("aria-checked", "true");
    await questionOne.getByRole("radio").nth(3).click();
    await expectOnlyQuestion(page, 2);

    await expect.poll(() => page.evaluate((key) => window.localStorage.getItem(key), DRAFT_STORAGE_KEY))
      .toContain('"q1":"d"');
    await page.reload();
    await expectOnlyQuestion(page, 2);

    for (let questionNumber = 2; questionNumber <= 12; questionNumber += 1) {
      await answerQuestion(page, questionNumber, (questionNumber - 1) % 4);
    }

    await expect(page.getByRole("heading", {
      name: "When are you usually strongest for demanding schoolwork?",
    })).toBeVisible();
    await page.getByRole("button", { name: /^Afternoon/ }).click();

    await expect(page.getByRole("heading", { name: "What best describes you?" })).toBeVisible();
    await page.getByRole("button", { name: /^College/ }).click();

    await expect(page.getByRole("heading", { name: "Your YOVA Study Profile is ready." })).toBeVisible();
    await expect(page.getByRole("checkbox")).toHaveCount(0);
    await page.getByLabel("Where should we send your private report link?").fill(email);
    const submissionResponse = page.waitForResponse((response) => (
      response.request().method() === "POST"
      && new URL(response.url()).pathname === "/api/study-profile/responses"
    ));
    await page.getByRole("button", { name: "Get my full report" }).click();

    const response = await submissionResponse;
    expect(response.status()).toBe(201);
    await expect(response.json()).resolves.toMatchObject({ emailDelivery: "skipped" });

    await expect(page.locator("#report-title")).toBeVisible();
    await expect(page.locator("#report-title")).toBeFocused();
    await expect(page.getByText(
      "We could not send an email copy, so save this private link if you want to return.",
    )).toBeVisible();
    await expect(page).toHaveURL(/\/study-profile\/report\/[A-Za-z0-9_-]{32,}$/);

    const privateReportUrl = new URL(page.url());
    expect(privateReportUrl.search).toBe("");
    expect(privateReportUrl.hash).toBe("");
    expect(decodeURIComponent(privateReportUrl.href)).not.toContain(email);
    await expect(page.locator("body")).not.toContainText(email);

    await expectReportSections(page);
    await expectNoTypographicDashes(page);

    const privateReportPath = privateReportUrl.pathname;
    await seedStaleStudyProfileDraft(page);
    await page.getByRole("link", { name: "Retake" }).click();
    await expectFreshRetake(page);

    await page.goto(privateReportPath);
    await expect(page.locator("#report-title")).toBeVisible();
    await page.reload();
    await expect(page).toHaveURL(privateReportPath);
    await expect(page.locator("#report-title")).toBeVisible();
    await expectReportSections(page);

    await page.getByRole("button", { name: "Join the waitlist" }).click();
    const waitlistSuccess = page.getByRole("status").filter({
      hasText: "You’re on the waitlist. We’ll email you when YOVA is ready.",
    });
    await expect(waitlistSuccess).toBeVisible();
    await expect(waitlistSuccess).toBeFocused();

    await page.reload();
    await expect(waitlistSuccess).toBeVisible();
    await expect(page.getByText(/beta/i)).toHaveCount(0);

    for (const width of [320, 375, 390]) {
      await page.setViewportSize({ width, height: 844 });
      await expectNoHorizontalOverflow(page);
    }

    await seedStaleStudyProfileDraft(page);
    await page.getByRole("link", { name: "Retake" }).click();
    await expectFreshRetake(page);
  });

  test("shows the API message when an open report has been removed", async ({ page }) => {
    const email = `study-profile-stale-${Date.now()}@example.com`;
    await page.goto("/study-profile");
    await page.getByRole("button", { name: "Get my recommendations" }).first().click();

    for (let questionNumber = 1; questionNumber <= 12; questionNumber += 1) {
      await answerQuestion(page, questionNumber, 0);
    }
    await page.getByRole("button", { name: /^Morning/ }).click();
    await page.getByRole("button", { name: /^High school/ }).click();
    await expect(page.getByRole("heading", { name: "Your YOVA Study Profile is ready." })).toBeVisible();
    await page.getByLabel("Where should we send your private report link?").fill(email);
    await page.getByRole("button", { name: "Get my full report" }).click();

    await page.route("**/api/study-profile/interest/**", async (route) => {
      await route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({ error: "This Study Profile report link is invalid or unavailable." }),
      });
    });
    await page.getByRole("button", { name: "Join the waitlist" }).click();
    await expect(page.locator("p[role='alert']")).toHaveText(
      "This Study Profile report link is invalid or unavailable.",
    );
  });

  test("uses a generic not-found screen for an unknown private token", async ({ page }) => {
    const unknownToken = "a".repeat(43);
    const response = await page.goto(`/study-profile/report/${unknownToken}`);

    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "That report link isn't available." })).toBeVisible();
    await expect(page.getByRole("link", { name: "Take the Study Profile" })).toBeVisible();
    await expect(page.locator("body")).not.toContainText(unknownToken);
  });

  test("routes public Study Profile support and privacy requests to hello@yovaapp.com", async ({ page }) => {
    await page.goto("/study-profile");
    await expect(page.getByRole("link", { name: "Email support" }))
      .toHaveAttribute("href", STUDY_PROFILE_SUPPORT_MAILTO);

    await page.goto("/privacy");
    const privacyContact = page.getByRole("link", { name: "hello@yovaapp.com" });
    await expect(privacyContact).toHaveAttribute("href", PRIVACY_REQUEST_MAILTO);
    await expect(page.getByText("YOVA privacy or deletion request", { exact: false })).toBeVisible();
  });

  test("keeps the landing and one-question assessment layouts within narrow viewports", async ({ browser }, testInfo) => {
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
        await viewportPage.goto("/study-profile");
        await expect(viewportPage.getByRole("heading", {
          name: "Find study methods that fit how you actually work.",
        })).toBeVisible();
        await expectNoHorizontalOverflow(viewportPage);

        await viewportPage.getByRole("button", { name: "Get my recommendations" }).first().click();
        await expectOnlyQuestion(viewportPage, 1);
        await expectNoHorizontalOverflow(viewportPage);
      } finally {
        await context.close();
      }
    }
  });

  test("keeps working when browser storage is unavailable", async ({ page }) => {
    await page.addInitScript(() => {
      Storage.prototype.getItem = () => { throw new DOMException("blocked", "SecurityError"); };
      Storage.prototype.setItem = () => { throw new DOMException("blocked", "SecurityError"); };
      Storage.prototype.removeItem = () => { throw new DOMException("blocked", "SecurityError"); };
    });

    await page.goto("/study-profile");
    await page.getByRole("button", { name: "Get my recommendations" }).first().click();
    await expectOnlyQuestion(page, 1);
    await page.getByRole("radio").first().click();
    await expectOnlyQuestion(page, 2);
  });

  test("exposes semantic progress and radio keyboard behavior", async ({ page }) => {
    await page.goto("/study-profile");
    await page.getByRole("button", { name: "Get my recommendations" }).first().click();

    const progress = page.getByRole("progressbar", { name: "Study Profile progress" });
    await expect(progress).toHaveAttribute("aria-valuenow", "7");
    await expect(progress).toHaveAttribute("aria-valuetext", "Question 1 of 12");

    const radios = page.getByRole("radiogroup", { name: "Answers for question 1" }).getByRole("radio");
    await radios.first().focus();
    await page.keyboard.press("ArrowDown");
    await expectOnlyQuestion(page, 2);
  });
});

async function answerQuestion(page: Page, questionNumber: number, answerIndex: number) {
  await expectOnlyQuestion(page, questionNumber);
  await page
    .getByRole("radiogroup", { name: `Answers for question ${questionNumber}` })
    .getByRole("radio")
    .nth(answerIndex)
    .click();
}

async function expectOnlyQuestion(page: Page, questionNumber: number) {
  const currentGroup = page.getByRole("radiogroup", { name: `Answers for question ${questionNumber}` });
  await expect(currentGroup).toBeVisible();
  await expect(currentGroup.getByRole("radio")).toHaveCount(4);
  await expect(page.getByRole("radiogroup", { name: /^Answers for question \d+$/ })).toHaveCount(1);
}

async function seedStaleStudyProfileDraft(page: Page) {
  await page.evaluate((key) => {
    window.localStorage.setItem(key, JSON.stringify({
      version: "profile_model_v1",
      view: "question",
      currentQuestion: 5,
      answers: { q1: "a", q2: "b" },
      metadata: { energyWindow: "morning", schoolLevel: "college" },
    }));
  }, DRAFT_STORAGE_KEY);
}

async function expectFreshRetake(page: Page) {
  await expect.poll(() => new URL(page.url()).pathname).toBe("/study-profile");
  await expectOnlyQuestion(page, 1);
  await expect(
    page
      .getByRole("radiogroup", { name: "Answers for question 1" })
      .locator('[aria-checked="true"]'),
  ).toHaveCount(0);
  await expect.poll(() => page.evaluate((key) => {
    const saved = window.localStorage.getItem(key);
    if (!saved) return null;
    const draft = JSON.parse(saved) as Record<string, unknown>;
    return {
      view: draft.view,
      currentQuestion: draft.currentQuestion,
      answers: draft.answers,
      metadata: draft.metadata,
    };
  }, DRAFT_STORAGE_KEY)).toEqual({
    view: "question",
    currentQuestion: 0,
    answers: {},
    metadata: {},
  });
}

async function expectReportSections(page: Page) {
  await expect(page.getByRole("heading", { name: "A study plan you can try today" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /^Start with a \d+ minute study block$/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Three methods to try" })).toBeVisible();
  await expect(page.getByText("Why it fits your answers", { exact: true })).toHaveCount(3);
  await expect(page.getByText("When to use it", { exact: true })).toHaveCount(3);
  await expect(page.getByText("Keep in mind", { exact: true })).toHaveCount(3);
  await expectReadableMethodCards(page);
  await expect(page.getByRole("heading", { name: "What your answers show" })).toBeVisible();
  await expect(page.locator("#primary-heading")).toBeVisible();
  await expect(page.locator("#secondary-heading")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Common traps to avoid" })).toBeVisible();
  await expect(page.locator("#first-impression-heading")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Join the YOVA waitlist" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "About your Study Profile" })).toBeVisible();
}

async function expectReadableMethodCards(page: Page) {
  const cards = page.getByTestId("study-method-card");
  await expect(cards).toHaveCount(3);

  const typography = await cards.evaluateAll((methodCards) => methodCards.map((card) => {
    const paragraph = card.querySelector("p");
    const step = card.querySelector("li");
    const label = card.querySelector("strong");
    const cardType = card.querySelector("small");
    if (!paragraph || !step || !label || !cardType) {
      throw new Error("Study method card typography target is missing");
    }

    const paragraphStyle = window.getComputedStyle(paragraph);
    const stepStyle = window.getComputedStyle(step);
    const labelStyle = window.getComputedStyle(label);
    const cardTypeStyle = window.getComputedStyle(cardType);
    const paragraphSize = Number.parseFloat(paragraphStyle.fontSize);

    return {
      paragraphSize,
      paragraphLineHeight: Number.parseFloat(paragraphStyle.lineHeight) / paragraphSize,
      stepSize: Number.parseFloat(stepStyle.fontSize),
      labelSize: Number.parseFloat(labelStyle.fontSize),
      cardTypeSize: Number.parseFloat(cardTypeStyle.fontSize),
    };
  }));

  for (const card of typography) {
    expect(card.paragraphSize).toBeGreaterThanOrEqual(14);
    expect(card.paragraphLineHeight).toBeGreaterThanOrEqual(1.5);
    expect(card.stepSize).toBeGreaterThanOrEqual(14);
    expect(card.labelSize).toBeGreaterThanOrEqual(11);
    expect(card.cardTypeSize).toBeGreaterThanOrEqual(11);
  }
}

async function expectNoTypographicDashes(page: Page) {
  const visibleText = await page.locator("body").innerText();
  expect(visibleText).not.toMatch(/[—–]/);
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => {
    const root = document.scrollingElement ?? document.documentElement;
    const offenders = Array.from(document.querySelectorAll<HTMLElement>("body *"))
      .map((element) => {
        const bounds = element.getBoundingClientRect();
        return {
          tag: element.tagName.toLowerCase(),
          className: element.className,
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
