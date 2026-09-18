import { expect, test, type Page, type Route } from "./helpers/frozen-clock";
import { openPlanSetupPreview } from "./helpers/plan-setup";

/**
 * Baseline session shapes (docs/redesign). Runs against the flag-on server
 * (see playwright.config.ts). The four AI slots are mocked at the network
 * boundary with fixed content; everything else — routing, the step order,
 * answer checking, the end screen — is the product's own code.
 *
 * Standing rule (Brief 1.5): these mocks replace the slot route's response,
 * so they are NOT a test of generation or practice composition. Each mocked
 * round has the shape the server really returns — a retry has one question
 * per missed point. Composition is proven by compose-practice.test.ts and
 * shape-slot-generator.test.ts, and live by e2e/baseline-practice-retry.live.spec.ts.
 *
 * Hub tips (Brief 1.5 item 6) follow the request like the model is told to:
 * one tip per requested step, on that step's first offered reason. Which
 * reasons are offered is the product's own routing; tip writing and binding
 * are proven by session-tips.test.ts and shape-slot-generator.test.ts.
 */
const BASELINE_ONBOARDING = [
  "Evening",
  "10 to 15 minutes",
  "Very often",
  "Tell me exactly what to do",
  "A concrete example first",
  "Mapping out how the pieces connect",
  "I get the big picture but miss specifics",
  "I intend to begin but often delay",
  "Shorter sections with fewer steps at once",
  "I understand in class but forget during tests",
] as const;

const KEY_POINTS = [
  { id: "k1", text: "Cellular respiration releases energy from glucose in three stages." },
  { id: "k2", text: "Glycolysis splits glucose into two pyruvate in the cytosol." },
  { id: "k3", text: "The electron transport chain builds a proton gradient that drives ATP synthase." },
];

function question(id: string, keyPointId: string, correctChoiceIndex: number, prompt: string, kind: "recall" | "misconception" = "recall") {
  return { id, slotId: id, keyPointIds: [keyPointId], kind, prompt, choices: ["Two pyruvate", "One lactate", "Three acetyl-CoA", "Four oxaloacetate"], correctChoiceIndex, explanation: "Glycolysis ends with two three-carbon pyruvate molecules." };
}

const LEARN_BLOCK = {
  action: "learn_block",
  explanation: "Cellular respiration is how a cell releases the energy stored in glucose and captures it as ATP. It runs in three stages. Glycolysis, in the cytosol, splits one glucose into two pyruvate and yields a small net gain of ATP and NADH. The citric acid cycle finishes oxidising the carbon and loads more electron carriers. The electron transport chain in the inner mitochondrial membrane uses those carriers to pump protons; the gradient then drives ATP synthase. For example, a sprinting muscle cell keeps glycolysis running even when oxygen runs short, which is why lactate builds up.",
  keyPoints: KEY_POINTS,
  questions: [
    question("q1", "k1", 0, "How many stages does cellular respiration have, and where does the first one happen?"),
    question("q2", "k2", 0, "What does glycolysis produce from one glucose?", "misconception"),
    question("q3", "k3", 0, "What directly drives ATP synthase in the electron transport chain?"),
  ],
  structure: ["Glucose enters the cell", "Glycolysis splits it into pyruvate", "The citric acid cycle loads carriers", "The electron transport chain drives ATP synthase"],
  example: { title: "A sprinting muscle cell", steps: ["Glucose is split by glycolysis in the cytosol.", "Oxygen runs short, so pyruvate becomes lactate.", "NAD+ is regenerated and glycolysis keeps making ATP."] },
};

const COMPARISON = { action: "compare", feedback: "You covered glycolysis and ATP, but you didn't mention the proton gradient that drives ATP synthase.", missing: ["The proton gradient drives ATP synthase"], incorrect: [] };

function practiceResponse(round: number) {
  return { action: "practice", keyPoints: KEY_POINTS, questions: round === 1
    ? [question("p1", "k1", 0, "Round one: which product ends glycolysis?", "misconception"), question("p2", "k2", 0, "Round one: where does glycolysis take place, and what leaves it?"), question("p3", "k3", 0, "Round one: what does the proton gradient power?")]
    // One missed point, so one question: the round-two contract. This fixture
    // used to hand-supply three, which hid the 502 on the ordinary retry.
    : [question("p4", "k2", 0, "Round two: what leaves glycolysis?")] };
}

