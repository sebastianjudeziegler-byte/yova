import { expect, type Page } from "@playwright/test";
import type { LearningPlan } from "../../src/lib/domain";
import { freezePlanClock, PLAN_FIXED_NOW } from "./frozen-clock";
import { writeOnboardingAnswers } from "../../src/lib/onboarding/answers";

/** Auth/profile fixture only. Plan mapping, signing, composition and activation
 * still use the local development-preview endpoints. */
export async function openPlanSetupPreview(page: Page, at: Date = PLAN_FIXED_NOW) {
  await freezePlanClock(page, at);
  const now = at.toISOString();
  const snapshot = { version: 1, account: { id: "99000000-0000-4000-8000-000000000001", email: "plan-setup@example.com", displayName: "Learner", createdAt: now, identityMode: "preview" }, signedIn: true,
    onboardingAnswers: writeOnboardingAnswers([], { version: 1, answers: { energy_window: "afternoon", session_length: "minutes_20_30", focus_loss: "rarely", guidance: "structured_flexibility", difficulty_help: "simple_explanation", prove_knowing: "answer_questions", gist_detail: "balanced", starting_pattern: "on_time", support_needs: ["no_extra_support"], extra_context: "nothing_else" }, legacy: {} }),
    onboardingCompleted: true, alphaEntered: true, plans: [], sessionCompletions: [], sessionInterruptions: [], updatedAt: now };
  await page.addInitScript(value => { if (!localStorage.getItem("yova.preview.v1")) localStorage.setItem("yova.preview.v1", JSON.stringify(value)); }, snapshot);
  await page.goto("/?qa=preview");
  await page.getByRole("button", { name: /^(New plan|Build my first plan|Create another plan|Add)$/ }).first().click();
}

/** Enter normal setup from the current learner's Home without replacing state. */
export async function beginNormalPlan(page: Page, goal: string) {
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await page.getByRole("button", { name: "Add to YOVA", exact: true }).click();
  await page.getByLabel("Learning goal or deadline").fill(goal);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await chooseGeneratedPlanSource(page);
}

/** Seeded Calendar plans enter at Sources; all plans acknowledge understanding. */
export async function chooseGeneratedPlanSource(page: Page) {
  await page.getByRole("button", { name: /Create it for me/ }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("heading", { name: "What YOVA understood", exact: true }).waitFor();
  await page.getByRole("button", { name: "Skip corrections", exact: true }).click();
}

export async function buildPlanFromSchedule(page: Page) {
  const response = page.waitForResponse(response => new URL(response.url()).pathname === "/api/plans/generate" && !new URL(response.url()).search);
  const build = page.getByRole("button", { name: "Build my plan", exact: true });
  if (await build.isVisible()) await build.click();
  else {
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await page.getByRole("button", { name: "Skip placement and build plan", exact: true }).click();
  }
  return response;
}

export async function expandGroupedPlanTopics(page: Page) {
  const groups = page.getByRole("region", { name: "Plan grouped by topic" });
  const details = groups.locator("details");
  for (let index = 0; index < await details.count(); index += 1) {
    const detail = details.nth(index);
    if (await detail.getAttribute("open") === null) await detail.locator(":scope > summary").click();
  }
}

/** Draft and saved plans share the grouped view. Wait for the activation
 * response and its exact plan in durable preview state, not the draft view. */
export async function activatePreviewPlan(page: Page): Promise<LearningPlan> {
  const activation = page.waitForResponse(response => new URL(response.url()).pathname === "/api/plans/activate" && response.request().method() === "POST");
  await page.getByRole("button", { name: "Use this plan", exact: true }).click();
  const response = await activation;
  const body = await response.json();
  expect(response.ok(), JSON.stringify(body)).toBe(true);
  const plan = body.plan as LearningPlan;
  expect(plan.id).toBeTruthy();
  await expect.poll(() => page.evaluate(id => {
    const state = JSON.parse(localStorage.getItem("yova.preview.v1") ?? "{}");
    return state.plans?.find((item: LearningPlan) => item.id === id)?.status;
  }, plan.id)).toBe("active");
  await expect(page.getByRole("button", { name: "Start next block", exact: true })).toBeVisible();
  return page.evaluate(id => JSON.parse(localStorage.getItem("yova.preview.v1")!).plans.find((item: LearningPlan) => item.id === id), plan.id);
}
