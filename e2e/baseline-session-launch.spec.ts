import { expect, freezePlanClock, test, type Page } from "./helpers/frozen-clock";
import { writeOnboardingAnswers } from "../src/lib/onboarding/answers";

/** Transport fixtures prove recovery and state preservation, not AI generation quality.
 * Live source/task quality remains in baseline-hub-profiles.live.spec.ts. */
// A readable review recording, including successful runs. Slow browser actions
// aid playback only; every state transition still waits on an assertion.
test.use({ video: { mode: "on", size: { width: 1280, height: 900 } }, launchOptions: { slowMo: 180 } });
const point = { id: "k1", text: "Water moves from higher to lower water potential through a selectively permeable membrane." };
const questions = [1, 2, 3].map((id) => ({ id: `q${id}`, slotId: `q${id}`, keyPointIds: ["k1"], kind: "recall", prompt: `Transport check ${id}: which direction does water move?`, choices: ["Higher to lower water potential", "Lower to higher water potential", "Only into cells", "Only out of cells"], correctChoiceIndex: 0, explanation: "The net movement follows the water potential gradient across a selectively permeable membrane." }));
const learn = { action: "learn_block", explanation: "Osmosis is the net movement of water molecules from a region of higher water potential to a region of lower water potential through a selectively permeable membrane. The direction depends on the gradient, so water can enter or leave a cell. ".repeat(2), keyPoints: [point, { id: "k2", text: "A selectively permeable membrane is required for osmosis." }, { id: "k3", text: "The direction of movement depends on the water potential gradient." }], questions, structure: ["Identify the gradient", "Check for a selectively permeable membrane"], example: { title: "A plant cell in pure water", steps: ["Water potential is higher outside the cell.", "Water enters through the selectively permeable membrane."] }, tips: [] };

