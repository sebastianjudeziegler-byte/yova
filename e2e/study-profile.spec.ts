import { expect, test, type Page } from "@playwright/test";

const DRAFT_STORAGE_KEY = "yova.study-profile.draft.v2";
const STUDY_PROFILE_SUPPORT_MAILTO = "mailto:hello@yovaapp.com?subject=YOVA%20Study%20Profile%20support";
const PRIVACY_REQUEST_MAILTO = "mailto:hello@yovaapp.com?subject=YOVA%20privacy%20or%20deletion%20request";

test.describe("YOVA Study Profile", () => {
  test("creates a private report from the continuous 14-step flow with consent unchecked", async ({ page }) => {
    test.setTimeout(90_000);
    const email = `study-profile-${Date.now()}@example.com`;
    let interestPosts = 0;
    page.on("request", (request) => {
      const pathname = new URL(request.url()).pathname;
      if (request.method() === "POST" && pathname.startsWith("/api/study-profile/interest/")) {
        interestPosts += 1;
      }
    });

    await page.goto("/study-profile?utm_source=playwright&utm_campaign=study-profile-e2e");

    await expect(page.getByRole("heading", {
      name: "Find out how you actually study.",
    })).toBeVisible();
    await expect(page.getByText("14 questions · about 3 minutes · no account needed")).toBeVisible();
    await page.getByRole("button", { name: "Get my free study profile" }).first().click();

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
      if (questionNumber === 7) {
        await expect(page.getByText("Halfway. Your pattern is starting to show.")).toBeVisible();
      }
      if (questionNumber === 12) {
        await expect(page.getByText("Last one on habits.")).toBeVisible();
      }
      await answerQuestion(page, questionNumber, (questionNumber - 1) % 4);
    }

    await expectStudyGoalStep(page);
    await page.getByRole("button", { name: /^Keeping up with coursework/ }).click();

    await expectCombinedContextStep(page);
    const seePattern = page.getByRole("button", { name: "See my pattern" });
    await expect(seePattern).toBeDisabled();
    await page.getByRole("button", { name: "Afternoon", exact: true }).click();
    await expect(seePattern).toBeDisabled();
    await page.getByRole("button", { name: "College", exact: true }).click();
    await expect(seePattern).toBeEnabled();
    await seePattern.click();

    await expectUngatedReveal(page);
    const consent = page.getByRole("checkbox", {
      name: /Join the YOVA waitlist\./,
    });
    const ageConfirmation = page.getByRole("checkbox", {
      name: "I confirm I am 13 or older.",
    });
    await expect(consent).not.toBeChecked();
    await expect(ageConfirmation).not.toBeChecked();
    const emailInput = page.getByLabel("Email for your private report link");
    const submit = page.getByRole("button", { name: "Send my full report" });
    await expect(submit).toBeDisabled();
    await emailInput.fill("not-an-email");
    await expect(submit).toBeDisabled();
    await emailInput.fill(email);
    await expect(submit).toBeDisabled();
    await ageConfirmation.check();
    await expect(submit).toBeEnabled();
    await expect(consent).not.toBeChecked();

    const submissionRequest = page.waitForRequest((request) => (
      request.method() === "POST"
      && new URL(request.url()).pathname === "/api/study-profile/responses"
    ));
    const submissionResponse = page.waitForResponse((response) => (
      response.request().method() === "POST"
      && new URL(response.url()).pathname === "/api/study-profile/responses"
    ));
    await submit.click();

    const request = await submissionRequest;
    const requestBody = request.postDataJSON() as {
      answers: Record<string, string>;
      marketingConsent: boolean;
      ageConfirmed: boolean;
      metadata: Record<string, unknown>;
    };
    expect(requestBody.marketingConsent).toBe(false);
    expect(requestBody.ageConfirmed).toBe(true);
    expect(requestBody.metadata).toMatchObject({
      energyWindow: "afternoon",
      schoolLevel: "college",
      studyGoal: "keeping_up",
      hardestPart: null,
    });
    expect(Object.keys(requestBody.answers)).toHaveLength(12);

    const response = await submissionResponse;
    expect(response.status()).toBe(201);
    await expect(response.json()).resolves.toMatchObject({ emailDelivery: "skipped" });
    expect(interestPosts).toBe(0);

    await expect(page.locator("#report-title")).toBeVisible();
    await expect(page.locator("#report-title")).toBeFocused();
    await expect(page.getByText(
      "We could not send the email copy, so save this private link if you want to return.",
    )).toBeVisible();
    await expect(page).toHaveURL(/\/study-profile\/report\/[A-Za-z0-9_-]{32,}$/);

    const privateReportUrl = new URL(page.url());
    expect(privateReportUrl.search).toBe("");
    expect(privateReportUrl.hash).toBe("");
    expect(decodeURIComponent(privateReportUrl.href)).not.toContain(email);
    await expect(page.locator("body")).not.toContainText(email);

    await expectReportSections(page);
    await expectNoTypographicDashes(page);

    const waitlistResponse = page.waitForResponse((waitlist) => (
      waitlist.request().method() === "POST"
      && new URL(waitlist.url()).pathname.startsWith("/api/study-profile/interest/")
    ));
    await page.getByRole("checkbox", { name: "I confirm I am 13 or older." }).first().check();
    await page.getByRole("button", { name: "Send confirmation email" }).last().click();
    expect((await waitlistResponse).status()).toBe(200);
    expect(interestPosts).toBe(1);
    const waitlistPending = page.getByRole("status").filter({
      hasText: "Request received.",
    });
    await expect(waitlistPending).toBeVisible();
    await expect(page.getByRole("button", {
      name: "Send confirmation email",
      exact: true,
    })).toHaveCount(0);
    const resendResponse = page.waitForResponse((waitlist) => (
      waitlist.request().method() === "POST"
      && new URL(waitlist.url()).pathname.startsWith("/api/study-profile/interest/")
    ));
    await page.getByRole("button", { name: "Send confirmation email again" }).first().click();
    expect((await resendResponse).status()).toBe(200);
    expect(interestPosts).toBe(2);
    await expect(page.getByText(
      "YOVA sends at most one confirmation email every 15 minutes.",
    ).first()).toBeVisible();

    const privateReportPath = privateReportUrl.pathname;
    await page.reload();
    await expect(page).toHaveURL(privateReportPath);
    await expect(page.locator("#report-title")).toBeVisible();
    await expectReportSections(page);
    await expect(page.getByRole("status").filter({
      hasText: "Request received.",
    })).toBeVisible();
    await expect(page.getByRole("button", {
      name: "Send confirmation email",
      exact: true,
    })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Send confirmation email again" }).first())
      .toBeVisible();
    await expect(page.getByText(/beta/i)).toHaveCount(0);

    for (const width of [360, 390]) {
      await page.setViewportSize({ width, height: 844 });
      await expectNoHorizontalOverflow(page);
    }

    await seedStaleStudyProfileDraft(page);
    await page.getByRole("link", { name: "Retake" }).click();
    await expectFreshRetake(page);

    await page.goto(privateReportPath);
    await expect(page.locator("#report-title")).toBeVisible();
    await page.reload();
    await expect(page).toHaveURL(privateReportPath);
    await expect(page.locator("#report-title")).toBeVisible();
    await expectReportSections(page);

    await seedStaleStudyProfileDraft(page);
    await page.getByRole("link", { name: "Retake" }).click();
    await expectFreshRetake(page);
  });

  test("shows the API message when an open report has been removed", async ({ page }) => {
    test.setTimeout(60_000);
    const email = `study-profile-stale-${Date.now()}@example.com`;
    await page.goto("/study-profile");
    await page.getByRole("button", { name: "Get my free study profile" }).first().click();
    await completeAssessmentToReveal(page);

    const consent = page.getByRole("checkbox", {
      name: /Join the YOVA waitlist\./,
    });
    await expect(consent).not.toBeChecked();
    await page.getByLabel("Email for your private report link").fill(email);
    await page.getByRole("checkbox", { name: "I confirm I am 13 or older." }).check();
    const reportReady = page.locator("#report-title");
    await page.getByRole("button", { name: "Send my full report" }).click();
    await expect(reportReady).toBeVisible();

    await page.route("**/api/study-profile/interest/**", async (route) => {
      await route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({ error: "This Study Profile report link is invalid or unavailable." }),
      });
    });
    await page.getByRole("checkbox", { name: "I confirm I am 13 or older." }).first().check();
    await page.getByRole("button", { name: "Send confirmation email" }).last().click();
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

  test("requires an explicit POST to confirm a fragment-only waitlist token", async ({ page }) => {
    const confirmationToken = "c".repeat(43);
    let confirmationPosts = 0;
    page.on("request", (request) => {
      if (
        request.method() === "POST"
        && new URL(request.url()).pathname === "/api/study-profile/waitlist/confirm"
      ) confirmationPosts += 1;
    });
    await page.route("**/api/study-profile/waitlist/confirm", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ waitlistJoined: true }),
      });
    });

    await page.goto(`/study-profile/waitlist/confirm#token=${confirmationToken}`);
    await expect(page.getByRole("heading", {
      name: "Confirm your place on the waitlist.",
    })).toBeVisible();
    await expect.poll(() => new URL(page.url()).hash).toBe("");
    expect(confirmationPosts).toBe(0);
    await expect(page.locator("body")).not.toContainText(confirmationToken);

    await page.getByRole("button", { name: "Confirm my place" }).click();
    expect(confirmationPosts).toBe(1);
    await expect(page.getByRole("heading", {
      name: "You are on the YOVA waitlist.",
    })).toBeVisible();
    await expect(page).toHaveURL("/study-profile/waitlist/confirm");
  });

  test("routes public Study Profile support and privacy requests to hello@yovaapp.com", async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto("/study-profile");
    await expect(page.getByRole("link", { name: "Email support" }))
      .toHaveAttribute("href", STUDY_PROFILE_SUPPORT_MAILTO);

    await page.goto("/privacy");
    const privacyContact = page.getByRole("link", { name: "hello@yovaapp.com" });
    await expect(privacyContact).toHaveAttribute("href", PRIVACY_REQUEST_MAILTO);
    await expect(page.getByText("YOVA privacy or deletion request", { exact: false })).toBeVisible();
  });

  test("keeps the landing and reveal layouts within 360px and 390px viewports", async ({ browser }, testInfo) => {
    test.setTimeout(90_000);
    for (const width of [360, 390]) {
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
          name: "Find out how you actually study.",
        })).toBeVisible();
        await expectNoHorizontalOverflow(viewportPage);

        await viewportPage.getByRole("button", { name: "Get my free study profile" }).first().click();
        await completeAssessmentToReveal(viewportPage);
        await expectUngatedReveal(viewportPage);
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
    await page.getByRole("button", { name: "Get my free study profile" }).first().click();
    await expectOnlyQuestion(page, 1);
    await page.getByRole("radio").first().click();
    await expectOnlyQuestion(page, 2);
  });

  test("exposes semantic 14-step progress and dynamic radio keyboard help", async ({ page }) => {
    await page.goto("/study-profile");
    await page.getByRole("button", { name: "Get my free study profile" }).first().click();

    const progress = page.getByRole("progressbar", { name: "Study Profile progress" });
    await expect(progress).toHaveAttribute("aria-valuemin", "0");
    await expect(progress).toHaveAttribute("aria-valuemax", "14");
    await expect(progress).toHaveAttribute("aria-valuenow", "1");
    await expect(progress).toHaveAttribute("aria-valuetext", "Question 1 of 14");
    await expect(page.getByText("Choose what is usually true for you, even if it is not ideal.")).toBeVisible();
    await expect(page.getByText("Keyboard: press 1 to 4, A to D, or use arrow keys"))
      .toHaveText("Keyboard: press 1 to 4, A to D, or use arrow keys");
    await expectNoPercentOrContextSwitch(page);

    const radios = page.getByRole("radiogroup", { name: "Answers for question 1" }).getByRole("radio");
    await radios.first().focus();
    await page.keyboard.press("ArrowDown");
    await expectOnlyQuestion(page, 2);
    await expect(progress).toHaveAttribute("aria-valuenow", "2");
    await expect(progress).toHaveAttribute("aria-valuetext", "Question 2 of 14");
  });
});

