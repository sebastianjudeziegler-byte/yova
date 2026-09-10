import { expect, test, type Locator, type Page, type Route } from "@playwright/test";
import { createRequire } from "node:module";

const requireFromTest = createRequire(__filename);
const requireFromNextLint = createRequire(requireFromTest.resolve("eslint-config-next"));
const jsxA11yPackagePath = requireFromNextLint.resolve("eslint-plugin-jsx-a11y/package.json");
const axePath = createRequire(jsxA11yPackagePath).resolve("axe-core/axe.min.js");

const HEADING = "Studying that adapts to how you actually learn.";
const WAITLIST_ROUTE = "**/api/study-profile/waitlist";
const pendingReceipt = { confirmationPending: true, waitlistJoined: false, dailyCapReached: false };
const forms = [
  { name: "Join the waitlist", formName: "Join the YOVA waitlist", section: "#join", idPrefix: "landing-hero" },
  { name: "Hold my founding place", formName: "Hold your founding place", section: "#founding", idPrefix: "landing-footer" },
] as const;

for (const { name, formName, section, idPrefix } of forms) {
  test(`${name} requires a valid email and every affirmation before requesting confirmation`, async ({ page }) => {
    let requestBody: Record<string, unknown> | null = null;
    let releaseResponse = () => {};
    const responseGate = new Promise<void>((resolve) => { releaseResponse = resolve; });
    await page.route(WAITLIST_ROUTE, async (route) => {
      expect(route.request().method()).toBe("POST");
      requestBody = route.request().postDataJSON() as Record<string, unknown>;
      await responseGate;
      await json(route, 200, pendingReceipt);
    });
    await page.goto("/?utm_source=landing-test&utm_campaign=founding-waitlist");
    const form = page.getByRole("form", { name: formName, exact: true });
    const button = form.getByRole("button", { name, exact: true });
    const email = form.getByRole("textbox", { name: "Email address", exact: true });
    const checkboxes = form.getByRole("checkbox");
    await expect(form).toBeVisible();
    await expect(email).toHaveAttribute("id", `${idPrefix}-email`);
    await expect(email).toHaveAttribute("type", "email");
    await expect(email).toHaveAttribute("autocomplete", "email");
    await expect(button).toBeDisabled();
    await email.fill("not-an-email");
    const checkboxCount = await checkboxes.count();
    expect(checkboxCount).toBeGreaterThanOrEqual(1);
    expect(checkboxCount).toBeLessThanOrEqual(2);
    if (idPrefix === "landing-footer") expect(checkboxCount).toBe(2);
    for (const checkbox of await checkboxes.all()) {
      await expect(checkbox).not.toBeChecked();
      await checkbox.check();
    }
    await expect(button).toBeDisabled();
    await email.fill("student@example.com");
    await expect(button).toBeEnabled();
    for (const checkbox of await checkboxes.all()) {
      await checkbox.uncheck();
      await expect(button).toBeDisabled();
      await checkbox.check();
    }
    expect(requestBody).toBeNull();

    await button.click();
    await expect(form.getByRole("button", { name: "Sending…", exact: true })).toBeDisabled();
    await expect.poll(() => requestBody).toMatchObject({
      email: "student@example.com",
      consent: true,
      ageConfirmed: true,
      under18: false,
      visitorId: expect.stringMatching(/^[a-f0-9-]{36}$/i),
      attribution: {
        utmSource: "landing-test",
        utmCampaign: "founding-waitlist",
      },
    });
    releaseResponse();

    await expect(form).toHaveCount(0);
    const receipt = page.locator(section).getByRole("status");
    await expect(receipt).toContainText("Check your inbox.");
    await expect(receipt).toContainText("We sent a confirmation link to student@example.com.");
    await expect(page.getByRole("form")).toHaveCount(1);
  });
}

for (const outcome of [
  { name: "already confirmed", payload: { waitlistJoined: true }, heading: "You are on the list." },
  { name: "daily email cap", payload: { dailyCapReached: true }, heading: "Try again later." },
]) {
  test(`shows the ${outcome.name} receipt without leaving a resubmittable form`, async ({ page }) => {
    await page.route(WAITLIST_ROUTE, (route) => json(route, 200, outcome.payload));
    await page.goto("/");
    const form = page.getByRole("form", { name: "Hold your founding place", exact: true });
    await fillWaitlistForm(form);
    await form.getByRole("button", { name: "Hold my founding place", exact: true }).click();
    await expect(form).toHaveCount(0);
    await expect(page.locator("#founding").getByRole("status")).toContainText(outcome.heading);
    await expect(page.locator("#founding").getByText("Check your inbox.")).toHaveCount(0);
  });
}

