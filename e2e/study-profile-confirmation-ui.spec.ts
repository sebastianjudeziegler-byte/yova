import { expect, test, type Locator, type Page } from "@playwright/test";

const CONFIRMATION_PATH = "/study-profile/waitlist/confirm";
const CONFIRMATION_TOKEN = "c".repeat(43);
const REPORT_TOKEN = "r".repeat(43);
const REPORT_PATH = `/study-profile/report/${REPORT_TOKEN}`;
const VIEWPORT_WIDTHS = [1440, 320, 390, 430];

type MockResponse = { status: number; body: Record<string, unknown> };

test.describe("Study Profile confirmation UI", () => {
  test("keeps a report-bound link private and waits for an explicit confirmation", async ({ page }) => {
    const requests = await mockConfirmation(page, () => ({
      status: 200,
      body: {
        waitlistJoined: true,
        reportUnlocked: true,
        reportUrl: REPORT_PATH,
        responseId: "11111111-1111-4111-8111-111111111111",
      },
    }));
    await page.route(`**${REPORT_PATH}`, (route) => route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<!doctype html><html><body><h1>Unlocked report</h1></body></html>",
    }));

    await page.goto(`${CONFIRMATION_PATH}#token=${CONFIRMATION_TOKEN}&report=${REPORT_TOKEN}`);
    const cta = page.getByRole("button", { name: "Confirm and view my results" });
    await expect(cta).toBeEnabled();
    await expect(page).toHaveURL(CONFIRMATION_PATH);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Confirm your place and unlock your report.");
    await expectResponsiveCard(page, cta);
    await expectKeyboardFocus(page, cta);
    expect(requests).toEqual([]);

    await cta.click();
    await expect(page).toHaveURL(REPORT_PATH);
    await expect(page.getByRole("heading", { name: "Unlocked report" })).toBeVisible();
    expect(requests).toEqual([{ token: CONFIRMATION_TOKEN, reportToken: REPORT_TOKEN }]);
  });

  test("shows the standalone waitlist success state without claiming to unlock a report", async ({ page }) => {
    const requests = await mockConfirmation(page, () => ({ status: 200, body: { waitlistJoined: true } }));
    await page.goto(`${CONFIRMATION_PATH}#token=${CONFIRMATION_TOKEN}`);
    const confirm = page.getByRole("button", { name: "Confirm my waitlist place" });
    await expect(confirm).toBeEnabled();
    await expect(page).toHaveURL(CONFIRMATION_PATH);
    expect(requests).toEqual([]);

    await confirm.click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("You are on the YOVA waitlist.");
    const cta = page.getByRole("link", { name: "Back to Study Profile", exact: true });
    await expect(cta).toHaveAttribute("href", "/study-profile");
    await expectResponsiveCard(page, cta);
    await expectKeyboardFocus(page, cta);
    await expect(page).toHaveURL(CONFIRMATION_PATH);
    expect(requests).toEqual([{ token: CONFIRMATION_TOKEN }]);
  });

  test("provides a usable recovery action for an invalid link without making a request", async ({ page }) => {
    const requests = await mockConfirmation(page, () => ({ status: 400, body: {} }));
    await page.goto(`${CONFIRMATION_PATH}#token=incomplete&report=${REPORT_TOKEN}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("This link is incomplete.");
    await expect(page).toHaveURL(CONFIRMATION_PATH);
    const cta = page.getByRole("link", { name: "Go to Study Profile", exact: true });
    await expect(cta).toHaveAttribute("href", "/study-profile");
    await expectResponsiveCard(page, cta);
    await expectKeyboardFocus(page, cta);
    expect(requests).toEqual([]);
  });

  test("exposes an accessible failure and allows an explicit retry", async ({ page }) => {
    const requests = await mockConfirmation(page, (attempt) => attempt === 1
      ? { status: 503, body: { error: "Please try confirming again." } }
      : { status: 200, body: { waitlistJoined: true } });
    await page.goto(`${CONFIRMATION_PATH}#token=${CONFIRMATION_TOKEN}`);
    const cta = page.getByRole("button", { name: "Confirm my waitlist place" });
    await expect(cta).toBeEnabled();
    expect(requests).toEqual([]);

    await cta.click();
    const error = page.locator('section[aria-labelledby="confirmation-heading"]').getByRole("alert");
    await expect(error).toHaveText("Please try confirming again.");
    await expect(cta).toBeEnabled();
    await expectResponsiveCard(page, cta);
    await expectKeyboardFocus(page, cta);
    await expect(page).toHaveURL(CONFIRMATION_PATH);
    expect(requests).toHaveLength(1);

    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("You are on the YOVA waitlist.");
    await expect(error).toHaveCount(0);
    expect(requests).toEqual([{ token: CONFIRMATION_TOKEN }, { token: CONFIRMATION_TOKEN }]);
  });
});

async function mockConfirmation(page: Page, response: (attempt: number) => MockResponse) {
  const requests: unknown[] = [];
  await page.route("**/api/study-profile/waitlist/confirm", async (route) => {
    expect(route.request().method()).toBe("POST");
    requests.push(route.request().postDataJSON());
    const result = response(requests.length);
    await route.fulfill({ status: result.status, contentType: "application/json", body: JSON.stringify(result.body) });
  });
  return requests;
}

async function expectResponsiveCard(page: Page, cta: Locator) {
  const card = page.locator('section[aria-labelledby="confirmation-heading"]');
  for (const width of VIEWPORT_WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await expect(card).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveCSS("font-weight", "400");
    expect(await card.evaluate((element) => Number.parseFloat(getComputedStyle(element).borderTopLeftRadius))).toBeGreaterThan(0);
    await expect(cta).toBeVisible();
    const bounds = await cta.boundingBox();
    expect(bounds?.height, `CTA touch target at ${width}px`).toBeGreaterThanOrEqual(44);
    expect(bounds?.x, `CTA left edge at ${width}px`).toBeGreaterThanOrEqual(0);
    expect((bounds?.x ?? 0) + (bounds?.width ?? 0), `CTA right edge at ${width}px`).toBeLessThanOrEqual(width);
    expect(await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth), `Horizontal overflow at ${width}px`).toBeLessThanOrEqual(1);
  }
}

async function expectKeyboardFocus(page: Page, cta: Locator) {
  await page.getByRole("link", { name: "YOVA home", exact: true }).focus();
  const unfocusedShadow = await cta.evaluate((element) => getComputedStyle(element).boxShadow);
  for (let step = 0; step < 8; step += 1) {
    await page.keyboard.press("Tab");
    if (await cta.evaluate((element) => element === document.activeElement)) break;
  }
  await expect(cta).toBeFocused();
  expect(await cta.evaluate((element, previousShadow) => {
    const style = getComputedStyle(element);
    const outlineVisible = Number.parseFloat(style.outlineWidth) > 0
      && style.outlineStyle !== "none"
      && style.outlineColor !== "transparent"
      && !style.outlineColor.endsWith(", 0)");
    return element.matches(":focus-visible")
      && (outlineVisible || (style.boxShadow !== "none" && style.boxShadow !== previousShadow));
  }, unfocusedShadow), "Keyboard focus has a visible outline or an added focus shadow").toBe(true);
}