type TipRequestEntry = { step: string; reasons: Array<{ ruleId: string; sentence: string }> };

function tipsFollowing(requested: TipRequestEntry[] = []) {
  return requested.map(({ step, reasons }) => ({ step, title: `Hub tip for the ${step} step.`, body: reasons[0]!.sentence, ruleId: reasons[0]!.ruleId, origin: "generated" }));
}

async function mockShapeSlots(page: Page, calls: string[]) {
  await page.route("**/api/sessions/shape", async (route: Route) => {
    const body = route.request().postDataJSON() as { action: string; round?: number; tips?: TipRequestEntry[] };
    calls.push(body.action);
    const json = body.action === "learn_block" ? LEARN_BLOCK
      : body.action === "compare" ? COMPARISON
        : body.action === "practice" ? practiceResponse(body.round ?? 1)
          : { action: "direction", whatToLookAt: "Review your notes on cellular respiration.", howToApproach: "Read for the mechanism, not the terms.", origin: "generated", example: null };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...json, tips: tipsFollowing(body.tips) }) });
  });
}

test("a learner is routed through Shape A, produces, compares, and finishes with a personalization note", async ({ page }, testInfo) => {
  const calls: string[] = [];
  await mockShapeSlots(page, calls);
  await createPreviewAccount(page);
  await completeBaselineOnboarding(page);
  await startStudyNowSession(page, "Explain how photosynthesis converts light energy into chemical energy inside a leaf.");

  const shell = page.locator("[data-shape]");
  await expect(shell).toHaveAttribute("data-shape", "A");
  const ruleIds = (await shell.getAttribute("data-rule-ids"))?.split(" ") ?? [];
  expect(ruleIds).toEqual(expect.arrayContaining(["L2.not_assessed", "L3.q5.concrete_example", "L3.q6.map_it", "L4.q2.minutes_10_15", "L4.q3.very_often", "L4.q9.shorter_sections", "L5.q4.exact_guidance"]));
  await expect(shell).toHaveAttribute("data-method", "concept_mapping");
  // Q4 exact_guidance: the method is applied silently, no chooser.
  await expect(page.getByRole("button", { name: "Change method" })).toHaveCount(0);
  await expect(page.getByText("Method: Concept Mapping")).toBeVisible();
  // The workload owns the timer; the saved short-profile answer is its ceiling.
  const plannedWorkload = await page.evaluate(() => {
    const plan = JSON.parse(localStorage.getItem("yova.preview.v1")!).plans.at(-1);
    const session = plan.sessions[0];
    if (session.estimatedMinutes !== session.workload.estimatedMinutes) throw new Error("Session and workload estimates diverged.");
    return { estimatedMinutes: session.estimatedMinutes as number, questionCount: session.workload.questionCount as number };
  });
  const plannedMinutes = plannedWorkload.estimatedMinutes;
  expect(plannedMinutes).toBeGreaterThanOrEqual(8);
  expect(plannedMinutes).toBeLessThanOrEqual(15);
  await expect(page.getByLabel(/Session timer/)).toContainText("0:");
  await expect(page.getByRole("region", { name: "Timer" })).toContainText(`/ ${plannedMinutes}:00`);

  // Brief 1.5 item 6: the hub. Briefing, reasons, shape, tip — every reason a rule that fired.
  await expect(page.getByRole("region", { name: "How to study this" })).toContainText("Concept Mapping");
  await expect(page.locator('[data-pill-rule-id="L3.q6.map_it"]')).toHaveText("you prove knowledge by mapping");
  for (const pillRuleId of await page.locator("[data-pill-rule-id]").evaluateAll((pills) => pills.map((pill) => pill.getAttribute("data-pill-rule-id")))) expect(ruleIds).toContain(pillRuleId);
  await expect(page.getByRole("region", { name: "Session shape" })).toContainText("SHAPE A · STUDY → PRODUCE → COMPARE → REPAIR");
  const tip = page.getByTestId("hub-tip");
  await expect(tip).toHaveAttribute("data-tip-step", "study");
  await expect(tip).toContainText("YOVA TIP · STEP 1");
  expect(ruleIds).toContain(await tip.getAttribute("data-tip-rule-id"));
  await page.screenshot({ path: testInfo.outputPath("hub-shape-a-study.png"), fullPage: true });

  // A2: no source, so the explanation, key points and questions come from one call.
  await expect(page.getByText(/Cellular respiration is how a cell releases/)).toBeVisible();
  await expect(page.getByText(KEY_POINTS[2].text)).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  // Q5 concrete_example: a worked example appears before producing.
  // Brief 1.5 item 5: a real example from the explanation, not an outline or the directions presented as one.
  await expect(page.getByTestId("baseline-worked-example")).toHaveAttribute("data-example-shown", "true");
  await expect(page.getByRole("heading", { name: "A sprinting muscle cell" })).toBeVisible();
  await expect(page.getByText("From the explanation.")).toBeVisible();
  await expect(page.getByText("Oxygen runs short, so pyruvate becomes lactate.")).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  // Q6 map_it: the produce step is a concept map with the source hidden.
  await expect(page.getByRole("heading", { name: "Map the concepts and links" })).toBeVisible();
  // Workload-backed Shape A also shows its planned practice and round review.
  await expect(page.getByText(`STEP 2 OF ${plannedWorkload.questionCount > 0 ? 7 : 5}`)).toBeVisible();
  await expect(tip).toHaveAttribute("data-tip-step", "produce");
  await expect(tip).toHaveAttribute("data-tip-rule-id", "L3.q6.map_it");
  await page.screenshot({ path: testInfo.outputPath("hub-shape-a-produce.png"), fullPage: true });
  await expect(page.getByText(/Cellular respiration is how a cell releases/)).toHaveCount(0);
  await page.getByRole("textbox", { name: "Concept 1", exact: true }).fill("Glucose");
  await page.getByRole("textbox", { name: "Concept 2", exact: true }).fill("Pyruvate");
  await page.getByRole("button", { name: "Add relationship", exact: true }).click();
  await page.getByLabel("Link 1 from").selectOption({ label: "Glucose" });
  await page.getByLabel("Link 1 label").fill("is split into");
  await page.getByLabel("Link 1 to").selectOption({ label: "Pyruvate" });
  await page.getByRole("button", { name: "Compare my map" }).click();
  // Feedback, not a verdict.
  const comparison = page.getByTestId("baseline-comparison");
  await expect(comparison).toContainText("you didn't mention the proton gradient");
  await expect(comparison).toContainText("Feedback, not a verdict");
  await expect(comparison).not.toContainText(/pass|fail/i);
  await expect(tip).toHaveAttribute("data-tip-step", "compare");
  expect(ruleIds).toContain(await tip.getAttribute("data-tip-rule-id"));
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Address the named gaps, or move on." })).toBeVisible();
  await page.getByRole("button", { name: "Move on" }).click();
  await completeOptionalPlannedPractice(page);

  const note = page.locator("[data-rule-id]");
  await expect(note).toHaveAttribute("data-rule-id", "L3.q5.concrete_example");
  await expect(note).toContainText("Because you said a concrete example helps most, YOVA showed a worked example");
  await expect(page.getByRole("heading", { name: /You studied, produced and compared|A full round passed clean/ })).toBeVisible();
  await expect(page.getByText("Nothing else queued in this plan")).toBeVisible();
  await expect(tip).toHaveAttribute("data-tip-step", "end");
  await expectReceiptNamesApplicableRules(page, ruleIds);
  // Development StrictMode mounts twice, so an aborted duplicate of the first
  // request can reach the mock; assert the slots used and their order, not a count.
  expect([...new Set(calls)].filter((action) => action !== "practice")).toEqual(["learn_block", "compare"]);
  await page.getByRole("button", { name: "Finish" }).click();
  await expect(page.locator("[data-shape]")).toHaveCount(0);
  // A Study Now plan has one session, so Home returns to its start state; the completion is recorded.
  await expect(page.getByRole("heading", { name: "Turn any goal into a clear next step." })).toBeVisible();
  const recorded = await page.evaluate(() => {
    const raw = window.localStorage.getItem("yova.preview.v1");
    const snapshot = raw ? JSON.parse(raw) as { sessionCompletions?: Array<{ correctAnswers: number; totalAnswers: number; observedGap: string }>; plans?: Array<{ sessions: Array<{ status: string }> }> } : null;
    return { completions: snapshot?.sessionCompletions ?? [], sessions: snapshot?.plans?.flatMap((plan) => plan.sessions.map((session) => session.status)) ?? [] };
  });
  expect(recorded.completions).toHaveLength(1);
  expect(recorded.completions[0]).toMatchObject({ observedGap: "The proton gradient drives ATP synthase" });
  expect(recorded.sessions).toEqual(["complete"]);
});