for (const failure of ["service error", "malformed receipt", "network error"] as const) {
  test(`keeps the email and consent available to retry after a ${failure}`, async ({ page }) => {
    let attempts = 0;
    await page.route(WAITLIST_ROUTE, async (route) => {
      attempts += 1;
      if (attempts > 1) return json(route, 200, pendingReceipt);
      if (failure === "network error") return route.abort("failed");
      if (failure === "service error") return json(route, 503, { error: "Waitlist signup is temporarily unavailable." });
      return json(route, 200, {});
    });
    await page.goto("/");
    const form = page.getByRole("form", { name: "Join the YOVA waitlist", exact: true });
    await fillWaitlistForm(form);
    const button = form.getByRole("button", { name: "Join the waitlist", exact: true });
    await button.click();
    await expect(form.getByRole("alert")).toBeVisible();
    if (failure === "service error") {
      await expect(form.getByRole("alert")).toHaveText("Waitlist signup is temporarily unavailable.");
    }
    await expect(form.getByRole("textbox", { name: "Email address" })).toHaveValue("student@example.com");
    for (const checkbox of await form.getByRole("checkbox").all()) await expect(checkbox).toBeChecked();
    await expect(button).toBeEnabled();
    await expect(page.locator("#join").getByRole("status")).toHaveCount(0);
    await button.click();
    await expect(page.locator("#join").getByRole("status")).toContainText("Check your inbox.");
    expect(attempts).toBe(2);
  });
}

test("keeps the section links, Study Profile bridge, skip link and native FAQ usable by keyboard", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: HEADING, level: 1 })).toBeVisible();
  await expect(page.locator("h1 em")).toHaveText("actually");
  for (const [name, href] of [
    ["How it adapts", "#how"],
    ["Your profile", "#session"],
    ["FAQ", "#faq"],
    ["Join the waitlist", "#join"],
  ] as const) {
    await expect(page.getByRole("link", { name, exact: true })).toHaveAttribute("href", href);
  }
  await expect(page.getByRole("link", { name: "Study Profile FREE", exact: true })).toHaveAttribute("href", "/study-profile");
  await expect(page.getByRole("link", { name: "Take the Study Profile", exact: true })).toHaveAttribute("href", "/study-profile");
  const skipLink = page.getByRole("link", { name: "Skip to main content", exact: true });
  await skipLink.focus();
  await expect(skipLink).toBeVisible();
  await skipLink.press("Enter");
  await expect(page.locator("main")).toBeFocused();

  const questions = page.locator("#faq details");
  await expect(questions).toHaveCount(6);
  const firstQuestion = questions.first();
  const summary = firstQuestion.locator("summary");
  await expect(summary).toHaveText("Is this a learning-styles test?");
  await expect(firstQuestion).not.toHaveAttribute("open", "");
  await summary.focus();
  await summary.press("Enter");
  await expect(firstQuestion).toHaveAttribute("open", "");
  await expect(firstQuestion.locator("p")).toContainText("The Study Profile records habits");
  await summary.press("Space");
  await expect(firstQuestion).not.toHaveAttribute("open", "");
});

test("stops the session-preview pulse when reduced motion is requested", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  const preview = page.locator('[aria-label="Example adapted YOVA session"]');
  await expect(preview).toBeVisible();
  await expect.poll(() => preview.evaluate((element) => element.getAnimations({ subtree: true })
    .filter((animation) => animation.playState === "running").length)).toBeGreaterThan(0);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect.poll(() => preview.evaluate((element) => element.getAnimations({ subtree: true })
    .filter((animation) => animation.playState === "running").length)).toBe(0);
});

test("contains the layout on narrow phones and lets the comparison table scroll", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes("mobile"), "Narrow viewport coverage runs in the mobile project.");
  for (const width of [320, 375, 430]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await expect(page.getByRole("form", { name: "Join the YOVA waitlist", exact: true })).toBeVisible();
    const dimensions = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      content: document.documentElement.scrollWidth,
    }));
    expect(dimensions.content, `Page overflow at ${width}px`).toBeLessThanOrEqual(dimensions.viewport + 1);
    const table = page.getByRole("table");
    await expect(table.getByRole("row")).toHaveCount(7);
    const tableScrolls = await table.evaluate((element) => {
      const container = element.parentElement;
      if (!container) return false;
      container.scrollLeft = 100;
      return container.scrollWidth > container.clientWidth
        && container.scrollLeft > 0
        && ["auto", "scroll"].includes(getComputedStyle(container).overflowX);
    });
    expect(tableScrolls, `Comparison table scrolling at ${width}px`).toBe(true);
  }
});

test("the landing has no serious WCAG A/AA accessibility violations", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("form", { name: "Join the YOVA waitlist", exact: true })).toBeVisible();
  await page.locator("#faq summary").first().click();
  await expectAxeClean(page);
});

async function fillWaitlistForm(form: Locator) {
  await form.getByRole("textbox", { name: "Email address", exact: true }).fill("student@example.com");
  for (const checkbox of await form.getByRole("checkbox").all()) await checkbox.check();
}

async function json(route: Route, status: number, body: unknown) {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

async function expectAxeClean(page: Page) {
  await page.addScriptTag({ path: axePath });
  const violations = await page.evaluate(async () => {
    const axe = (window as unknown as {
      axe: {
        run: (context: Document, options: Record<string, unknown>) => Promise<{
          violations: Array<{
            id: string;
            impact: string | null;
            help: string;
            nodes: Array<{ target: string[]; failureSummary?: string }>;
          }>;
        }>;
      };
    }).axe;
    const result = await axe.run(document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
    });
    return result.violations.filter(({ impact }) => impact === "critical" || impact === "serious");
  });
  expect(violations, "Landing accessibility violations").toEqual([]);
}
