import { expect, test, type Locator, type Page } from "@playwright/test";
import { openPreviewCalendar } from "./helpers/calendar";

async function expectTapTarget(control: Locator) {
  const box = await control.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeGreaterThanOrEqual(44);
}

async function expectContained(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

test("phone navigation stays reachable without covering the footer or chat composer", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes("mobile"), "Phone interaction coverage.");
  await openPreviewCalendar(page);
  const navigation = page.getByRole("navigation", { name: "Main navigation" });

  for (const width of [320, 375, 430, 760]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(navigation).toHaveCSS("position", "fixed");
    const navBox = await navigation.boundingBox();
    expect(navBox!.y + navBox!.height).toBeCloseTo(844, 0);
    await expect(navigation.getByRole("button")).toHaveCount(5);
    for (const button of await navigation.getByRole("button").all()) {
      await expectTapTarget(button);
      const box = await button.boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    }
    await expectContained(page);
    if (width === 375) {
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: testInfo.outputPath("calendar-phone.png") });
    }
  }

  await page.setViewportSize({ width: 320, height: 700 });
  for (const name of ["Home", "Learning", "Calendar", "You", "Ask YOVA"]) {
    const button = navigation.getByRole("button", { name, exact: true });
    await button.tap();
    await expect(button).toHaveAttribute("aria-current", "page");
  }
  const input = page.locator(".ask-composer input");
  await input.scrollIntoViewIfNeeded();
  await expect(input).toHaveCSS("font-size", "16px");
  await expectTapTarget(page.locator(".ask-composer button"));
  const inputBox = await input.boundingBox();
  const navBox = await navigation.boundingBox();
  expect(inputBox!.y + inputBox!.height).toBeLessThanOrEqual(navBox!.y);

  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const footer = page.getByRole("navigation", { name: "Trust and support" });
  const footerBox = await footer.boundingBox();
  expect(footerBox!.y + footerBox!.height).toBeLessThanOrEqual(navBox!.y);
  await page.evaluate(() => window.scrollTo(0, 0));
  await expectTapTarget(page.getByRole("button", { name: "Add to YOVA", exact: true }));
  await expectTapTarget(page.getByRole("button", { name: "Sign out on this device", exact: true }));
  await navigation.getByRole("button", { name: "Home", exact: true }).tap();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath("home-phone.png") });
});

test("keyboard viewport changes release space and restore navigation without clearing the draft", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes("mobile"), "Phone keyboard viewport coverage.");
  await openPreviewCalendar(page);
  await page.getByRole("button", { name: "Ask YOVA", exact: true }).tap();
  const input = page.locator(".ask-composer input");
  await input.fill("Help me revise this topic");

  // Browser emulation does not open a software keyboard. Exercise the actual
  // visual-viewport events used on devices, including the pinch-zoom guard.
  await page.evaluate(() => {
    const viewport = window.visualViewport!;
    Object.defineProperty(viewport, "height", { configurable: true, get: () => window.innerHeight - 300 });
    Object.defineProperty(viewport, "scale", { configurable: true, get: () => 2 });
    viewport.dispatchEvent(new Event("resize"));
  });
  const navigation = page.getByRole("navigation", { name: "Main navigation" });
  await expect(navigation).toBeVisible();
  await page.evaluate(() => {
    const viewport = window.visualViewport!;
    Object.defineProperty(viewport, "scale", { configurable: true, get: () => 1 });
    viewport.dispatchEvent(new Event("resize"));
  });
  await expect(navigation).toBeHidden();
  await expect(page.locator(".ask-composer")).toHaveCSS("position", "static");
  await expect(input).toHaveValue("Help me revise this topic");
  await page.evaluate(() => {
    const viewport = window.visualViewport!;
    Reflect.deleteProperty(viewport, "height");
    Reflect.deleteProperty(viewport, "scale");
    viewport.dispatchEvent(new Event("resize"));
  });
  await expect(navigation).toBeVisible();
  await expect(page.locator(".ask-composer")).toHaveCSS("position", "sticky");
  await expect(input).toHaveValue("Help me revise this topic");
});

test("desktop keeps its top navigation and compact controls", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes("mobile"), "Desktop regression coverage.");
  await openPreviewCalendar(page);
  const navigation = page.getByRole("navigation", { name: "Main navigation" });
  await expect(navigation).toHaveCSS("position", "static");
  await expect(navigation.locator("svg").first()).toBeHidden();
  const box = await navigation.boundingBox();
  expect(box!.y).toBeLessThan(100);
  await expect(page.getByRole("button", { name: "Sign out on this device" })).toHaveCSS("width", "30px");
  await page.screenshot({ path: testInfo.outputPath("calendar-desktop.png") });
});

test("mobile waitlist fields and consent remain comfortable at narrow widths", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes("mobile"), "Phone form coverage.");
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto("/");
  for (const form of await page.getByRole("form").all()) {
    await expect(form.getByRole("textbox", { name: "Email address" })).toHaveCSS("font-size", "16px");
    await expectTapTarget(form.getByRole("button"));
    for (const label of await form.locator("label").filter({ has: page.getByRole("checkbox") }).all()) {
      await expectTapTarget(label);
    }
  }
  await expectContained(page);
});
