import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";

const PUBLIC_DRAFT_STORAGE_KEY = "yova.canonical-profile.public-draft.v1";
const LEGACY_DRAFT_STORAGE_KEY = "yova.study-profile.draft.v1";
const QUESTION_COUNT = 11;
const STUDY_PROFILE_SUPPORT_MAILTO = "mailto:hello@yovaapp.com?subject=YOVA%20Study%20Profile%20support";
const PRIVACY_REQUEST_MAILTO = "mailto:hello@yovaapp.com?subject=YOVA%20privacy%20or%20deletion%20request";

test.describe("YOVA canonical Study Profile", () => {
  test("builds the canonical 11-question profile, imports it into an account, and skips duplicate onboarding", async ({ page }, testInfo) => {
    const email = `canonical-profile-${testInfo.project.name}-${Date.now()}@example.com`;

    await page.goto("/study-profile?utm_source=playwright&utm_campaign=canonical-profile-e2e");

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
    await page.goto("/study-profile");
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
    await page.reload();
    await page.getByRole("button", { name: "Build my study profile" }).click();

    await expectQuestion(page, 1);
    await expect(page.getByRole("button", {
      name: "Show a short recommendation and alternatives",
    })).toHaveAttribute("aria-pressed", "true");

    await page.evaluate((key) => {
      window.localStorage.setItem(key, JSON.stringify({ signals: "forged" }));
    }, PUBLIC_DRAFT_STORAGE_KEY);
    await page.reload();
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

    await page.goto("/study-profile");
    await page.getByRole("button", { name: "Build my study profile" }).click();
    await finishBySkipping(page);

    await expect(page.getByRole("heading", { name: "How YOVA will work with you" })).toBeVisible();
    await expect(page.getByRole("alert").filter({
      hasText: "This browser blocked local storage",
    })).toBeVisible();
    await expect(page.getByRole("link", { name: "Use this profile in YOVA" })).toBeVisible();
  });

  test("exposes semantic progress, pressed choices, and predictable keyboard focus", async ({ page }) => {
    await page.goto("/study-profile");
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

  test("keeps landing, questionnaire, and summary inside narrow mobile viewports", async ({ page }) => {
    for (const width of [320, 375, 390]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto("/study-profile");
      await expect(page.getByRole("heading", {
        name: "Tell YOVA how you want to work together.",
      })).toBeVisible();
      await expectNoHorizontalOverflow(page);

      await page.getByRole("button", { name: "Build my study profile" }).click();
      await expectQuestion(page, 1);
      await expectNoHorizontalOverflow(page);
    }

    await finishBySkipping(page);
    await expect(page.getByRole("heading", { name: "How YOVA will work with you" })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test("keeps saved legacy token reports available through their direct API and private route", async ({ page }, testInfo) => {
    test.setTimeout(60_000);
    const email = `legacy-report-${testInfo.project.name}-${Date.now()}@example.com`;
    await page.goto("/study-profile");
    const origin = new URL(page.url()).origin;
    const submission = await page.request.post("/api/study-profile/responses", {
      headers: {
        Origin: origin,
        Referer: `${origin}/study-profile`,
      },
      data: {
        visitorId: randomUUID(),
        email,
        answers: Object.fromEntries(
          Array.from({ length: 12 }, (_, index) => [`q${index + 1}`, ["a", "b", "c", "d"][index % 4]]),
        ),
        metadata: {
          energyWindow: "afternoon",
          schoolLevel: "college",
          hardestPart: null,
        },
        marketingConsent: false,
        attribution: {
          source: "playwright-direct-report-fixture",
          utmCampaign: "canonical-profile-migration",
        },
      },
    });

    expect(submission.status()).toBe(201);
    const created = await submission.json() as {
      reportToken: string;
      reportUrl: string;
      emailDelivery: "sent" | "skipped" | "failed";
    };
    expect(created.reportToken).toMatch(/^[A-Za-z0-9_-]{32,}$/);
    const reportUrl = new URL(created.reportUrl);
    expect(reportUrl.search).toBe("");
    expect(reportUrl.hash).toBe("");
    expect(decodeURIComponent(reportUrl.href)).not.toContain(email);

    await page.goto(reportUrl.pathname);
    await expect(page.locator("#report-title")).toBeVisible();
    await expect(page.locator("body")).not.toContainText(email);
    await expectLegacyReportSections(page);
    await expectReadableLegacyMethodCards(page);
    await expect(page.getByRole("link", { name: "Email support" }))
      .toHaveAttribute("href", STUDY_PROFILE_SUPPORT_MAILTO);

    await page.reload();
    await expect(page).toHaveURL(reportUrl.pathname);
    await expect(page.locator("#report-title")).toBeVisible();
    await expectLegacyReportSections(page);

    const waitlist = await page.request.post(`/api/study-profile/interest/${created.reportToken}`, {
      headers: {
        Origin: origin,
        Referer: `${origin}${reportUrl.pathname}`,
      },
      data: { waitlist: true },
    });
    expect(waitlist.status()).toBe(200);
    await expect(waitlist.json()).resolves.toMatchObject({ waitlistJoined: true });
    await page.reload();
    await expect(page.getByRole("status")).toContainText("You’re on the waitlist");
    await expect(page.getByRole("button", { name: "Join the waitlist" })).toHaveCount(0);

    await page.setViewportSize({ width: 320, height: 844 });
    await expectNoHorizontalOverflow(page);

    await page.evaluate((key) => {
      window.localStorage.setItem(key, JSON.stringify({
        version: "profile_model_v1",
        view: "question",
        currentQuestion: 5,
        answers: { q1: "a", q2: "b" },
        metadata: { energyWindow: "morning", schoolLevel: "college" },
      }));
    }, LEGACY_DRAFT_STORAGE_KEY);
    await page.getByRole("link", { name: "Retake" }).click();
    await expect(page.getByRole("heading", {
      name: "Tell YOVA how you want to work together.",
    })).toBeVisible();
    await page.getByRole("button", { name: "Build my study profile" }).click();
    await expectQuestion(page, 1);
    await expect(page.locator('[role="group"] [aria-pressed="true"]')).toHaveCount(0);

    await page.goto("/privacy");
    const privacyContact = page.getByRole("link", { name: "hello@yovaapp.com" });
    await expect(privacyContact).toHaveAttribute("href", PRIVACY_REQUEST_MAILTO);
    await expect(page.getByText("YOVA privacy or deletion request", { exact: false })).toBeVisible();
  });

  test("keeps legacy private-report token failures generic through the direct API and report route", async ({ page, request }) => {
    const unknownToken = "a".repeat(43);
    const apiResponse = await request.get(`/api/study-profile/reports/${unknownToken}`);

    expect(apiResponse.status()).toBe(404);
    await expect(apiResponse.json()).resolves.toEqual({
      error: "This Study Profile report link is invalid or unavailable.",
    });

    const pageResponse = await page.goto(`/study-profile/report/${unknownToken}`);
    expect(pageResponse?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "That report link isn't available." })).toBeVisible();
    await expect(page.getByRole("link", { name: "Take the Study Profile" })).toBeVisible();
    await expect(page.locator("body")).not.toContainText(unknownToken);
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

async function expectLegacyReportSections(page: Page) {
  await expect(page.getByRole("heading", { name: "A study plan you can try today" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /^Start with a \d+ minute study block$/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Three methods to try" })).toBeVisible();
  await expect(page.getByText("Why it fits your answers", { exact: true })).toHaveCount(3);
  await expect(page.getByText("When to use it", { exact: true })).toHaveCount(3);
  await expect(page.getByText("Keep in mind", { exact: true })).toHaveCount(3);
  await expect(page.getByRole("heading", { name: "What your answers show" })).toBeVisible();
  await expect(page.locator("#primary-heading")).toBeVisible();
  await expect(page.locator("#secondary-heading")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Common traps to avoid" })).toBeVisible();
  await expect(page.locator("#first-impression-heading")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Join the YOVA waitlist" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "About your Study Profile" })).toBeVisible();
}

async function expectReadableLegacyMethodCards(page: Page) {
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
