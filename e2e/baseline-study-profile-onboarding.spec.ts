import { expect, test } from "@playwright/test";

/**
 * Brief 2.5 finding 109: Q6 and Q7 were "not answered" on the founder's own
 * account. An account created from the public Study Profile was marked
 * onboarded without the baseline questions, and the Study Profile never asks
 * Q6 (how you prove you know something) or Q7 (big picture or details). With
 * the production flag on, the new account is asked exactly the required
 * questions the Study Profile did not cover, and both answers are saved.
 */
test("an account created from the Study Profile is asked Q6 and Q7, and saves them", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  await page.goto("/study-profile/setup");
  await page.getByRole("button", { name: "Build my study profile" }).click();
  await page.getByRole("button", { name: "Let me customize from valid options" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  for (let question = 2; question < 11; question += 1) await page.getByRole("button", { name: "Skip for now" }).click();
  await page.getByRole("button", { name: "Evening", exact: true }).click();
  await page.getByRole("button", { name: "Review my setup" }).click();
  await page.getByRole("link", { name: "Use this profile in YOVA" }).click();

  await page.goto("/?qa=preview");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Create an account", exact: true }).click();
  await page.getByLabel("First name").fill("Profile Tester");
  await page.getByLabel("Email address").fill(`baseline-profile-${testInfo.project.name}-${Date.now()}@example.com`);
  await page.getByRole("button", { name: "Continue" }).click();

  // Every required baseline question this profile left unanswered is asked,
  // one after another, and nothing it already answered.
  const asked: string[] = [];
  for (let step = 0; step < 10; step += 1) {
    const heading = page.locator("main h2").first();
    await expect(heading).toBeVisible();
    asked.push((await heading.textContent()) ?? "");
    await page.getByRole("group").getByRole("button").first().click();
    const build = page.getByRole("button", { name: "Build my setup", exact: true });
    if (await build.count()) { await build.click(); break; }
    await page.getByRole("button", { name: "Continue", exact: true }).click();
  }
  expect(asked).toContain("When you want to prove to yourself that you actually know something, what works best?");
  expect(asked).toContain("When you're studying, which is more likely?");
  expect(asked).not.toContain("Would any of these make YOVA easier for you to use?");
  await expect(page.getByRole("heading", { name: "YOVA will begin like this." })).toBeVisible();
  await page.getByRole("button", { name: "Open YOVA" }).click();
  await expect(page.getByRole("navigation", { name: "Main navigation" })).toBeVisible();
  const record = await page.evaluate(() => {
    const answers = JSON.parse(localStorage.getItem("yova.preview.v1") ?? "{}").onboardingAnswers as string[] | undefined;
    return JSON.parse(answers?.[17] ?? "null") as { answers?: Record<string, unknown> } | null;
  });
  expect(record?.answers).toMatchObject({ prove_knowing: "explain_back", gist_detail: "gist_leaning" });
});

/**
 * Brief 2.5 findings 106, 107: the You page showed two questionnaires (the
 * ten baseline questions and the older eleven) and developer notes such as
 * "Layer 4: timer one band down...". With the production flag on there is one
 * questionnaire and no developer copy; Home no longer offers the old one.
 */
test("You shows one questionnaire with no developer notes, and Home does not send the learner to the old one", async ({ page }) => {
  await page.goto("/?qa=preview");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Create an account", exact: true }).click();
  await page.getByLabel("First name").fill("One Questionnaire");
  await page.getByLabel("Email address").fill(`baseline-you-${Date.now()}@example.com`);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Personalize YOVA" }).click();
  for (let step = 0; step < 12; step += 1) {
    const build = page.getByRole("button", { name: "Build my setup", exact: true });
    const options = page.getByRole("group").getByRole("button");
    if (await options.count()) await options.first().click();
    if (await build.count()) { await build.click(); break; }
    await page.getByRole("button", { name: "Continue", exact: true }).click();
  }
  await page.getByRole("button", { name: "Open YOVA" }).click();
  await expect(page.getByRole("navigation", { name: "Main navigation" })).toBeVisible();
  await expect(page.getByText("Deepen your profile", { exact: false })).toHaveCount(0);
  await page.getByRole("button", { name: "You", exact: true }).click();
  await expect(page.getByText("Ten answers that change how sessions run", { exact: false })).toBeVisible();
  await expect(page.getByText(/Review or change the 11 optional questions|\/11 answered/)).toHaveCount(0);
  await expect(page.getByText(/Layer \d:|Nothing in v1/)).toHaveCount(0);
});