test("a memorization learn block runs Shape C closed-book after a brief study step, checks answers in code, and finishes clean on round two", async ({ page }) => {
  const calls: string[] = [];
  await mockShapeSlots(page, calls);
  await createPreviewAccount(page);
  await completeBaselineOnboarding(page);
  await createAndActivatePlan(page, "I have never studied cellular respiration. Teach me from scratch for my exam in three weeks.");
  await startReadySession(page);

  // The fallback plan opens with a vocabulary topic: task type decides the shape (Layer 1).
  const shell = page.locator("[data-shape]");
  await expect(shell).toHaveAttribute("data-shape", "C");
  const ruleIds = (await shell.getAttribute("data-rule-ids"))?.split(" ") ?? [];
  expect(ruleIds).toEqual(expect.arrayContaining(["L1.memorization.learn", "L2.not_assessed.shape_c", "L4.mix.memorization", "L4.q7.gist_leaning.mix_recall", "L4.practice.active_recall.default", "L4.practice.error_repair.after_missed_round", "L4.q10.forget_during_tests"]));
  await expect(page.getByText("Method: Active Recall")).toBeVisible();
  // A memorization learn block is a learn block that runs Shape C.
  await expect(page.getByText(/LEARN BLOCK ·/)).toBeVisible();
  // Brief study step: the explanation and its key points, from one call.
  await expect(page.getByText(/Cellular respiration is how a cell releases/)).toBeVisible();
  await page.getByRole("button", { name: "Start the questions" }).click();

  await expect(page.getByText("No source shown.")).toBeVisible();
  // Brief 1.5 item 2: the screen names the question's real type instead of claiming an order.
  await expect(page.getByText("Active Recall round. Recall question. No source shown.")).toBeVisible();
  await expect(page.getByRole("region", { name: "Session shape" })).toContainText("SHAPE C · CLOSED-BOOK PRACTICE");
  await expect(page.getByTestId("hub-tip")).toHaveAttribute("data-tip-step", "questions");
  expect(ruleIds).toContain(await page.getByTestId("hub-tip").getAttribute("data-tip-rule-id"));
  // Handoff 3A timer: pause, +5, hide and show again. Never blocks.
  const timer = page.getByRole("region", { name: "Timer" });
  await timer.getByRole("button", { name: "Pause" }).click();
  await expect(timer.getByRole("button", { name: "Resume" })).toBeVisible();
  const limit = (await timer.textContent())?.match(/\/ (\d+):00/)?.[1];
  await timer.getByRole("button", { name: "Add 5 minutes" }).click();
  await expect(timer).toContainText(`/ ${Number(limit) + 5}:00`);
  await timer.getByRole("button", { name: "Hide" }).click();
  await expect(page.getByRole("region", { name: "Timer" })).toHaveCount(0);
  await page.getByRole("button", { name: "Timer hidden, show it" }).click();
  await expect(page.getByRole("region", { name: "Timer" }).getByRole("button", { name: "Resume" })).toBeVisible();
  // Round 1 uses the questions generated with the explanation; miss the second one.
  await expect(page.getByTestId("baseline-question")).toContainText("ROUND 1 · QUESTION 1 OF 3");
  await expect(page.getByTestId("baseline-question")).toContainText(LEARN_BLOCK.questions[0].prompt);
  await page.getByRole("button", { name: "Two pyruvate" }).click();
  await expect(page.getByTestId("baseline-reveal")).toHaveAttribute("data-correct", "true");
  await page.getByRole("button", { name: "Next question" }).click();
  await page.getByRole("button", { name: "One lactate" }).click();
  const reveal = page.getByTestId("baseline-reveal");
  await expect(reveal).toHaveAttribute("data-correct", "false");
  await expect(reveal).toContainText("Not quite. The answer is: Two pyruvate");
  await expect(reveal.getByRole("button", { name: "Ask YOVA" })).toBeVisible();
  await page.getByRole("button", { name: "Next question" }).click();
  await page.getByRole("button", { name: "Two pyruvate" }).click();
  await page.getByRole("button", { name: "Finish round" }).click();
  await expect(page.getByRole("heading", { name: "1 point still to pass." })).toBeVisible();
  await expect(page.getByTestId("hub-tip")).toHaveAttribute("data-tip-step", "round");
  await expect(page.getByTestId("hub-tip")).toHaveAttribute("data-tip-rule-id", "L4.practice.error_repair.after_missed_round");
  await expect(page.getByTestId("hub-tip")).toContainText("a round after a miss covers only what you missed");
  await page.getByRole("button", { name: "Start round 2" }).click();
  // Round 2 covers only the missed key point, with fresh questions from Slot 4.
  await expect(page.getByTestId("baseline-question")).toContainText("ROUND 2 · QUESTION 1 OF 1");
  // Brief 1.5 item 3: a round after a miss is Error Repair, and the screen says so.
  await expect(page.getByTestId("baseline-question")).toHaveAttribute("data-practice-round", "error_repair");
  await expect(page.getByText("Error Repair round.")).toBeVisible();
  await page.getByRole("button", { name: "Two pyruvate" }).click();
  await page.getByRole("button", { name: "Finish round" }).click();
  await expect(page.getByRole("heading", { name: "A full round passed clean." })).toBeVisible();
  await expect(page.getByText("3 of 4 correct")).toBeVisible();
  await expectReceiptNamesApplicableRules(page, ruleIds);
  expect([...new Set(calls)]).toEqual(["learn_block", "practice"]);
  expect(calls.indexOf("practice")).toBeGreaterThan(calls.lastIndexOf("learn_block"));
  await page.getByRole("button", { name: "Finish" }).click();
  await expect(page.locator("[data-shape]")).toHaveCount(0);
  const recorded = await page.evaluate(() => {
    const raw = window.localStorage.getItem("yova.preview.v1");
    const snapshot = raw ? JSON.parse(raw) as { sessionCompletions?: Array<{ correctAnswers: number; totalAnswers: number }> } : null;
    return snapshot?.sessionCompletions ?? [];
  });
  expect(recorded).toHaveLength(1);
  expect(recorded[0]).toMatchObject({ correctAnswers: 3, totalAnswers: 4 });
});