async function completeAssessmentToReveal(page: Page) {
  for (let questionNumber = 1; questionNumber <= 12; questionNumber += 1) {
    await answerQuestion(page, questionNumber, 0);
  }
  await expectStudyGoalStep(page);
  await page.getByRole("button", { name: /^Exams coming up/ }).click();
  await expectCombinedContextStep(page);
  await page.getByRole("button", { name: "Morning", exact: true }).click();
  await page.getByRole("button", { name: "High school", exact: true }).click();
  await page.getByRole("button", { name: "See my pattern" }).click();
}

async function answerQuestion(page: Page, questionNumber: number, answerIndex: number) {
  await expectOnlyQuestion(page, questionNumber);
  await page
    .getByRole("radiogroup", { name: `Answers for question ${questionNumber}` })
    .getByRole("radio")
    .nth(answerIndex)
    .click();
}

async function expectOnlyQuestion(page: Page, questionNumber: number) {
  await expectAssessmentStep(page, questionNumber);
  const currentGroup = page.getByRole("radiogroup", { name: `Answers for question ${questionNumber}` });
  await expect(currentGroup).toBeVisible();
  await expect(currentGroup.getByRole("radio")).toHaveCount(4);
  await expect(page.getByRole("radiogroup", { name: /^Answers for question \d+$/ })).toHaveCount(1);
  await expect(page.getByText("Keyboard: press 1 to 4, A to D, or use arrow keys"))
    .toHaveText("Keyboard: press 1 to 4, A to D, or use arrow keys");
  await expectNoPercentOrContextSwitch(page);
}