async function openMapSession(page: Page) {
  await freezePlanClock(page);
  const now = new Date().toISOString();
  const snapshot = { version: 1, account: { id: "99000000-0000-4000-8000-000000000002", email: "session-launch@example.com", displayName: "Session tester", createdAt: now, identityMode: "preview" }, signedIn: true,
    onboardingAnswers: writeOnboardingAnswers([], { version: 1, answers: { energy_window: "afternoon", session_length: "minutes_20_30", focus_loss: "rarely", guidance: "exact_guidance", difficulty_help: "simple_explanation", prove_knowing: "map_it", gist_detail: "balanced", starting_pattern: "on_time", support_needs: ["no_extra_support"], extra_context: "nothing_else" }, legacy: {} }),
    onboardingCompleted: true, alphaEntered: true, plans: [], sessionCompletions: [], sessionInterruptions: [], updatedAt: now };
  await page.addInitScript(value => { if (!localStorage.getItem("yova.preview.v1")) localStorage.setItem("yova.preview.v1", JSON.stringify(value)); }, snapshot);
  await page.goto("/?qa=preview");
  await page.getByRole("button", { name: "Study something now", exact: true }).first().click();
  await page.getByLabel("Study Now topic or result").fill("Understand and explain osmosis and water potential in plant cells.");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByTestId("pre-session-card").getByRole("button", { name: "Start", exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Map the concepts and links" })).toBeVisible();
}

async function enterMap(page: Page) {
  await page.getByLabel("Concept 1", { exact: true }).fill("Water molecules");
  await page.getByLabel("Concept 2", { exact: true }).fill("Water potential");
  await page.getByRole("button", { name: "Add relationship", exact: true }).click();
  await page.getByLabel("Link 1 label", { exact: true }).fill("moves from lower to higher");
}

test("guided map preserves the last keystroke and original/revised provenance across retry and reload", async ({ page }, testInfo) => {
  const events: Array<{ step: string; seconds: number }> = [];
  const began = Date.now();
  let revisionAttempts = 0;
  const originalInputs: string[] = [];
  await page.route("**/api/sessions/shape", async route => {
    const request = route.request().postDataJSON();
    if (request.action === "compare" && request.revision) {
      revisionAttempts += 1;
      originalInputs.push(request.revision.originalProduced);
      if (revisionAttempts === 1) { await route.fulfill({ status: 503, json: { code: "provider_unavailable", error: "The comparison service is temporarily unavailable." } }); return; }
      await route.fulfill({ status: 200, json: { action: "compare", feedback: "Your revised relationship now follows the water potential gradient.", missing: [], incorrect: [], itemFeedback: [], tips: [] } }); return;
    }
    await route.fulfill({ status: 200, json: request.action === "learn_block" ? learn : request.action === "practice" ? { action: "practice", keyPoints: [point], questions, tips: [] } : { action: "compare", feedback: "Your map reverses the direction of net water movement.", missing: [], incorrect: ["Water moves from higher to lower water potential."], itemFeedback: request.mapItems?.filter((item: { kind: string }) => item.kind === "link").map((item: { id: string }) => ({ targetId: item.id, message: "Reverse this relationship's direction." })) ?? [], tips: [] } });
  });
  await openMapSession(page);
  await enterMap(page);
  await page.getByLabel("Concept 1", { exact: true }).fill("Water final keystroke Ω");
  // No timer wait: Exit immediately after the input event.
  await page.getByRole("button", { name: "Exit session", exact: true }).click();
  await page.reload();
  await page.getByRole("button", { name: /^(Start session|Continue session|Start next block)$/ }).first().click();
  await expect(page.getByLabel("Concept 1", { exact: true })).toHaveValue("Water final keystroke Ω");
  await expect(page.getByLabel("Link 1 label", { exact: true })).toHaveValue("moves from lower to higher");
  events.push({ step: "Exact map restored after immediate exit and reload", seconds: (Date.now() - began) / 1_000 });
  await page.getByRole("button", { name: "Compare my map", exact: true }).click();
  await expect(page.getByTestId("baseline-comparison")).toContainText("reverses the direction");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByLabel("Link 1 label", { exact: true }).fill("moves from higher to lower");
  await page.getByRole("button", { name: "Check correction", exact: true }).click();
  await expect(page.getByRole("button", { name: "Continue unchecked", exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: /^(Start session|Continue session|Start next block)$/ }).first().click();
  await expect(page.getByLabel("Link 1 label", { exact: true })).toHaveValue("moves from higher to lower");
  await page.getByRole("button", { name: "Retry correction check", exact: true }).click();
  await expect(page.getByTestId("repair-comparison")).toContainText("revised relationship now follows");
  await page.getByText("Original answer and feedback", { exact: true }).click();
  await expect(page.getByRole("region", { name: "Original map", exact: true })).toContainText("moves from lower to higher");
  expect(revisionAttempts).toBe(2);
  expect(originalInputs[0]).toBe(originalInputs[1]);
  expect(originalInputs[0]).toContain("moves from lower to higher");
  events.push({ step: "Failed correction restored, retried once, original preserved", seconds: (Date.now() - began) / 1_000 });
  await testInfo.attach("journey-index.json", { body: JSON.stringify({ environment: "development preview", dependencies: "auth/profile and slot transport fixtures; no live model or database", events }, null, 2), contentType: "application/json" });
});

test("comparison transport failure can continue without claiming feedback", async ({ page }) => {
  await page.route("**/api/sessions/shape", async route => {
    const request = route.request().postDataJSON();
    await route.fulfill(request.action === "compare" ? { status: 503, json: { code: "provider_unavailable", error: "Comparison is temporarily unavailable." } } : { status: 200, json: request.action === "learn_block" ? learn : { action: "practice", keyPoints: [point], questions, tips: [] } });
  });
  await openMapSession(page); await enterMap(page);
  await page.getByRole("button", { name: "Compare my map", exact: true }).click();
  await page.getByRole("button", { name: "Move on without feedback", exact: true }).click();
  await expect(page.getByTestId("baseline-question").or(page.getByText("Feedback unavailable", { exact: true }))).toBeVisible();
  await expect(page.getByRole("heading", { name: "What is missing or wrong", exact: true })).toHaveCount(0);
});