// Brief 1.5 follow-up: a try-it-first learner produces, then studies, then gets the comparison.
// It used to stall on Compare: the comparison was only requested when produce led straight into it.
test("a try-it-first learner produces before studying and still gets the comparison", async ({ page }) => {
  const calls: string[] = [];
  await mockShapeSlots(page, calls);
  await createPreviewAccount(page);
  await completeOnboarding(page, ["Morning", "45 to 60 minutes", "Rarely", "Recommend options and let me decide", "Trying it and getting feedback", "Explaining it out loud or in writing", "I know the details but lose how they fit together", "I usually begin when I plan to", null, "Nothing else for now"]);
  await startStudyNowSession(page, "Explain how photosynthesis converts light energy into chemical energy inside a leaf.");

  const shell = page.locator("[data-shape]");
  await expect(shell).toHaveAttribute("data-shape", "A");
  expect((await shell.getAttribute("data-rule-ids"))?.split(" ")).toContain("L3.q5.try_then_feedback");
  await expect(page.getByRole("heading", { name: "Explain it in your own words" })).toBeVisible();
  await page.getByLabel("Explain it in your own words").fill("Glucose is split into pyruvate and the cell makes ATP.");
  await page.getByRole("button", { name: "Compare with the source" }).click();
  await expect(page.getByText(/Cellular respiration is how a cell releases/)).toBeVisible();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("heading", { name: "What is missing or wrong" })).toBeVisible();
  await expect(page.getByTestId("baseline-comparison")).toContainText("you didn't mention the proton gradient");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Move on", exact: true }).click();
  await completeOptionalPlannedPractice(page);
  await expect(page.getByRole("heading", { name: /You studied, produced and compared|A full round passed clean/ })).toBeVisible();
  expect([...new Set(calls)]).toEqual(["learn_block", "compare"]);
});

