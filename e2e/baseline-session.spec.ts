import { expect, test, type Page, type Route } from "./helpers/frozen-clock";

/**
 * Baseline session shapes (docs/redesign). Runs against the flag-on server
 * (see playwright.config.ts). The four AI slots are mocked at the network
 * boundary with fixed content; everything else — routing, the step order,
 * answer checking, the end screen — is the product's own code.
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

function question(id: string, keyPointId: string, correctChoiceIndex: number, prompt: string, kind: "definition" | "relationship" = "relationship") {
  return { id, keyPointId, kind, prompt, choices: ["Two pyruvate", "One lactate", "Three acetyl-CoA", "Four oxaloacetate"], correctChoiceIndex, explanation: "Glycolysis ends with two three-carbon pyruvate molecules." };
}

const LEARN_BLOCK = {
  action: "learn_block",
  explanation: "Cellular respiration is how a cell releases the energy stored in glucose and captures it as ATP. It runs in three stages. Glycolysis, in the cytosol, splits one glucose into two pyruvate and yields a small net gain of ATP and NADH. The citric acid cycle finishes oxidising the carbon and loads more electron carriers. The electron transport chain in the inner mitochondrial membrane uses those carriers to pump protons; the gradient then drives ATP synthase. For example, a sprinting muscle cell keeps glycolysis running even when oxygen runs short, which is why lactate builds up.",
  keyPoints: KEY_POINTS,
  questions: [
    question("q1", "k1", 0, "How many stages does cellular respiration have, and where does the first one happen?"),
    question("q2", "k2", 0, "What does glycolysis produce from one glucose?", "definition"),
    question("q3", "k3", 0, "What directly drives ATP synthase in the electron transport chain?"),
  ],
  structure: ["Glucose enters the cell", "Glycolysis splits it into pyruvate", "The citric acid cycle loads carriers", "The electron transport chain drives ATP synthase"],
};

const COMPARISON = { action: "compare", feedback: "You covered glycolysis and ATP, but you didn't mention the proton gradient that drives ATP synthase.", missing: ["The proton gradient drives ATP synthase"], incorrect: [] };

function practiceResponse(round: number) {
  return { action: "practice", keyPoints: KEY_POINTS, questions: round === 1
    ? [question("p1", "k1", 0, "Round one: which product ends glycolysis?", "definition"), question("p2", "k2", 0, "Round one: where does glycolysis take place, and what leaves it?"), question("p3", "k3", 0, "Round one: what does the proton gradient power?")]
    : [question("p4", "k2", 0, "Round two: what leaves glycolysis?"), question("p5", "k2", 0, "Round two: how many pyruvate per glucose?"), question("p6", "k2", 0, "Round two: glycolysis ends with which molecule?")] };
}

async function mockShapeSlots(page: Page, calls: string[]) {
  await page.route("**/api/sessions/shape", async (route: Route) => {
    const body = route.request().postDataJSON() as { action: string; round?: number };
    calls.push(body.action);
    const json = body.action === "learn_block" ? LEARN_BLOCK
      : body.action === "compare" ? COMPARISON
        : body.action === "practice" ? practiceResponse(body.round ?? 1)
          : { action: "direction", whatToLookAt: "Review your notes on cellular respiration.", howToApproach: "Read for the mechanism, not the terms.", origin: "generated" };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(json) });
  });
}

