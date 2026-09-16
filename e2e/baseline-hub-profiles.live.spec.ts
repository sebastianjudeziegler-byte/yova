import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page, type TestInfo } from "./helpers/frozen-clock";

/**
 * Brief 1.5 item 6 deliverable, live and unmocked: the two contrasting
 * personalization-delta profiles run the same Study Now topic through the real
 * slot route, and every step of the hub is captured side by side. Tips come
 * from the real model; each one shown must sit on a rule that fired.
 */
test.skip(process.env.YOVA_RUN_LIVE_BASELINE_PRACTICE !== "1", "Live model run only: pnpm test:e2e:baseline:live.");
test.describe.configure({ mode: "serial" });

const GOAL = "Explain how photosynthesis converts light energy into chemical energy inside a leaf.";
/** docs: src/lib/routing/personalization-delta.test.ts BASELINE_PROFILE_1 and _2, as onboarding labels. null skips an optional question. */
const PROFILES = {
  P1: ["Evening", "10 to 15 minutes", "Very often", "Tell me exactly what to do", "A concrete example first", "Mapping out how the pieces connect", "I get the big picture but miss specifics", "I intend to begin but often delay", ["Shorter sections with fewer steps at once", "Instructions repeated in simpler language"], "I understand in class but forget during tests"],
  P2: ["Morning", "45 to 60 minutes", "Rarely", "Recommend options and let me decide", "Trying it and getting feedback", "Explaining it out loud or in writing", "I know the details but lose how they fit together", "I usually begin when I plan to", null, "Nothing else for now"],
} as const;

type StepRecord = { step: string; screenshot: string; tip: { step: string; ruleId: string; origin: string; title: string; body: string } | null };
type ProfileRecord = { profile: string; ruleIds: string[]; pills: string[]; steps: StepRecord[] };

const recordPath = (testInfo: TestInfo, profile: string) => join(testInfo.project.outputDir, "hub-profiles", `${profile}.json`);

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name.includes("mobile"), "The side-by-side sessions are captured at desktop width; the phone fallback is captured by baseline-session.spec.ts.");
});

