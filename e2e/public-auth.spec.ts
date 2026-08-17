import { expect, test, type Page, type Route } from "@playwright/test";

test.skip(process.env.YOVA_E2E_PASSWORD_AUTH !== "1", "Runs only in the isolated password-auth browser configuration.");

test.beforeEach(async ({ page }) => {
  await installTurnstileStub(page);
});

test("creates a public password account with consent and a security token", async ({ page }) => {
  let signupBody: Record<string, unknown> | null = null;
  await page.route("**/supabase-test/auth/v1/signup**", async (route) => {
    signupBody = route.request().postDataJSON() as Record<string, unknown>;
    await json(route, 200, {
      id: "public-user-1",
      aud: "authenticated",
      role: "authenticated",
      email: "new-learner@example.com",
      created_at: "2026-08-16T12:00:00.000Z",
      updated_at: "2026-08-16T12:00:00.000Z",
      app_metadata: { provider: "email", providers: ["email"] },
      user_metadata: { display_name: "New Learner" },
      identities: [],
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Build my plan" }).click();
  await expect(page.getByRole("heading", { name: "Start building your YOVA." })).toBeVisible();

  await page.getByLabel("First name").fill("New Learner");
  await page.getByLabel("Email address").fill("New-Learner@Example.com");
  await page.getByLabel("Password", { exact: true }).fill("a-safe-public-password");
  await page.getByLabel(/I’m at least 13/).check();
  await expect(page.getByRole("button", { name: "Create account" })).toBeEnabled();
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page.getByRole("heading", { name: "One quick check, then your YOVA is ready." })).toBeVisible();
  expect(signupBody).toMatchObject({
    email: "new-learner@example.com",
    password: "a-safe-public-password",
    data: {
      display_name: "New Learner",
      terms_version: "2026-08-16",
      age_confirmation: "13_or_guardian_permission",
    },
    gotrue_meta_security: { captcha_token: "turnstile-e2e-token" },
  });
});

test("keeps password errors generic and password recovery non-enumerating", async ({ page }) => {
  await page.route("**/supabase-test/auth/v1/token?grant_type=password", async (route) => {
    await json(route, 400, {
      code: "invalid_credentials",
      msg: "Invalid login credentials for a provider-specific reason",
    });
  });
  await page.route("**/supabase-test/auth/v1/recover**", async (route) => {
    await json(route, 200, {});
  });

  await page.goto("/");
  const landingSignIn = page.getByRole("button", { name: "Sign in" });
  await landingSignIn.focus();
  await landingSignIn.press("Enter");
  await page.getByLabel("Email address").fill("unknown@example.com");
  await page.getByLabel("Password", { exact: true }).fill("wrong-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  const signInError = page.getByText("Email or password is incorrect.", { exact: true });
  await expect(signInError).toBeVisible();
  await expect(signInError).not.toContainText("provider-specific");

  await page.getByRole("button", { name: "Forgot password?" }).click();
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByRole("heading", { name: "If that account exists, help is on the way." })).toBeVisible();
  await expect(page.getByText("YOVA does not reveal whether an email address has an account.")).toBeVisible();
});

test("fits the public account form on a phone-sized viewport", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes("mobile"), "Mobile-only layout assertion.");

  await page.goto("/");
  await page.getByRole("button", { name: "Build my plan" }).click();
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
});

async function installTurnstileStub(page: Page) {
  await page.route("https://challenges.cloudflare.com/turnstile/v0/api.js**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: `(() => {
        const widgets = new Map();
        window.turnstile = {
          render(element, options) {
            const id = 'widget-' + (widgets.size + 1);
            widgets.set(id, options);
            element.setAttribute('data-turnstile-ready', 'true');
            setTimeout(() => options.callback('turnstile-e2e-token'), 0);
            return id;
          },
          reset(id) {
            const options = widgets.get(id);
            if (options) setTimeout(() => options.callback('turnstile-e2e-token'), 0);
          },
          remove(id) { widgets.delete(id); }
        };
      })();`,
    });
  });
}

async function json(route: Route, status: number, body: unknown) {
  await route.fulfill({
    status,
    contentType: "application/json",
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "*",
    },
    body: JSON.stringify(body),
  });
}