async function expectStudyGoalStep(page: Page) {
  await expectAssessmentStep(page, 13);
  await expect(page.getByRole("heading", {
    name: "What are you mainly studying for right now?",
  })).toBeVisible();
  await expect(page.getByRole("radiogroup", { name: /^Answers for question/ })).toHaveCount(0);
  await expectNoPercentOrContextSwitch(page);
}

async function expectCombinedContextStep(page: Page) {
  await expectAssessmentStep(page, 14);
  await expect(page.getByRole("heading", { name: "One last bit of context." })).toBeVisible();
  await expect(page.getByText("When is your focus usually strongest?", { exact: true })).toBeVisible();
  await expect(page.getByText("What best describes your setting?", { exact: true })).toBeVisible();
  await expectNoPercentOrContextSwitch(page);
}

async function expectAssessmentStep(page: Page, step: number) {
  const progress = page.getByRole("progressbar", { name: "Study Profile progress" });
  await expect(progress).toHaveAttribute("aria-valuemax", "14");
  await expect(progress).toHaveAttribute("aria-valuenow", String(step));
  await expect(progress).toHaveAttribute("aria-valuetext", `Question ${step} of 14`);
}

async function expectNoPercentOrContextSwitch(page: Page) {
  await expect(page.getByText(/^\d+%$/)).toHaveCount(0);
  await expect(page.getByText("Profile context", { exact: true })).toHaveCount(0);
}

