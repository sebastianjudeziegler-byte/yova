import { expect, test, type Page } from "@playwright/test";

const DRAFT_STORAGE_KEY = "yova.study-profile.draft.v1";
const STUDY_PROFILE_SUPPORT_MAILTO = "mailto:hello@yovaapp.com?subject=YOVA%20Study%20Profile%20support";
const PRIVACY_REQUEST_MAILTO = "mailto:hello@yovaapp.com?subject=YOVA%20privacy%20or%20deletion%20request";

test.describe("YOVA Study Profile", () => {
  test("creates a private report that survives refresh and records early-access interest", async ({ page }) => {
    const email = `study-profile-${Date.now()}@example.com`;

    await page.goto("/study-profile?utm_source=playwright&utm_campaign=study-profile-e2e");

    await expect(page.getByRole("heading", {
      name: "Why doesn’t studying work the same way for everyone?",
    })).toBeVisible();
    await expect(page.getByText("12 questions · about 3 minutes")).toBeVisible();
    await page.getByRole("button", { name: "Find my study profile" }).first().click();

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

    await expect(page.getByRole("heading", {
      name: "What is the hardest part of studying for you right now?",
    })).toBeVisible();
    await expect(page.getByLabel("Hardest part of studying")).toHaveValue("");
    await page.getByRole("button", { name: "See my initial result" }).click();

    await expect(page.getByRole("heading", { name: "Your YOVA Study Profile is ready." })).toBeVisible();
    await expect(page.getByRole("checkbox")).not.toBeChecked();
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
      "Email delivery is not configured, so save this private link if you want to return.",
    )).toBeVisible();
    await expect(page).toHaveURL(/\/study-profile\/report\/[A-Za-z0-9_-]{32,}$/);

    const privateReportUrl = new URL(page.url());
    expect(privateReportUrl.search).toBe("");
    expect(privateReportUrl.hash).toBe("");
    expect(decodeURIComponent(privateReportUrl.href)).not.toContain(email);
    await expect(page.locator("body")).not.toContainText(email);

    await expectReportSections(page);

    const privateReportPath = privateReportUrl.pathname;
    await page.reload();
    await expect(page).toHaveURL(privateReportPath);
    await expect(page.locator("#report-title")).toBeVisible();
    await expectReportSections(page);

    await page.getByRole("button", { name: "Get early access to YOVA" }).click();
    await expect(page.getByText("You’re on the early-access list.", { exact: true })).toBeVisible();
    await expect(page.getByText("I’d also be interested in testing YOVA before launch.")).toBeVisible();
    await expect(page.getByRole("group", { name: "I’d also be interested in testing YOVA before launch." })).toBeFocused();
    await page.getByRole("button", { name: "Yes, I’m interested" }).click();
    await expect(page.getByText("Beta interest saved—we may reach out before launch.")).toBeVisible();
    await expect(page.getByText("Beta interest saved—we may reach out before launch.")).toBeFocused();

    await page.reload();
    await expect(page.getByText("You’re on the early-access list.", { exact: true })).toBeVisible();
    await expect(page.getByText("Beta interest saved—we may reach out before launch.")).toBeVisible();

    for (const width of [320, 375, 390]) {
      await page.setViewportSize({ width, height: 844 });
      await expectNoHorizontalOverflow(page);
    }
  });

  test("preserves a declined beta invitation as completed after reload", async ({ page }) => {
    const email = `study-profile-decline-${Date.now()}@example.com`;
    await page.goto("/study-profile");
    await page.getByRole("button", { name: "Find my study profile" }).first().click();

    for (let questionNumber = 1; questionNumber <= 12; questionNumber += 1) {
      await answerQuestion(page, questionNumber, 0);
    }
    await page.getByRole("button", { name: /^Morning/ }).click();
    await page.getByRole("button", { name: /^High school/ }).click();
    await page.getByRole("button", { name: "See my initial result" }).click();
    await page.getByLabel("Where should we send your private report link?").fill(email);
    await page.getByRole("button", { name: "Get my full report" }).click();

    await page.getByRole("button", { name: "Get early access to YOVA" }).click();
    await page.getByRole("button", { name: "Not right now" }).click();
    await expect(page.getByText("Got it. You’re still on the early-access list.")).toBeVisible();

    await page.reload();
    await expect(page.getByText("Got it. You’re still on the early-access list.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Not right now" })).toHaveCount(0);
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
          name: "Why doesn’t studying work the same way for everyone?",
        })).toBeVisible();
        await expectNoHorizontalOverflow(viewportPage);

        await viewportPage.getByRole("button", { name: "Find my study profile" }).first().click();
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
    await page.getByRole("button", { name: "Find my study profile" }).first().click();
    await expectOnlyQuestion(page, 1);
    await page.getByRole("radio").first().click();
    await expectOnlyQuestion(page, 2);
  });

  test("exposes semantic progress and radio keyboard behavior", async ({ page }) => {
    await page.goto("/study-profile");
    await page.getByRole("button", { name: "Find my study profile" }).first().click();

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

async function expectReportSections(page: Page) {
  await expect(page.getByRole("heading", { name: "Six signals. One connected study system." })).toBeVisible();
  await expect(page.locator("#primary-heading")).toBeVisible();
  await expect(page.locator("#secondary-heading")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Design around your current tendencies." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Watch for these failure points." })).toBeVisible();
  await expect(page.locator("#protocol-heading")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Personalization should change the experience." })).toBeVisible();
  await expect(page.locator("#first-impression-heading")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Want YOVA to build around your profile automatically?" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "About this initial profile" })).toBeVisible();
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