test("a learner is routed through Shape A, produces, compares, and finishes with a personalization note", async ({ page }) => {
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
  // Q2 10–15 minutes, Q3 very often, Q9 shorter sections → 11-minute nudge.
  await expect(page.getByLabel(/Session timer/)).toContainText("/ 11:00");

  // A2: no source, so the explanation, key points and questions come from one call.
  await expect(page.getByText(/Cellular respiration is how a cell releases/)).toBeVisible();
  await expect(page.getByText(KEY_POINTS[2].text)).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  // Q5 concrete_example: the structure appears before producing.
  await expect(page.getByRole("heading", { name: "Here is the shape of it before you produce." })).toBeVisible();
  await expect(page.getByText("The electron transport chain drives ATP synthase")).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  // Q6 map_it: the produce step is a concept map with the source hidden.
  await expect(page.getByRole("heading", { name: "Map the concepts and links" })).toBeVisible();
  await expect(page.getByText(/Cellular respiration is how a cell releases/)).toHaveCount(0);
  await page.getByLabel("Concept 1").fill("Glucose");
  await page.getByLabel("Concept 2").fill("Pyruvate");
  await page.getByLabel("Link 1 from").fill("Glucose");
  await page.getByLabel("Link 1 label").fill("is split into");
  await page.getByLabel("Link 1 to").fill("Pyruvate");
  await page.getByRole("button", { name: "Compare my map" }).click();
  // Feedback, not a verdict.
  const comparison = page.getByTestId("baseline-comparison");
  await expect(comparison).toContainText("you didn't mention the proton gradient");
  await expect(comparison).toContainText("Feedback, not a verdict");
  await expect(comparison).not.toContainText(/pass|fail/i);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Address the named gaps, or move on." })).toBeVisible();
  await page.getByRole("button", { name: "Move on" }).click();

  const note = page.locator("[data-rule-id]");
  await expect(note).toHaveAttribute("data-rule-id", "L3.q5.concrete_example");
  await expect(note).toContainText("Because you said a concrete example helps most");
  await expect(page.getByRole("heading", { name: "You studied, produced and compared." })).toBeVisible();
  await expect(page.getByText("Nothing else queued in this plan")).toBeVisible();
  // Development StrictMode mounts twice, so an aborted duplicate of the first
  // request can reach the mock; assert the slots used and their order, not a count.
  expect([...new Set(calls)]).toEqual(["learn_block", "compare"]);
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
  expect(recorded.completions[0]).toMatchObject({ correctAnswers: 0, totalAnswers: 0, observedGap: "The proton gradient drives ATP synthase" });
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
  expect(ruleIds).toEqual(expect.arrayContaining(["L1.memorization.learn", "L2.not_assessed.shape_c", "L4.q7.gist_leaning", "L4.q10.forget_during_tests"]));
  await expect(page.getByText("Method: Active Recall")).toBeVisible();
  // A memorization learn block is a learn block that runs Shape C.
  await expect(page.getByText(/LEARN BLOCK ·/)).toBeVisible();
  // Brief study step: the explanation and its key points, from one call.
  await expect(page.getByText(/Cellular respiration is how a cell releases/)).toBeVisible();
  await page.getByRole("button", { name: "Start the questions" }).click();

  await expect(page.getByText("No source shown.")).toBeVisible();
  await expect(page.getByText("Definitions and terms first.")).toBeVisible();
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
  await page.getByRole("button", { name: "Start round 2" }).click();
  // Round 2 covers only the missed key point, with fresh questions from Slot 4.
  await expect(page.getByTestId("baseline-question")).toContainText("ROUND 2 · QUESTION 1 OF 3");
  for (let index = 0; index < 3; index += 1) {
    await page.getByRole("button", { name: "Two pyruvate" }).click();
    await page.getByRole("button", { name: index < 2 ? "Next question" : "Finish round" }).click();
  }
  await expect(page.getByRole("heading", { name: "A full round passed clean." })).toBeVisible();
  await expect(page.getByText("5 of 6 correct")).toBeVisible();
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
  expect(recorded[0]).toMatchObject({ correctAnswers: 5, totalAnswers: 6 });
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

async function startStudyNowSession(page: Page, goal: string) {
  await page.getByRole("button", { name: "Study something now", exact: true }).first().click();
  await page.getByPlaceholder("Example: Help me understand the product rule and practice using it.").fill(goal);
  await page.getByRole("button", { name: "I haven't learned this yet" }).click();
  await page.getByRole("button", { name: /Choose how YOVA should help/ }).click();
  await page.getByRole("button", { name: /Create it for me/ }).click();
  await page.getByRole("button", { name: /Build and start session/ }).click();
}

async function createAndActivatePlan(page: Page, description: string) {
  await page.getByRole("button", { name: "Calendar", exact: true }).click();
  await page.locator(".calendar-page-header").getByRole("button", { name: "Add to YOVA", exact: true }).click();
  await page.getByRole("textbox", { name: "Describe what you want to add" }).fill(description);
  await page.getByRole("button", { name: "Organize this" }).click();
  await expect(page.getByRole("heading", { name: "Here is what YOVA understood." })).toBeVisible();
  await page.getByRole("button", { name: "Choose what YOVA should do" }).click();
  await page.getByRole("button", { name: /Create a plan/ }).click();
  await expect(page.getByRole("heading", { name: "When would you prefer to study this material?" })).toBeVisible();
  await page.getByRole("button", { name: "45 minutes", exact: true }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Skip for now" }).click();
  await page.getByRole("button", { name: "Generate my plan" }).click();
  await expect(page.getByText("Plan ready")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Use this plan" }).click();
  await expect(page.getByRole("heading", { name: "Your plan" })).toBeVisible();
  await page.getByRole("button", { name: "Home", exact: true }).click();
}

/** Opens ready sessions from Home until one renders the requested shape, finishing any other shape's block first is not needed: the fallback plan alternates learn then practice. */
/**
 * Home's Start session. The pre-baseline "ahead of schedule" confirmation
 * still guards early starts until the plan model changes in Brief 2; keep the
 * planned dates so the fallback plan's later sessions stay where they are.
 */
async function startReadySession(page: Page) {
  await page.getByRole("button", { name: /Start session/ }).first().click();
  const keepDates = page.getByRole("button", { name: "Start now, keep dates" });
  if (await keepDates.isVisible({ timeout: 1_500 }).catch(() => false)) await keepDates.click();
}