for (const profile of ["P1", "P2"] as const) {
  test(`${profile} runs a live session with the hub`, async ({ page }, testInfo) => {
    test.setTimeout(420_000);
    const record: ProfileRecord = { profile, ruleIds: [], pills: [], steps: [] };
    const capture = async (step: string) => {
      const screenshot = testInfo.outputPath(`${profile}-${record.steps.length + 1}-${step}.png`);
      await page.screenshot({ path: screenshot, fullPage: true });
      const tip = page.getByTestId("hub-tip");
      const shown = await tip.count() ? {
        step: (await tip.getAttribute("data-tip-step")) ?? "",
        ruleId: (await tip.getAttribute("data-tip-rule-id")) ?? "",
        origin: (await tip.getAttribute("data-tip-origin")) ?? "",
        title: (await tip.locator("p").nth(0).innerText()).trim(),
        body: (await tip.locator("p").nth(1).innerText()).trim(),
      } : null;
      if (shown) expect(record.ruleIds, `${profile} ${step} tip rule fired`).toContain(shown.ruleId);
      record.steps.push({ step, screenshot, tip: shown });
    };

    await startStudyNow(page, PROFILES[profile]);
    const shell = page.locator("[data-shape]");
    await expect(shell).toHaveAttribute("data-shape", "A", { timeout: 120_000 });
    record.ruleIds = (await shell.getAttribute("data-rule-ids"))?.split(" ") ?? [];
    record.pills = await page.locator("[data-pill-rule-id]").evaluateAll((pills) => pills.map((pill) => pill.getAttribute("data-pill-rule-id") ?? ""));
    for (const pill of record.pills) expect(record.ruleIds).toContain(pill);

    if (profile === "P1") {
      await expect(page.getByText("Key points")).toBeVisible({ timeout: 150_000 });
      await capture("study");
      await page.getByRole("button", { name: "Continue", exact: true }).click();
      await expect(page.getByTestId("baseline-worked-example")).toHaveAttribute("data-example-shown", "true");
      await capture("worked-example");
      await page.getByRole("button", { name: "Continue", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Map the concepts and links" })).toBeVisible();
      await page.getByLabel("Concept 1").fill("Light-dependent reactions");
      await page.getByLabel("Concept 2").fill("Calvin cycle");
      await page.getByLabel("Link 1 from").fill("Light-dependent reactions");
      await page.getByLabel("Link 1 label").fill("supply ATP and NADPH to");
      await page.getByLabel("Link 1 to").fill("Calvin cycle");
      await capture("produce");
      await page.getByRole("button", { name: "Compare my map" }).click();
      await expect(page.getByTestId("baseline-comparison")).toBeVisible({ timeout: 150_000 });
      await capture("compare");
      await page.getByRole("button", { name: "Continue", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Address the named gaps, or move on." })).toBeVisible();
      await capture("repair");
      await page.getByRole("button", { name: "Move on", exact: true }).click();
      await expect(page.getByRole("heading", { name: "You studied, produced and compared." })).toBeVisible();
      await capture("end");
    } else {
      await capture("method-choice");
      await page.getByRole("button", { name: "Start with Feynman Technique" }).click();
      await expect(page.getByRole("heading", { name: "Explain it in your own words" })).toBeVisible();
      await capture("produce");
      await page.getByLabel("Explain it in your own words").fill("Light hits chlorophyll in the thylakoids, which splits water and makes ATP and NADPH. The Calvin cycle in the stroma uses them to fix carbon dioxide into sugar.");
      await page.getByRole("button", { name: "Compare with the source" }).click();
      await expect(page.getByText("Key points")).toBeVisible({ timeout: 150_000 });
      await capture("study");
      await page.getByRole("button", { name: "Continue", exact: true }).click();
      await expect(page.getByTestId("baseline-comparison")).toBeVisible({ timeout: 150_000 });
      await capture("compare");
      await page.getByRole("button", { name: "Continue", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Address the named gaps, or move on." })).toBeVisible();
      await capture("repair");
      await page.getByRole("button", { name: "Move on", exact: true }).click();
      await expect(page.getByRole("heading", { name: "You studied, produced and compared." })).toBeVisible();
      await capture("end");
    }

    mkdirSync(join(testInfo.project.outputDir, "hub-profiles"), { recursive: true });
    writeFileSync(recordPath(testInfo, profile), JSON.stringify(record, null, 2));
    await testInfo.attach(`${profile}-hub.json`, { path: recordPath(testInfo, profile), contentType: "application/json" });
  });
}

test("the two profiles' hubs differ on rule IDs and tip text", async ({}, testInfo) => {
  const [first, second] = (["P1", "P2"] as const).map((profile) => JSON.parse(readFileSync(recordPath(testInfo, profile), "utf8")) as ProfileRecord);
  expect(first!.pills).not.toEqual(second!.pills);
  const tipFor = (record: ProfileRecord, step: string) => record.steps.find((entry) => entry.tip?.step === step)?.tip ?? null;
  for (const step of ["study", "produce", "compare", "repair", "end"]) {
    const a = tipFor(first!, step);
    const b = tipFor(second!, step);
    if (!a || !b) continue;
    expect(a.ruleId, `${step} tip rule`).not.toBe(b.ruleId);
    expect(a.body, `${step} tip text`).not.toBe(b.body);
  }
  expect(tipFor(first!, "study"), "P1 study tip").not.toBeNull();
  expect(tipFor(second!, "study"), "P2 study tip").not.toBeNull();
});

async function startStudyNow(page: Page, answers: ReadonlyArray<string | readonly string[] | null>) {
  await page.goto("/?qa=preview");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Create an account", exact: true }).click();
  await page.getByLabel("First name").fill("Learner");
  await page.getByLabel("Email address").fill("baseline-live-hub@example.com");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: /Personalize YOVA/ }).click();
  for (const [index, answer] of answers.entries()) {
    for (const label of answer === null ? [] : typeof answer === "string" ? [answer] : answer) {
      await page.getByRole("button", { name: label, exact: true }).click();
    }
    await page.getByRole("button", { name: index === answers.length - 1 ? "Build my setup" : "Continue" }).click();
  }
  await page.getByRole("button", { name: "Open YOVA" }).click();
  await page.getByRole("button", { name: "Study something now", exact: true }).first().click();
  await page.getByPlaceholder("Example: Help me understand the product rule and practice using it.").fill(GOAL);
  await page.getByRole("button", { name: "I haven't learned this yet" }).click();
  await page.getByRole("button", { name: /Choose how YOVA should help/ }).click();
  await page.getByRole("button", { name: /Create it for me/ }).click();
  await page.getByRole("button", { name: /Build and start session/ }).click();
}