async function expectUngatedReveal(page: Page) {
  const progress = page.getByRole("progressbar", { name: "Study Profile progress" });
  await expect(progress).toHaveAttribute("aria-valuemax", "14");
  await expect(progress).toHaveAttribute("aria-valuenow", "14");
  await expect(progress).toHaveAttribute("aria-valuetext", "Profile complete");
  await expect(page.getByRole("heading", { name: /^You are The .+\.$/ })).toBeVisible();
  const chart = page.getByLabel("Your six study habits").first();
  await expect(chart).toBeVisible();
  await expect(chart.locator(":scope > div")).toHaveCount(6);
  await expect(page.getByText("One thing your answers show", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Get the full report, free." })).toBeVisible();
  await expect(page.getByLabel("Email for your private report link")).toHaveValue("");
}

async function seedStaleStudyProfileDraft(page: Page) {
  await page.evaluate((key) => {
    window.localStorage.setItem(key, JSON.stringify({
      version: "study_profile_draft_v2",
      view: "question",
      currentQuestion: 5,
      answers: { q1: "a", q2: "b" },
      metadata: {
        energyWindow: "morning",
        schoolLevel: "college",
        studyGoal: "keeping_up",
      },
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
  await expect(page.locator("#report-title")).toHaveText(/^The .+\.$/);
  const heroChart = page.getByLabel("Your six study habits").first();
  await expect(heroChart.locator(":scope > div")).toHaveCount(6);
  await expect(page.getByRole("heading", { name: "Why this is happening" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Your top three methods" })).toBeVisible();
  await expectReadableMethodCards(page);

  const catalogSection = page.locator('section[aria-labelledby="catalog-heading"]');
  await expect(page.getByRole("heading", { name: "Your 15-method catalog" })).toBeVisible();
  await expect(catalogSection.locator("details")).toHaveCount(15);

  await expect(page.getByRole("heading", {
    name: "One block. A clear start. A clear stop.",
  })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Your six study habits" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Common traps to avoid" })).toBeVisible();
  await expect(page.getByRole("heading", {
    name: "Share your pattern, not your private report.",
  })).toBeVisible();
  await expect(page.getByRole("button", { name: "Share my pattern" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Download story" })).toBeVisible();
  await expect(page.getByRole("heading", {
    name: "Your profile is a snapshot. It is already aging.",
  })).toBeVisible();
  await expect(page.getByText("YOVA waitlist", { exact: true })).toBeVisible();
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
