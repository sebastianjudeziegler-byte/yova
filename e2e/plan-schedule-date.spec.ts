import { expect, test, type Page } from "@playwright/test";

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

const TEST_TIME_ZONE = "Europe/London";

test.use({ timezoneId: TEST_TIME_ZONE });

for (const {days, priorityMinutes} of [{days:1,priorityMinutes:0},{days:3,priorityMinutes:0},{days:1,priorityMinutes:3}]) test(`consolidated: ${priorityMinutes ? "a three-minute priority records no completion" : `a ${days}-day deadline survives placement, plan review and activation`}`, async ({ page }, testInfo) => {
  const titles = ["ATP and energy transfer", "Glycolysis", "Link reaction", "Krebs cycle", "Electron transport chain", "Chemiosmosis"];
  const knowledgeMap = {
    version:1, scopeJudgment:{band:"unit_or_exam",label:"Cellular respiration",minimumSessions:12,recommendedSessions:12,maximumSessions:12,minimumTeachingSessions:6,explanation:"Learn each part of respiration and practise applying it independently."},
    topics:titles.map((title,index)=>({id:`90000000-0000-4000-8000-${String(index+1).padStart(12,"0")}`,title,description:`Explain ${title} and how it contributes to cellular respiration.`,subtopics:[],prerequisiteTopicIds:[],status:"not_started",initialEvidence:null,sourceReferences:[],origin:"ai_generated",deferred:null})),
    placementCheck:{status:"available",completedAt:null,demonstratedTopicIds:[],gapTopicIds:[]},
  };
  // Supply the accepted six-topic audit fixture. Scoring, receipts, composition,
  // routing, UI rendering and activation all use the real local endpoints.
  await page.route("**/api/plans/generate**", async route => {
    const body = route.request().postDataJSON();
    const boundary = new Date();
    boundary.setUTCDate(boundary.getUTCDate()+1);
    boundary.setUTCHours(19,priorityMinutes,0,0);
    // Exercise a real server deadline clipping a future study window to three
    // minutes; no server clock override or fabricated generation response.
    const tinyWindow = priorityMinutes && !route.request().url().includes("?mode=diagnostic") ? {
      deadline:boundary.toISOString(),timeZone:"UTC",
      availability:[{day:new Intl.DateTimeFormat("en-US",{weekday:"long",timeZone:"UTC"}).format(boundary),window:"Evening",minutes:45}],
    } : {};
    await route.continue({postData:JSON.stringify({...body,...(!body.knowledgeMap?{knowledgeMap}:{}),...tinyWindow})});
  });
  await openPreviewApp(page);
  await page.getByRole("button", {name:/New plan|Build my first plan|Create another plan/}).first().click();
  await page.getByPlaceholder(/I have a biology test/).fill("Teach me cellular respiration from scratch for my test. I can study Monday, Wednesday and Friday evenings for 45 minutes.");
  await page.getByRole("button", {name:"Continue",exact:true}).click();
  await page.getByRole("button", {name:/Create it for me/}).click();
  await page.getByRole("button", {name:"Continue",exact:true}).click();
  const deadline = futureDate(days).input;
  await page.getByRole("textbox",{name:/^(Custom target date|Target date)$/}).fill(deadline);
  const preparedResponse = page.waitForResponse(response=>response.url().includes("/api/plans/generate?mode=diagnostic"));
  await page.getByRole("button",{name:"Continue to placement check"}).click();
  const prepared = await (await preparedResponse).json();
  expect(prepared.questions).toHaveLength(8);
  expect(prepared.questions.every((question: Record<string,unknown>)=>!("correctAnswer" in question))).toBe(true);
  if (days === 1) await page.getByRole("button",{name:"Skip for now"}).click();
  else {
    for (let index=0;index<prepared.questions.length;index+=1) {
      const answer = index<2 ? knowledgeMap.topics[0]!.description.replace(/[.!?]+$/, "") : "I don't know yet";
      await page.getByRole("button",{name:answer,exact:true}).click();
      await page.getByRole("button",{name:index===prepared.questions.length-1?"Use my answers":"Next question",exact:true}).click();
    }
  }
  await expect(page.getByRole("heading",{name:"Everything YOVA will use"})).toBeVisible();
  const generatedResponse = page.waitForResponse(response=>new URL(response.url()).pathname==="/api/plans/generate" && !new URL(response.url()).search);
  await page.getByRole("button",{name:"Generate my plan"}).click();
  const generated = await (await generatedResponse).json();
  if (priorityMinutes) {
    expect(generated).toMatchObject({kind:"deadline_priority",priority:{minutes:3,progressCredit:false}});
    await expect(page.getByRole("heading",{name:"Focus on ATP and energy transfer"})).toBeVisible();
    await expect(page.getByText("This card does not record a completed session or mark the topic as learned.",{exact:true})).toBeVisible();
    await expect(page.getByRole("button",{name:"Use this plan"})).toHaveCount(0);
    await page.screenshot({path:`docs/audits/2026-09-07-plan-creation/consolidated/evidence/priority-${testInfo.project.name}.png`,fullPage:true});
    await page.getByRole("button",{name:"Done",exact:true}).click();
    expect(await page.evaluate(()=>JSON.parse(localStorage.getItem("yova.preview.v1")??"{}").sessionCompletions??[])).toHaveLength(0);
    return;
  }
  expect(generated.plan, JSON.stringify(generated)).toBeTruthy();
  await expect(page.getByText("Plan ready",{exact:true})).toBeVisible();
  await expect(page.getByText(generated.plan.rationale,{exact:true})).toBeVisible();
  expect(generated.plan.sessions.length).toBeGreaterThan(0);
  expect(generated.plan.sessions.every((session:{scheduledFor:string;estimatedMinutes:number})=>Date.parse(session.scheduledFor)+session.estimatedMinutes*60_000<=Date.parse(generated.plan.deadline))).toBe(true);
  if (days===1) await expect(page.locator(".generated-topic-map li.deferred").first()).toBeVisible();
  else await expect(page.locator(".generated-topic-map li").filter({hasText:titles[0]})).toContainText("Quick verification");
  await page.screenshot({path:`docs/audits/2026-09-07-plan-creation/consolidated/evidence/deadline-${days}-browser.png`,fullPage:true});
  await page.getByRole("button",{name:"Use this plan"}).click();
  await expect(page.getByRole("heading",{name:"Your plan",exact:true})).toBeVisible();
});