// Brief 1.5 item 6: below ~1100px the rail sits under the card in one column. Functional, NOT designed.
test("the session hub falls back to one column on a phone without breaking", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const calls: string[] = [];
  await mockShapeSlots(page, calls);
  await createPreviewAccount(page);
  await completeBaselineOnboarding(page);
  await startStudyNowSession(page, "Explain how photosynthesis converts light energy into chemical energy inside a leaf.");
  await expect(page.getByText(/Cellular respiration is how a cell releases/)).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  const card = await page.locator("section").filter({ hasText: /Cellular respiration is how a cell releases/ }).last().boundingBox();
  const rail = await page.getByRole("complementary", { name: "Session hub" }).boundingBox();
  expect(card && rail && rail.y >= card.y + card.height - 1).toBe(true);
  await expect(page.getByTestId("hub-tip")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("hub-mobile-fallback-undesigned.png"), fullPage: true });
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByTestId("baseline-worked-example")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
});

test("a profile saved by position survives the question reorder and is editable by ID in You", async ({ page }) => {
  await page.goto("/?qa=preview");
  // A snapshot written by a pre-Brief-1 build: labels at legacy positions, no record.
  await page.evaluate(() => {
    const answers = Array.from({ length: 17 }, () => "");
    answers[1] = "Recommend options and let me decide";
    answers[2] = "45 to 60 minutes";
    answers[3] = "Trying it and getting feedback";
    answers[4] = "Rarely";
    answers[6] = "Morning";
    answers[8] = "Extra time to read and respond";
    window.localStorage.setItem("yova.preview.v1", JSON.stringify({
      version: 1,
      account: { id: "preview-account", email: "legacy@example.com", displayName: "Legacy", createdAt: new Date().toISOString(), identityMode: "preview" },
      signedIn: true,
      onboardingAnswers: answers,
      onboardingCompleted: true,
      alphaEntered: true,
      plans: [],
      deadlineMilestones: [],
      sessionCompletions: [],
      sessionInterruptions: [],
      updatedAt: new Date().toISOString(),
    }));
  });
  await page.reload();
  await page.getByRole("button", { name: "You", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Ten answers that change how sessions run" })).toBeVisible();
  await expect(page.getByLabel("How much guidance do you want from YOVA?")).toHaveValue("learner_choice");
  await expect(page.getByLabel("What study-session length usually feels realistic?")).toHaveValue("minutes_45_60");
  await expect(page.getByLabel("When a topic is difficult, what usually helps most?")).toHaveValue("try_then_feedback");
  await expect(page.getByLabel("When do you usually have the most usable energy?")).toHaveValue("morning");
  await expect(page.getByLabel("Extra time to read and respond")).toBeChecked();
  await expect(page.getByLabel("When you want to prove to yourself that you actually know something, what works best?")).toHaveValue("");
  await page.getByLabel("When you want to prove to yourself that you actually know something, what works best?").selectOption("explain_back");
  await page.reload();
  await page.getByRole("button", { name: "You", exact: true }).click();
  await expect(page.getByLabel("When you want to prove to yourself that you actually know something, what works best?")).toHaveValue("explain_back");
  await expect(page.getByLabel("How much guidance do you want from YOVA?")).toHaveValue("learner_choice");
});

async function createPreviewAccount(page: Page) {
  await page.goto("/?qa=preview");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Create an account", exact: true }).click();
  await page.getByLabel("First name").fill("Learner");
  await page.getByLabel("Email address").fill("baseline@example.com");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Make YOVA fit how you actually study." })).toBeVisible();
}

/** The receipt names implemented behavior; overridden or unused rules remain internal traces. */
async function expectReceiptNamesApplicableRules(page: Page, ruleIds: string[]) {
  const receipt = page.getByTestId("session-receipt");
  await receipt.getByText("Why this session ran this way").click();
  const named = await receipt.locator("[data-receipt-rule-id]").evaluateAll((items) => items.map((item) => item.getAttribute("data-receipt-rule-id")));
  expect(named.length).toBeGreaterThan(0);
  for (const id of named) expect(ruleIds).toContain(id);
  expect(named.some((id) => /^L4\.difficulty\.(low|medium|high)$/.test(id ?? ""))).toBe(false);
  await expect(receipt).not.toContainText(/difficult/i);
}

async function completeOnboarding(page: Page, answers: ReadonlyArray<string | null>) {
  await page.getByRole("button", { name: /Personalize YOVA/ }).click();
  for (const [index, answer] of answers.entries()) {
    if (answer) await page.getByRole("button", { name: answer, exact: true }).click();
    await page.getByRole("button", { name: index === answers.length - 1 ? "Build my setup" : "Continue" }).click();
  }
  await page.getByRole("button", { name: "Open YOVA" }).click();
}

async function completeBaselineOnboarding(page: Page) {
  await page.getByRole("button", { name: /Personalize YOVA/ }).click();
  for (const [index, answer] of BASELINE_ONBOARDING.entries()) {
    await page.getByRole("button", { name: answer, exact: true }).click();
    await page.getByRole("button", { name: index === BASELINE_ONBOARDING.length - 1 ? "Build my setup" : "Continue" }).click();
  }
  await expect(page.getByRole("heading", { name: "YOVA will begin like this." })).toBeVisible();
  await expect(page.getByText(/Because you said a concrete example helps most/)).toBeVisible();
  await page.getByRole("button", { name: "Open YOVA" }).click();
}

/** Brief 1.5 item 8: Study Now's first screen, then the pre-session card, then the hub. */
async function startStudyNowSession(page: Page, goal: string) {
  await page.getByRole("button", { name: "Study something now", exact: true }).first().click();
  await page.getByLabel("Study Now topic or result").fill(goal);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByTestId("pre-session-card").getByRole("button", { name: "Start", exact: true }).click();
}

async function createAndActivatePlan(page: Page, description: string) {
  await openPlanSetupPreview(page);
  await page.getByLabel("Learning goal or deadline").fill(description);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: /Create it for me/ }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Skip corrections", exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Skip placement and build plan", exact: true }).click();
  await expect(page.getByRole("region", { name: "Plan grouped by topic" })).toBeVisible();
  await page.getByRole("button", { name: "Use this plan", exact: true }).click();
  await page.getByRole("button", { name: "Home", exact: true }).click();
}

