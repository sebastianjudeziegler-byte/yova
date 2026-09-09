# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: accessibility-regression.spec.ts >> the initial HTML provides useful public content without waiting for JavaScript
- Location: e2e/accessibility-regression.spec.ts:29:5

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: apiRequestContext.get: Request context disposed.
Call log:
  - → GET http://127.0.0.1:3100/
    - user-agent: Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.7922.34 Mobile Safari/537.36
    - accept: */*
    - accept-encoding: gzip,deflate,br

```

# Test source

```ts
  1   | import { expect, test, type Page } from "@playwright/test";
  2   | import { createRequire } from "node:module";
  3   |
  4   | const requireFromTest = createRequire(__filename);
  5   | const requireFromNextLint = createRequire(requireFromTest.resolve("eslint-config-next"));
  6   | const jsxA11yPackagePath = requireFromNextLint.resolve("eslint-plugin-jsx-a11y/package.json");
  7   | const axePath = createRequire(jsxA11yPackagePath).resolve("axe-core/axe.min.js");
  8   |
  9   | const FIXED_NOW = new Date("2026-09-02T10:00:00.000Z");
  10  |
  11  | const onboardingAnswers = [
  12  |   "Show a short recommendation and alternatives",
  13  |   "I delay a little, then get going",
  14  |   "20 to 30 minutes",
  15  |   "A concrete example before the rule",
  16  |   "Recalling it without notes, then checking",
  17  |   "I recognize it but cannot recall it",
  18  |   "Give me a small hint",
  19  |   "Show one step at a time",
  20  |   "Clear checkpoints inside the block",
  21  |   "No extra support right now",
  22  |   "Afternoon",
  23  | ] as const;
  24  |
  25  | test.beforeEach(async ({ page }) => {
  26  |   await page.clock.setFixedTime(FIXED_NOW);
  27  | });
  28  |
  29  | test("the initial HTML provides useful public content without waiting for JavaScript", async ({ request }) => {
> 30  |   const response = await request.get("/");
      |                                  ^ Error: apiRequestContext.get: Request context disposed.
  31  |   const html = await response.text();
  32  |
  33  |   expect(response.ok()).toBe(true);
  34  |   expect(html).toContain("Know what to study next.");
  35  |   expect(html).toContain("Try the free Study Profile");
  36  |   expect(html).toContain("Checking for your YOVA account");
  37  |   expect(html).not.toContain("Opening your YOVA…");
  38  | });
  39  |
  40  | test("form placeholder text keeps AA contrast on public surfaces", async ({ page }) => {
  41  |   await page.goto("/support");
  42  |   const inputs = [
  43  |     page.getByPlaceholder("Example: My study plan would not open"),
  44  |     page.getByPlaceholder("Include the screen, button, and any error message you saw."),
  45  |   ];
  46  |
  47  |   for (const input of inputs) {
  48  |     await expect(input).toBeVisible();
  49  |     const ratio = await input.evaluate((element) => {
  50  |       const luminance = (color: string) => {
  51  |         const channels = color.match(/[\d.]+/g)?.slice(0, 3).map(Number) ?? [];
  52  |         const linear = channels.map((channel) => {
  53  |           const value = channel / 255;
  54  |           return value <= 0.04045
  55  |             ? value / 12.92
  56  |             : ((value + 0.055) / 1.055) ** 2.4;
  57  |         });
  58  |         return (0.2126 * linear[0]) + (0.7152 * linear[1]) + (0.0722 * linear[2]);
  59  |       };
  60  |       const foreground = luminance(getComputedStyle(element, "::placeholder").color);
  61  |       const background = luminance(getComputedStyle(element).backgroundColor);
  62  |       return (Math.max(foreground, background) + 0.05)
  63  |         / (Math.min(foreground, background) + 0.05);
  64  |     });
  65  |     expect(ratio).toBeGreaterThanOrEqual(4.5);
  66  |   }
  67  | });
  68  |
  69  | test("Ask YOVA history traps focus, closes on Escape, and restores its trigger", async ({ page }) => {
  70  |   await createPreviewAccount(page);
  71  |   await completeOnboarding(page);
  72  |   await page.getByRole("button", { name: "Ask YOVA", exact: true }).click();
  73  |
  74  |   const trigger = page.getByRole("button", { name: /^History/ });
  75  |   await trigger.focus();
  76  |   await trigger.click();
  77  |
  78  |   const dialog = page.getByRole("dialog", { name: "Previous chats" });
  79  |   const close = dialog.getByRole("button", { name: "Close conversation history" });
  80  |   await expect(dialog).toBeVisible();
  81  |   await expect(close).toBeFocused();
  82  |
  83  |   const outsideFocusWasBlocked = await page.evaluate(() => {
  84  |     const modal = document.querySelector<HTMLDialogElement>("dialog.tutor-history-modal");
  85  |     const outside = document.querySelector<HTMLButtonElement>('.topnav-tabs button[aria-label="Home"]');
  86  |     if (!modal || !outside) return false;
  87  |     outside.focus();
  88  |     return modal.contains(document.activeElement);
  89  |   });
  90  |   expect(outsideFocusWasBlocked).toBe(true);
  91  |
  92  |   await page.keyboard.press("Tab");
  93  |   await expect.poll(() => dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  94  |
  95  |   await page.keyboard.press("Escape");
  96  |   await expect(dialog).toHaveCount(0);
  97  |   await expect(trigger).toBeFocused();
  98  | });
  99  |
  100 | test("primary authenticated screens have no serious WCAG A/AA Axe violations", async ({ page }) => {
  101 |   await createPreviewAccount(page);
  102 |   await completeOnboarding(page);
  103 |
  104 |   await expectAxeClean(page, "Home");
  105 |   for (const screen of ["Calendar", "Ask YOVA", "You"] as const) {
  106 |     await page.getByRole("button", { name: screen, exact: true }).click();
  107 |     await expectAxeClean(page, screen);
  108 |   }
  109 | });
  110 |
  111 | async function expectAxeClean(page: Page, screen: string) {
  112 |   await page.addScriptTag({ path: axePath });
  113 |   const violations = await page.evaluate(async () => {
  114 |     const axe = (window as unknown as {
  115 |       axe: {
  116 |         run: (
  117 |           context: Document,
  118 |           options: Record<string, unknown>,
  119 |         ) => Promise<{
  120 |           violations: Array<{
  121 |             id: string;
  122 |             impact: string | null;
  123 |             help: string;
  124 |             nodes: Array<{ target: string[]; failureSummary?: string }>;
  125 |           }>;
  126 |         }>;
  127 |       };
  128 |     }).axe;
  129 |     const result = await axe.run(document, {
  130 |       runOnly: {
```