test("a natural deadline and an edited date survive every schedule control", async ({ page }) => {
  await openPreviewApp(page);

  const inferred = futureDate(40);
  const manual = futureDate(47);
  const writtenDeadline = new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    timeZone: TEST_TIME_ZONE,
  }).format(inferred.date);

  await page.getByRole("button", { name: /New plan|Build my first plan|Create another plan/ }).first().click();
  await page.getByPlaceholder(/I have a biology test/).fill(
    `Prepare for a chemistry quiz on chemical equilibrium on ${writtenDeadline}`,
  );
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: /Create it for me/ }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();

  await expect(page.getByRole("heading", { name: "When would you prefer to study this material?" })).toBeVisible();
  const targetDate = page.getByRole("textbox", { name: "Target date" });
  await expect(targetDate).toHaveValue(inferred.input);
  await expect(page.locator(".schedule-deadline strong")).not.toHaveText("No fixed deadline");

  // Do not treat the date input's DOM value as proof. The summary is rendered
  // from React state, so this assertion verifies that a real input event reached
  // the application before any rhythm change causes another render.
  await targetDate.fill(manual.input);
  await expect(page.locator(".schedule-deadline strong")).not.toHaveText("No fixed deadline");
  await expect(page.locator(".schedule-deadline strong")).toContainText(manual.monthShort);

  await page.getByRole("button", { name: "Every day", exact: true }).click();
  await page.getByRole("button", { name: "Morning", exact: true }).click();
  await page.getByRole("button", { name: "45 minutes", exact: true }).click();
  await expect(targetDate).toHaveValue(manual.input);
  await expect(page.getByText("7 study windows available")).toBeVisible();
  await expect(page.locator(".schedule-preview-windows")).toContainText("Morning");
  await expect(page.locator(".schedule-preview-windows")).toContainText("45 min");

  await page.getByRole("button", { name: /Custom Choose each day/ }).click();
  const customTargetDate = page.getByRole("textbox", { name: "Custom target date" });
  await expect(customTargetDate).toHaveValue(manual.input);
  await page.getByLabel(/Monday time window/).selectOption("Evening");
  await page.getByRole("button", { name: /Remove Monday|Add Monday/ }).click();
  await expect(customTargetDate).toHaveValue(manual.input);

  await page.getByRole("button", { name: "Quick choices", exact: true }).click();
  await expect(targetDate).toHaveValue(manual.input);
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(targetDate).toHaveValue(manual.input);
});