/** Opens ready sessions from Home until one renders the requested shape, finishing any other shape's block first is not needed: the fallback plan alternates learn then practice. */
/**
 * Home's Start session. The pre-baseline "ahead of schedule" confirmation
 * still guards early starts until the plan model changes in Brief 2; keep the
 * planned dates so the fallback plan's later sessions stay where they are.
 */
async function startReadySession(page: Page) {
  await page.getByRole("button", { name: /Start session|Start next block/ }).first().click();
  const keepDates = page.getByRole("button", { name: "Start now, keep dates" });
  if (await keepDates.isVisible({ timeout: 1_500 }).catch(() => false)) await keepDates.click();
  await page.getByTestId("pre-session-card").getByRole("button", { name: "Start", exact: true }).click();
}

/** This transport fixture grades all seeded choices at index zero; it does not evaluate model quality. */
async function completeOptionalPlannedPractice(page: Page) {
  const end = page.getByRole("heading", { name: /You studied, produced and compared|A full round passed clean/ });
  // A pass over eight questions arrives in parts, with a short "Preparing the
  // next part" card between them, so wait for the next question or the end.
  for (;;) {
    await expect(page.getByTestId("baseline-question").or(end)).toBeVisible();
    if (!await page.getByTestId("baseline-question").isVisible()) break;
    await page.getByRole("group", { name: "Answer choices" }).getByRole("button").first().click();
    await page.getByRole("button", { name: /^(Next question|Next part|Finish round)$/ }).click();
  }
}
