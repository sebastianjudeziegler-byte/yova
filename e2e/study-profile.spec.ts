import { expect, test, type Locator, type Page } from "@playwright/test";

const DRAFT_STORAGE_KEY = "yova.study-profile.draft.v2";
const STUDY_PROFILE_SUPPORT_MAILTO = "mailto:hello@yovaapp.com?subject=YOVA%20Study%20Profile%20support";
const PRIVACY_REQUEST_MAILTO = "mailto:hello@yovaapp.com?subject=YOVA%20privacy%20or%20deletion%20request";

test.describe("YOVA Study Profile", () => {
  test("requires waitlist confirmation before revealing any report", async ({ page }) => {
    test.setTimeout(90_000);
    const email = `study-profile-${Date.now()}@example.com`;

    await page.goto("/study-profile?utm_source=tiktok&utm_medium=organic_social&utm_campaign=study_profile_quiz&utm_content=static_v1&utm_term=student_planner&fbclid=ignored_click_id");

    expect(await page.evaluate(() => typeof (window as typeof window & { fbq?: unknown }).fbq))
      .toBe("undefined");
    await expect(page.locator('script[src*="connect.facebook.net"]')).toHaveCount(0);

    await expect(page.getByRole("heading", {
      name: "Find out how you actually study.",
    })).toBeVisible();
    await expect(page.getByText(
      "Free · about 3 minutes · email confirmation required",
    ).first()).toBeVisible();
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
    const savedDraft = await page.evaluate((key) => {
      const raw = window.localStorage.getItem(key);
      return raw ? JSON.parse(raw) as Record<string, unknown> : null;
    }, DRAFT_STORAGE_KEY);
    expect(savedDraft).not.toBeNull();
    expect(savedDraft?.savedAt).toEqual(expect.any(Number));
    expect(savedDraft).not.toHaveProperty("email");
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
    const unlockResults = page.getByRole("button", { name: "Finish my profile" });
    await expect(unlockResults).toBeDisabled();
    await page.getByRole("button", { name: "Afternoon", exact: true }).click();
    await expect(unlockResults).toBeDisabled();
    await page.getByRole("button", { name: "College", exact: true }).click();
    await expect(unlockResults).toBeEnabled();
    await unlockResults.click();

    await expectLockedReveal(page);
    const waitlistConsent = page.getByRole("checkbox", {
      name: /Confirm my place on the YOVA waitlist/,
    });
    const ageConfirmation = page.getByRole("checkbox", {
      name: "I confirm I am 13 or older.",
    });
    await expect(waitlistConsent).not.toBeChecked();
    await expect(ageConfirmation).not.toBeChecked();
    const emailInput = page.getByLabel("Email for your confirmation link");
    const submit = page.getByRole("button", { name: "Send my confirmation link" });
    await expect(submit).toBeDisabled();
    await emailInput.fill("not-an-email");
    await expect(submit).toBeDisabled();
    await emailInput.fill(email);
    await expect(submit).toBeDisabled();
    await ageConfirmation.check();
    await expect(submit).toBeDisabled();
    await waitlistConsent.check();
    await expect(submit).toBeEnabled();

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
      waitlistConsent: boolean;
      ageConfirmed: boolean;
      metadata: Record<string, unknown>;
      attribution: Record<string, unknown>;
    };
    expect(requestBody.marketingConsent).toBe(false);
    expect(requestBody.waitlistConsent).toBe(true);
    expect(requestBody.ageConfirmed).toBe(true);
    expect(requestBody.metadata).toMatchObject({
      energyWindow: "afternoon",
      schoolLevel: "college",
      studyGoal: "keeping_up",
      hardestPart: null,
    });
    expect(requestBody.attribution).toMatchObject({
      source: "tiktok",
      utmSource: "tiktok",
      utmMedium: "organic_social",
      utmCampaign: "study_profile_quiz",
      utmContent: "static_v1",
      utmTerm: "student_planner",
    });
    expect(requestBody.attribution).not.toHaveProperty("fbclid");
    expect(Object.keys(requestBody.answers)).toHaveLength(12);

    const response = await submissionResponse;
    expect(response.status()).toBe(202);
    const responseBody = await response.json() as Record<string, unknown>;
    expect(responseBody).toEqual({ confirmationPending: true });
    expect(responseBody).not.toHaveProperty("reportToken");
    expect(responseBody).not.toHaveProperty("reportUrl");
    expect(responseBody).not.toHaveProperty("report");
    expect(responseBody).not.toHaveProperty("storedResponse");

    await expect.poll(() => new URL(page.url()).pathname).toBe("/study-profile");
    await expect(page.getByText("Confirmation sent", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", {
      name: "Check your email to unlock your report.",
    })).toBeVisible();
    await expect(page.locator("#report-title")).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText(email);
    await expect.poll(() => page.evaluate((key) => window.localStorage.getItem(key), DRAFT_STORAGE_KEY))
      .toBeNull();
  });

  test("opens a bound report only after explicit waitlist confirmation", async ({ page }) => {
    const confirmationToken = "c".repeat(43);
    const reportToken = "r".repeat(43);
    const responseId = "11111111-1111-4111-8111-111111111111";

    await page.route("**/api/study-profile/waitlist/confirm", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          waitlistJoined: true,
          reportUnlocked: true,
          reportUrl: `/study-profile/report/${reportToken}`,
          responseId,
        }),
      });
    });
    await page.route(`**/study-profile/report/${reportToken}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<!doctype html><html><body><h1 id='report-title'>Unlocked report</h1></body></html>",
      });
    });

    await page.goto(`/study-profile/waitlist/confirm#token=${confirmationToken}&report=${reportToken}`);
    await expect.poll(() => new URL(page.url()).hash).toBe("");
    await expect(page.getByRole("heading", {
      name: "Confirm your place and unlock your report.",
    })).toBeVisible();
    await expect(page.locator("#report-title")).toHaveCount(0);

    const confirmationRequest = page.waitForRequest((request) => (
      request.method() === "POST"
      && new URL(request.url()).pathname === "/api/study-profile/waitlist/confirm"
    ));
    await page.getByRole("button", { name: "Confirm and view my results" }).click();
    expect((await confirmationRequest).postDataJSON()).toEqual({
      token: confirmationToken,
      reportToken,
    });
    await expect(page).toHaveURL(`/study-profile/report/${reportToken}`);
    await expect(page.locator("#report-title")).toHaveText("Unlocked report");
  });

  test("keeps results locked when report creation fails", async ({ page }) => {
    test.setTimeout(60_000);
    const email = `study-profile-stale-${Date.now()}@example.com`;
    await page.goto("/study-profile");
    await page.getByRole("button", { name: "Get my free study profile" }).first().click();
    await completeAssessmentToReveal(page);

    const waitlistConsent = page.getByRole("checkbox", {
      name: /Confirm my place on the YOVA waitlist/,
    });
    await expect(waitlistConsent).not.toBeChecked();
    await page.getByLabel("Email for your confirmation link").fill(email);
    await page.getByRole("checkbox", { name: "I confirm I am 13 or older." }).check();
    await waitlistConsent.check();
    await page.route("**/api/study-profile/responses", async (route) => {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Study Profile saving is temporarily unavailable. Try again shortly." }),
      });
    });
    await page.getByRole("button", {
      name: "Send my confirmation link",
    }).click();
    await expect(page.locator("p[role='alert']")).toHaveText(
      "Study Profile saving is temporarily unavailable. Try again shortly.",
    );
    await expect(page.locator("#report-title")).toHaveCount(0);
    await expect(page.getByRole("heading", {
      name: "Your study pattern is ready.",
    })).toBeVisible();
    await expect(page).toHaveURL(/\/study-profile$/);
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
        body: JSON.stringify({
          waitlistJoined: true,
        }),
      });
    });

    await page.goto(`/study-profile/waitlist/confirm#token=${confirmationToken}`);
    await expect(page.getByRole("heading", {
      name: "Confirm your place on the YOVA waitlist.",
    })).toBeVisible();
    await expect(page.getByRole("link", { name: "Privacy Notice" })).toHaveAttribute("href", "/privacy");
    await expect.poll(() => new URL(page.url()).hash).toBe("");
    expect(confirmationPosts).toBe(0);
    await expect(page.locator("body")).not.toContainText(confirmationToken);

    await page.setViewportSize({ width: 360, height: 640 });
    await expectNoHorizontalOverflow(page);
    const confirmButton = page.getByRole("button", { name: "Confirm my waitlist place" });
    await expect(confirmButton).toBeEnabled();
    await expectMinimumTapTargets(confirmButton);
    await confirmButton.scrollIntoViewIfNeeded();
    await expectFullyInViewport(page, confirmButton);
    await confirmButton.click();
    expect(confirmationPosts).toBe(1);
    await expect(page.getByRole("heading", {
      name: "You are on the YOVA waitlist.",
    })).toBeVisible();
    const backToProfile = page.getByRole("link", { name: "Back to Study Profile" });
    await expectMinimumTapTargets(backToProfile);
    await backToProfile.scrollIntoViewIfNeeded();
    await expectFullyInViewport(page, backToProfile);
    await expectNoHorizontalOverflow(page);
    await expect(page).toHaveURL("/study-profile/waitlist/confirm");
  });

  test("routes public Study Profile support and privacy requests to hello@yovaapp.com", async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto("/study-profile");
    await expect(page.getByRole("link", { name: "Email support" }))
      .toHaveAttribute("href", STUDY_PROFILE_SUPPORT_MAILTO);
    await expect(page.getByRole("link", { name: "Privacy Notice" })).toHaveCount(2);

    await page.goto("/privacy");
    const privacyContact = page.getByRole("link", { name: "hello@yovaapp.com" });
    await expect(privacyContact).toHaveAttribute("href", PRIVACY_REQUEST_MAILTO);
    await expect(page.getByText("YOVA privacy or deletion request", { exact: false })).toBeVisible();
  });

  test("keeps every pre-report screen usable on common phone widths", async ({ browser }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile-chromium", "Mobile-only geometry coverage.");
    test.setTimeout(120_000);
    for (const width of [320, 360, 390, 430]) {
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
        const landingHeading = viewportPage.getByRole("heading", {
          name: "Find out how you actually study.",
        });
        await expect(landingHeading).toBeVisible();
        await expect(landingHeading).toHaveCSS("text-align", "center");
        await expectNoHorizontalOverflow(viewportPage);

        const startButton = viewportPage
          .getByRole("button", { name: "Get my free study profile" })
          .first();
        await expectMinimumTapTargets(startButton);
        await startButton.tap();

        await expectOnlyQuestion(viewportPage, 1);
        await expect(viewportPage.locator("main section h1").first())
          .toHaveCSS("text-align", "center");
        await expect(viewportPage.getByText("Question 1 of 14", { exact: true }))
          .toHaveCSS("text-align", "center");
        const firstAnswers = viewportPage
          .getByRole("radiogroup", { name: "Answers for question 1" })
          .getByRole("radio");
        await expectMinimumTapTargets(firstAnswers);
        await expect(firstAnswers.first()).toHaveCSS("text-align", "center");
        await expectNoHorizontalOverflow(viewportPage);
        await firstAnswers.first().tap();
        for (let questionNumber = 2; questionNumber <= 12; questionNumber += 1) {
          await answerQuestion(viewportPage, questionNumber, 0);
        }

        await expectStudyGoalStep(viewportPage);
        await expect(viewportPage.getByRole("heading", {
          name: "What are you mainly studying for right now?",
        })).toHaveCSS("text-align", "center");
        const goalOptions = viewportPage.locator("main section button").filter({
          has: viewportPage.locator("small"),
        });
        await expectSingleColumn(goalOptions);
        await expectMinimumTapTargets(goalOptions);
        await expect(goalOptions.first()).toHaveCSS("text-align", "center");
        await expectNoElementOverlap(goalOptions);
        await expectNoHorizontalOverflow(viewportPage);
        await viewportPage.getByRole("button", { name: /^Exams coming up/ }).tap();

        await expectCombinedContextStep(viewportPage);
        await expect(viewportPage.getByRole("heading", {
          name: "One last bit of context.",
        })).toHaveCSS("text-align", "center");
        const contextOptions = viewportPage.locator("fieldset button");
        await expectMinimumTapTargets(contextOptions);
        await expectNoElementOverlap(contextOptions);
        await expectNoHorizontalOverflow(viewportPage);
        await viewportPage.getByRole("button", { name: "Morning", exact: true }).tap();
        await viewportPage.getByRole("button", { name: "High school", exact: true }).tap();
        const finishButton = viewportPage.getByRole("button", {
          name: "Finish my profile",
        });
        await expectMinimumTapTargets(finishButton);
        await finishButton.tap();

        await expectLockedReveal(viewportPage);
        await expectNoHorizontalOverflow(viewportPage);
        const emailGate = viewportPage.getByRole("heading", {
          name: "Your study pattern is ready.",
        }).locator("..");
        await expect(emailGate).toHaveCSS("text-align", "center");
        const resultStatus = viewportPage.getByText("Your results are ready", { exact: true });
        await expectHorizontallyCenteredWithin(resultStatus, emailGate);
        const unlockList = viewportPage.getByLabel("Full report includes");
        await expectHorizontallyCenteredWithin(unlockList, emailGate);
        await expect(unlockList).toHaveCSS("text-align", "left");
        await expect(viewportPage.getByRole("checkbox", { name: "I am under 18." }))
          .toHaveCount(0);
        const emailInput = viewportPage.getByLabel("Email for your confirmation link");
        await expect.poll(async () => emailInput.evaluate((element) => (
          Number.parseFloat(window.getComputedStyle(element).fontSize)
        ))).toBeGreaterThanOrEqual(16);
        const ageLabel = viewportPage.locator("label").filter({
          has: viewportPage.getByRole("checkbox", { name: "I confirm I am 13 or older." }),
        });
        const waitlistLabel = viewportPage.locator("label").filter({
          has: viewportPage.getByRole("checkbox", { name: /Confirm my place on the YOVA waitlist/ }),
        });
        await expectMinimumTapTargets(ageLabel);
        await expectMinimumTapTargets(waitlistLabel);
        await expectMinimumTapTargets(
          viewportPage.getByRole("button", { name: "Send my confirmation link" }),
        );

        await viewportPage.setViewportSize({ width, height: 480 });
        await emailInput.focus();
        await emailInput.scrollIntoViewIfNeeded();
        await expectFullyInViewport(viewportPage, emailInput);
        const submitButton = viewportPage.getByRole("button", {
          name: "Send my confirmation link",
        });
        await submitButton.scrollIntoViewIfNeeded();
        await expectFullyInViewport(viewportPage, submitButton);
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

  test("clears expired, future-dated, and timestamp-free browser drafts", async ({ page }) => {
    for (const savedAt of [Date.now() - (8 * 24 * 60 * 60 * 1000), Date.now() + 60_000, null]) {
      await page.goto("/study-profile");
      await page.evaluate(({ key, timestamp }) => {
        window.localStorage.setItem(key, JSON.stringify({
          version: "study_profile_draft_v2",
          view: "question",
          currentQuestion: 5,
          answers: { q1: "a", q2: "b" },
          metadata: {},
          ...(timestamp === null ? {} : { savedAt: timestamp }),
        }));
      }, { key: DRAFT_STORAGE_KEY, timestamp: savedAt });

      await page.reload();
      await expect(page.getByRole("heading", {
        name: "Find out how you actually study.",
      })).toBeVisible();
      await expect.poll(() => page.evaluate((key) => (
        window.localStorage.getItem(key)
      ), DRAFT_STORAGE_KEY)).toBeNull();
    }
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
  await page.getByRole("button", { name: "Finish my profile" }).click();
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
  const keyboardHint = page.getByText("Keyboard: press 1 to 4, A to D, or use arrow keys");
  await expect(keyboardHint).toHaveText("Keyboard: press 1 to 4, A to D, or use arrow keys");
  const usesCoarsePointer = await page.evaluate(() => window.matchMedia("(pointer: coarse)").matches);
  if (usesCoarsePointer) await expect(keyboardHint).toBeHidden();
  else await expect(keyboardHint).toBeVisible();
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

async function expectLockedReveal(page: Page) {
  const progress = page.getByRole("progressbar", { name: "Study Profile progress" });
  await expect(progress).toHaveAttribute("aria-valuemax", "14");
  await expect(progress).toHaveAttribute("aria-valuenow", "14");
  await expect(progress).toHaveAttribute("aria-valuetext", "Profile complete");
  const heading = page.getByRole("heading", {
    name: "Your study pattern is ready.",
  });
  await expect(heading).toBeVisible();
  await expect(heading).toBeFocused();
  await expect(page.locator("#report-title")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /^You are The .+\.$/ })).toHaveCount(0);
  await expect(page.getByLabel("Your six study habits")).toHaveCount(0);
  await expect(page.getByText("One thing your answers show", { exact: true })).toHaveCount(0);
  await expect(page.getByText("The report is yours either way.", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Your named study pattern", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Email for your confirmation link")).toHaveValue("");
  await expect(page.getByRole("checkbox", {
    name: /Confirm my place on the YOVA waitlist/,
  })).not.toBeChecked();
  await expect(page.getByRole("checkbox", { name: "I am under 18." })).toHaveCount(0);
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

async function expectMinimumTapTargets(locator: Locator, minimum = 44) {
  const sizes = await locator.evaluateAll((elements) => elements
    .filter((element) => {
      const htmlElement = element as HTMLElement;
      const style = window.getComputedStyle(htmlElement);
      return style.display !== "none" && style.visibility !== "hidden";
    })
    .map((element) => {
      const bounds = element.getBoundingClientRect();
      return { width: bounds.width, height: bounds.height, text: element.textContent?.trim() ?? "" };
    }));

  expect(sizes.length).toBeGreaterThan(0);
  for (const size of sizes) {
    expect(size.width, `Tap target is too narrow: ${size.text}`).toBeGreaterThanOrEqual(minimum);
    expect(size.height, `Tap target is too short: ${size.text}`).toBeGreaterThanOrEqual(minimum);
  }
}

async function expectNoElementOverlap(locator: Locator) {
  const boxes = await locator.evaluateAll((elements) => elements.map((element) => {
    const bounds = element.getBoundingClientRect();
    return { left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom };
  }));

  for (let firstIndex = 0; firstIndex < boxes.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < boxes.length; secondIndex += 1) {
      const first = boxes[firstIndex];
      const second = boxes[secondIndex];
      const overlapsHorizontally = first.left < second.right - 1 && first.right > second.left + 1;
      const overlapsVertically = first.top < second.bottom - 1 && first.bottom > second.top + 1;
      expect(overlapsHorizontally && overlapsVertically).toBe(false);
    }
  }
}

async function expectSingleColumn(locator: Locator) {
  const boxes = await locator.evaluateAll((elements) => elements.map((element) => {
    const bounds = element.getBoundingClientRect();
    return { left: bounds.left, width: bounds.width, top: bounds.top, bottom: bounds.bottom };
  }));

  expect(boxes.length).toBeGreaterThan(0);
  for (let index = 0; index < boxes.length; index += 1) {
    expect(Math.abs(boxes[index].left - boxes[0].left)).toBeLessThanOrEqual(1);
    expect(Math.abs(boxes[index].width - boxes[0].width)).toBeLessThanOrEqual(1);
    if (index > 0) expect(boxes[index].top).toBeGreaterThanOrEqual(boxes[index - 1].bottom - 1);
  }
}

async function expectFullyInViewport(page: Page, locator: Locator) {
  const box = await locator.boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  expect(viewport).not.toBeNull();
  if (!box || !viewport) return;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
}

async function expectHorizontallyCenteredWithin(
  element: Locator,
  container: Locator,
  tolerance = 2,
) {
  const elementBox = await element.boundingBox();
  const containerBox = await container.boundingBox();
  expect(elementBox).not.toBeNull();
  expect(containerBox).not.toBeNull();
  if (!elementBox || !containerBox) return;
  const elementCenter = elementBox.x + elementBox.width / 2;
  const containerCenter = containerBox.x + containerBox.width / 2;
  expect(Math.abs(elementCenter - containerCenter)).toBeLessThanOrEqual(tolerance);
}