test("explicit study days survive intake and later time changes", async ({ page }) => {
  await openPreviewApp(page);
  await page.getByRole("button", { name: /New plan|Build my first plan|Create another plan/ }).first().click();
  await page.getByPlaceholder(/I have a biology test/).fill("Prepare for a biology exam on cell transport in two weeks. I can study Monday, Wednesday and Friday afternoons for 25 minutes.");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: /Create it for me/ }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  for (const day of ["Monday", "Wednesday", "Friday"]) {
    await expect(page.getByRole("button", { name: `Remove ${day}`, exact: true })).toBeVisible();
    await expect(page.getByLabel(`${day} time window`, { exact: true })).toHaveValue("Afternoon");
  }
  for (const day of ["Tuesday", "Thursday", "Saturday", "Sunday"]) await expect(page.getByRole("button", { name: `Add ${day}`, exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Quick choices", exact: true }).click();
  await page.getByRole("button", { name: "15 minutes", exact: true }).click();
  await expect(page.getByText("3 study windows available")).toBeVisible();
  await page.getByRole("button", { name: /Custom Choose each day/ }).click();
  for (const day of ["Monday", "Wednesday", "Friday"]) {
    await expect(page.getByRole("button", { name: `Remove ${day}`, exact: true })).toBeVisible();
    await expect(page.getByLabel(`${day} available minutes`, { exact: true })).toHaveValue("15");
  }
  await page.getByRole("button", { name: "Quick choices", exact: true }).click();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByText("3 study windows available")).toBeVisible();
  await expect(page.locator(".schedule-preview-windows")).toContainText("15 min");
});

test("a historical topic date cannot override the learner's real deadline", async ({ page }) => {
  await openPreviewApp(page);

  const expected = futureDate(14);
  await page.getByRole("button", { name: /New plan|Build my first plan|Create another plan/ }).first().click();
  await page.getByPlaceholder(/I have a biology test/).fill(
    "Write a paper about September 11, 2001 due in two weeks",
  );
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: /Create it for me/ }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();

  await expect(page.getByRole("heading", { name: "When would you prefer to work on this?" })).toBeVisible();
  await expect(page.locator(".plan-header")).toContainText("Step 3 of 4");
  await expect(page.getByRole("textbox", { name: "Target date" })).toHaveValue(expected.input);
});

test("shorter sessions preserve weekly availability and explain insufficient time", async ({ page }) => {
  await openPreviewApp(page);
  await page.getByRole("button", { name: /New plan|Build my first plan|Create another plan/ }).first().click();
  await page.getByPlaceholder(/I have a biology test/).fill("Prepare for a biology test on cell membranes and diffusion in six weeks. I can study only Monday, Wednesday and Friday afternoons for 25 minutes.");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: /Create it for me/ }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Continue to placement check" }).click();
  await page.getByRole("button", { name: "Skip for now" }).click();
  await page.getByRole("button", { name: "Generate my plan" }).click();
  await page.getByRole("button", { name: "Use this plan" }).click();
  await expect(page.getByRole("heading", { name: "Your plan", exact: true })).toBeVisible();
  const originalCount = await page.locator(".timeline-row").count();
  await page.getByRole("button", { name: "Adjust", exact: true }).click();
  const panel = page.locator(".plan-adjustment-panel");
  await panel.getByRole("combobox", { name: /Future session window/ }).selectOption("15");
  await panel.getByRole("textbox", { name: /^Target date/ }).fill(futureDate(1).input);
  await panel.getByRole("button", { name: "Approve and rebuild plan" }).click();
  await expect(panel).toContainText("This change does not fit your selected study windows");
  await expect(page.locator(".timeline-row")).toHaveCount(originalCount);
  await panel.getByRole("textbox", { name: /^Target date/ }).fill(futureDate(47).input);
  await panel.getByRole("button", { name: "Approve and rebuild plan" }).click();
  await expect(panel).toHaveCount(0);
  const schedule = await page.evaluate(() => {
    const snapshot = JSON.parse(localStorage.getItem("yova.preview.v1") ?? "{}");
    const plan = snapshot.plans.at(-1);
    return { preferences: plan.schedulePreferences, sessions: plan.sessions.map((session: { scheduledFor: string; estimatedMinutes: number }) => ({ at: session.scheduledFor, minutes: session.estimatedMinutes })) };
  });
  expect(schedule.preferences.availability.map((window: { day: string }) => window.day)).toEqual(["Monday", "Wednesday", "Friday"]);
  expect(schedule.sessions.length).toBeGreaterThan(originalCount);
  const days = new Map<string, number>();
  for (const session of schedule.sessions) {
    const at = new Date(session.at);
    expect(new Intl.DateTimeFormat("en-GB", { timeZone: TEST_TIME_ZONE, weekday: "long" }).format(at)).toMatch(/^(Monday|Wednesday|Friday)$/);
    const date = new Intl.DateTimeFormat("en-CA", { timeZone: TEST_TIME_ZONE }).format(at);
    days.set(date, (days.get(date) ?? 0) + session.minutes);
    expect(session.minutes).toBe(15);
  }
  expect([...days.values()].every((minutes) => minutes <= 25)).toBe(true);
});

