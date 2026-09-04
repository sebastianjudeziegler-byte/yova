import { expect, test, type Page } from "@playwright/test";
import { createRequire } from "node:module";

const requireFromTest = createRequire(__filename);
const jsxA11yPackagePath = requireFromTest.resolve("eslint-plugin-jsx-a11y/package.json");
const axePath = createRequire(jsxA11yPackagePath).resolve("axe-core/axe.min.js");

const FIXED_NOW = new Date("2026-09-02T10:00:00.000Z");

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

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(FIXED_NOW);
});

test("the initial HTML provides useful public content without waiting for JavaScript", async ({ request }) => {
  const response = await request.get("/");
  const html = await response.text();

  expect(response.ok()).toBe(true);
  expect(html).toContain("Know what to study next.");
  expect(html).toContain("Try the free Study Profile");
  expect(html).toContain("Checking for your YOVA account");
  expect(html).not.toContain("Opening your YOVA…");
});

test("form placeholder text keeps AA contrast on public surfaces", async ({ page }) => {
  await page.goto("/support");
  const inputs = [
    page.getByPlaceholder("Example: My study plan would not open"),
    page.getByPlaceholder("Include the screen, button, and any error message you saw."),
  ];

  for (const input of inputs) {
    await expect(input).toBeVisible();
    const ratio = await input.evaluate((element) => {
      const luminance = (color: string) => {
        const channels = color.match(/[\d.]+/g)?.slice(0, 3).map(Number) ?? [];
        const linear = channels.map((channel) => {
          const value = channel / 255;
          return value <= 0.04045
            ? value / 12.92
            : ((value + 0.055) / 1.055) ** 2.4;
        });
        return (0.2126 * linear[0]) + (0.7152 * linear[1]) + (0.0722 * linear[2]);
      };
      const foreground = luminance(getComputedStyle(element, "::placeholder").color);
      const background = luminance(getComputedStyle(element).backgroundColor);
      return (Math.max(foreground, background) + 0.05)
        / (Math.min(foreground, background) + 0.05);
    });
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  }
});

test("Ask YOVA history traps focus, closes on Escape, and restores its trigger", async ({ page }) => {
  await createPreviewAccount(page);
  await completeOnboarding(page);
  await page.getByRole("button", { name: "Ask YOVA", exact: true }).click();

  const trigger = page.getByRole("button", { name: /^History/ });
  await trigger.focus();
  await trigger.click();

  const dialog = page.getByRole("dialog", { name: "Previous chats" });
  const close = dialog.getByRole("button", { name: "Close conversation history" });
  await expect(dialog).toBeVisible();
  await expect(close).toBeFocused();

  const outsideFocusWasBlocked = await page.evaluate(() => {
    const modal = document.querySelector<HTMLDialogElement>("dialog.tutor-history-modal");
    const outside = document.querySelector<HTMLButtonElement>('.topnav-tabs button[aria-label="Home"]');
    if (!modal || !outside) return false;
    outside.focus();
    return modal.contains(document.activeElement);
  });
  expect(outsideFocusWasBlocked).toBe(true);

  await page.keyboard.press("Tab");
  await expect.poll(() => dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("primary authenticated screens have no serious WCAG A/AA Axe violations", async ({ page }) => {
  await createPreviewAccount(page);
  await completeOnboarding(page);

  await expectAxeClean(page, "Home");
  for (const screen of ["Calendar", "Ask YOVA", "You"] as const) {
    await page.getByRole("button", { name: screen, exact: true }).click();
    await expectAxeClean(page, screen);
  }
});

async function expectAxeClean(page: Page, screen: string) {
  await page.addScriptTag({ path: axePath });
  const violations = await page.evaluate(async () => {
    const axe = (window as unknown as {
      axe: {
        run: (
          context: Document,
          options: Record<string, unknown>,
        ) => Promise<{
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
      runOnly: {
        type: "tag",
        values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"],
      },
    });
    return result.violations
      .filter(({ impact }) => impact === "critical" || impact === "serious")
      .map(({ id, impact, help, nodes }) => ({
        id,
        impact,
        help,
        nodes: nodes.map(({ target, failureSummary }) => ({ target, failureSummary })),
      }));
  });

  expect(violations, `${screen} accessibility violations`).toEqual([]);
}

async function createPreviewAccount(page: Page) {
  await page.goto("/?qa=preview");
  await page.getByRole("button", { name: "Build my plan" }).click();
  await page.getByLabel("First name").fill("Learner");
  await page.getByLabel("Email address").fill(`accessibility-${crypto.randomUUID()}@example.com`);
  await page.getByRole("button", { name: "Continue" }).click();
}

async function completeOnboarding(page: Page) {
  await page.getByRole("button", { name: /Personalize YOVA/ }).click();
  for (const [index, answer] of onboardingAnswers.entries()) {
    await page.getByRole("button", { name: answer, exact: true }).click();
    await page.getByRole("button", {
      name: index === onboardingAnswers.length - 1 ? "Build my setup" : "Continue",
    }).click();
  }
  await page.getByRole("button", { name: "Open YOVA" }).click();
}
