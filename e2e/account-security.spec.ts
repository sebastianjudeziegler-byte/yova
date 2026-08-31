import { expect, test, type Page } from "@playwright/test";

const onboardingAnswers = [
  "Show a short recommendation and alternatives",
  "I delay a little, then get going",
  "20 to 30 minutes",
  "A concrete example before the rule",
  "Recalling it without notes, then checking",
  "I recognize it but cannot recall it",
  "Give me a small hint",
  "Show one step at a time",
  "Clear checkpoints inside the block",
  "No extra support right now",
  "Afternoon",
] as const;

test("makes account personalization visible, editable, persistent, and mobile-safe", async ({ page }) => {
  await openPreviewYouScreen(page, "Learner");

  await expect(page.getByRole("heading", { name: "Your YOVA account" })).toBeVisible();
  await expect(page.getByText("Browser preview", { exact: true })).toBeVisible();
  await expect(page.getByText("Browser preview data", { exact: true })).toBeVisible();
  await expect(page.getByText(/does not create a cloud account archive/i)).toBeVisible();
  await expect(page.getByRole("button", { name: "Download my YOVA data" })).toHaveCount(0);
  await expect(page.locator('a[download^="yova-data-"]')).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Set or change password" })).toHaveCount(0);

  await page.getByRole("button", { name: "Edit first name" }).click();
  const firstName = page.locator("#account-security-first-name");
  await expect(firstName).toBeFocused();
  await expect(firstName).toHaveAttribute("autocomplete", "given-name");
  await firstName.fill("Ada");
  await page.getByRole("button", { name: "Save first name" }).click();
  await expect(page.getByRole("status")).toHaveText("First name saved.");

  await page.getByRole("button", { name: "Home", exact: true }).click();
  await expect(page.getByRole("heading", { name: /^Good (morning|afternoon|evening), Ada$/ })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: /^Good (morning|afternoon|evening), Ada$/ })).toBeVisible();

  await page.getByRole("button", { name: "You", exact: true }).click();
  const overflow = await page.locator(".page").evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
});

test("explains the self-service export scope and the downloaded-copy boundary", async ({ page }) => {
  await page.goto("/privacy");

  await expect(page.getByRole("heading", { name: "4. Your controls" })).toBeVisible();
  await expect(page.getByText(/Download my YOVA data.*portable JSON copy/)).toBeVisible();
  await expect(page.getByText(/sanitized service-usage counters/)).toBeVisible();
  await expect(page.getByText(/not the original uploaded files/)).toBeVisible();
  await expect(page.getByText(/resetting or deleting data in YOVA cannot remove that downloaded copy/)).toBeVisible();
});

test("clears signed-in UI after confirmed sign-out even when preview storage removal throws", async ({ page }) => {
  await openPreviewYouScreen(page, "Learner");
  await page.evaluate(() => {
    const originalRemoveItem = Storage.prototype.removeItem;
    Storage.prototype.removeItem = function removeItem(key: string) {
      if (key === "yova.preview.v1") throw new Error("simulated browser cleanup failure");
      return originalRemoveItem.call(this, key);
    };
  });

  await page.getByRole("button", { name: "Sign out on this device" }).last().click();

  await expect(page.getByRole("heading", { name: "Know what to study next." })).toBeVisible();
  await expect(page.getByText("Signed out with a browser cleanup warning", { exact: true })).toBeVisible();
  await expect(page.getByText(/could not remove all recovery data saved in this browser/i)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Your YOVA account" })).toHaveCount(0);
});

async function openPreviewYouScreen(page: Page, displayName: string) {
  await page.goto("/?qa=preview");
  await page.getByRole("button", { name: "Build my plan" }).click();
  await page.getByLabel("First name").fill(displayName);
  await page.getByLabel("Email address").fill("account-security@example.com");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: /Personalize YOVA/ }).click();
  for (const [index, answer] of onboardingAnswers.entries()) {
    await page.getByRole("button", { name: answer, exact: true }).click();
    await page.getByRole("button", {
      name: index === onboardingAnswers.length - 1 ? "Build my setup" : "Continue",
    }).click();
  }
  await page.getByRole("button", { name: "Open YOVA" }).click();
  await page.getByRole("button", { name: "You", exact: true }).click();
}