test("an overfull plan returns to its schedule and recovers without a client crash", async ({ page }) => {
  const pageErrors: string[] = [];
  let planAttempts = 0;
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route("**/api/plans/generate**", async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("mode") === "diagnostic") {
      await route.continue();
      return;
    }
    planAttempts += 1;
    if (planAttempts === 1) {
      await route.fulfill({
        status: 422,
        contentType: "application/json",
        body: JSON.stringify({
          code: "schedule_capacity",
          error: "The plan does not fit before the deadline.",
        }),
      });
      return;
    }
    await route.fulfill({
      status: 502,
      contentType: "application/json",
      body: JSON.stringify({ error: "Temporary planning service failure." }),
    });
  });
  await openPreviewApp(page);

  await page.getByRole("button", { name: /New plan|Build my first plan|Create another plan/ }).first().click();
  await page.getByPlaceholder(/I have a biology test/).fill(
    "I have a biology test tomorrow on cellular respiration.",
  );
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: /Create it for me/ }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "1–2 days", exact: true }).click();
  await page.getByRole("button", { name: "15 minutes", exact: true }).click();

  await finishPlanSetup(page);
  await page.getByRole("button", { name: "Generate my plan" }).click();

  const capacityGuidance = page.getByRole("alert").filter({
    hasText: "This plan needs more room before your target date.",
  });
  await expect(capacityGuidance).toContainText("Add another study day");
  await expect(capacityGuidance).toContainText("choose longer sessions");
  await expect(page.getByRole("heading", { name: "When would you prefer to study this material?" })).toBeVisible();

  // The second attempt exercises the deterministic browser fallback. It must
  // produce the same expected recovery instead of throwing outside the API
  // error handler and stranding the loading screen.
  await finishPlanSetup(page);
  await page.getByRole("button", { name: "Generate my plan" }).click();
  await expect(capacityGuidance).toBeVisible();
  expect(pageErrors).toEqual([]);

  const feasible = futureDate(14);
  await page.getByRole("textbox", { name: "Target date" }).fill(feasible.input);
  await page.getByRole("button", { name: "Every day", exact: true }).click();
  await page.getByRole("button", { name: "60 minutes", exact: true }).click();
  await finishPlanSetup(page);
  await page.getByRole("button", { name: "Generate my plan" }).click();

  await expect(page.getByText("Plan ready")).toBeVisible();
  expect(planAttempts).toBe(3);
  expect(pageErrors).toEqual([]);
});

function futureDate(days: number) {
  const now = new Date();
  const currentCalendarParts = new Intl.DateTimeFormat("en-US", {
    timeZone: TEST_TIME_ZONE,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(
    currentCalendarParts.find((candidate) => candidate.type === type)?.value,
  );
  const local = new Date(Date.UTC(part("year"), part("month") - 1, part("day") + days, 12));
  const year = local.getUTCFullYear();
  const month = String(local.getUTCMonth() + 1).padStart(2, "0");
  const day = String(local.getUTCDate()).padStart(2, "0");
  return {
    date: local,
    input: `${year}-${month}-${day}`,
    monthShort: new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" }).format(local),
  };
}

async function finishPlanSetup(page: Page) {
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("button", { name: "Skip for now" })).toBeVisible();
  await page.getByRole("button", { name: "Skip for now" }).click();
  await expect(page.getByRole("heading", { name: "Everything YOVA will use" })).toBeVisible();
}

async function openPreviewApp(page: Page) {
  await page.goto("/?qa=preview");
  await page.getByRole("button", { name: "Build my plan" }).click();
  await page.getByLabel("First name").fill("Learner");
  await page.getByLabel("Email address").fill(`schedule-${crypto.randomUUID()}@example.com`);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: /Personalize YOVA/ }).click();

  for (const [index, answer] of onboardingAnswers.entries()) {
    await page.getByRole("button", { name: answer, exact: true }).click();
    await page.getByRole("button", { name: index === onboardingAnswers.length - 1 ? "Build my setup" : "Continue" }).click();
  }

  await page.getByRole("button", { name: "Open YOVA" }).click();
  await expect(page.getByRole("heading", { name: /^Good (morning|afternoon|evening), Learner$/ })).toBeVisible();
}
