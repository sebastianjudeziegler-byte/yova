import { expect, test, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

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


// Audit characterizations: passing assertions reproduce the observations in AUDIT.md.
// These are deliberately outside the ordinary regression test directory.
const evidenceDir = path.join(process.cwd(), "docs/audits/2026-09-06-calendar/evidence");
async function evidence(page: Page, name: string, data: unknown) {
  await mkdir(evidenceDir, { recursive: true });
  const stem = `${test.info().project.name}-${name}`;
  await writeFile(path.join(evidenceDir, `${stem}.json`), JSON.stringify(data, null, 2));
  await page.screenshot({ path: path.join(evidenceDir, `${stem}-viewport.png`), scale: "css" });
  await page.screenshot({ path: path.join(evidenceDir, `${stem}.png`), fullPage: true, scale: "css" });
}
test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(FIXED_NOW);
  await createPreviewAccount(page);
  await completeOnboarding(page);
  await openCalendarTab(page);
});
async function quickDraft(page: Page, phrase: string) {
  const input = page.getByLabel("Quick add a calendar item");
  await input.fill(phrase);
  await input.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Confirm quick add" });
  await expect(dialog).toBeVisible();
  return dialog;
}
async function addManual(page: Page, title: string, localTime: string, duration = "30", type = "personal", due?: string) {
  const dialog = await quickDraft(page, `${title} tomorrow for 30 minutes`);
  await dialog.getByLabel("Title", {exact: true}).fill(title);
  await dialog.getByRole("combobox", {name: "Type"}).selectOption(type);
  await dialog.getByLabel("Calendar time", {exact: true}).fill(localTime);
  await dialog.getByLabel("Duration", {exact: true}).fill(duration);
  if (due) await dialog.getByLabel("Due time", {exact: true}).fill(due);
  await dialog.getByRole("button", { name: "Save to calendar", exact: true }).click();
  await expect(page.locator(".calendar-block-detail h2")).toHaveText(title);
}

async function openCalendarTab(page: Page) {
  await page.getByRole("button", { name: "Calendar", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Plan the work that gets you there" })).toBeVisible();
}


async function createPreviewAccount(page: Page) {
  await page.goto("/?qa=preview");
  await page.getByRole("button", { name: "Build my plan" }).click();
  await page.getByLabel("First name").fill("Learner");
  await page.getByLabel("Email address").fill(`calendar-${crypto.randomUUID()}@example.com`);
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


async function seedCalendarAuthority(page: Page) {
  await page.evaluate(() => {
    const stored = window.localStorage.getItem("yova.preview.v1");
    if (!stored) throw new Error("Expected a preview snapshot after onboarding.");
    const snapshot = JSON.parse(stored) as {
      plans: unknown[];
      deadlineMilestones?: unknown[];
      updatedAt?: string;
    };
    snapshot.plans.push({
      id: "88000000-0000-4000-8000-000000000001",
      learningItemId: "88000000-0000-4000-8000-000000000002",
      title: "History Midterm",
      topic: "European alliance systems",
      kind: "test",
      deadline: "2026-09-05T18:00:00.000Z",
      status: "active",
      sourceMode: "yova_generated",
      studyMode: "inside_yova",
      learningIntent: "study",
      creationIntent: "plan",
      sessionArchitectureVersion: "streamed_teaching_v1",
      rationale: "Preserve the learning sequence before the midterm.",
      createdAt: "2026-09-01T10:00:00.000Z",
      materials: [],
      sessions: [{
        id: "causal-map-session",
        sequence: 1,
        title: "Causal map review",
        objective: "Explain how alliance commitments raised escalation risk.",
        method: "Concept Mapping",
        methodReason: "A cause map exposes missing links before retrieval.",
        scheduledFor: "2026-09-02T17:00:00.000Z",
        estimatedMinutes: 40,
        amountLabel: "One causal map and evidence check · about 40 min",
        learningMode: "study",
        topicIds: ["alliances-topic"],
        contentTargets: ["Alliance escalation"],
        completionEvidence: ["Explain two linked causes without notes"],
        status: "ready",
      }],
    });
    snapshot.deadlineMilestones = [{
      id: "unplanned-term-paper",
      title: "Unplanned term paper",
      description: "Submit a sourced argument about industrialization.",
      dueAt: "2026-09-04T20:00:00.000Z",
      status: "open",
      linkedLearningItemId: null,
      createdAt: "2026-09-01T10:00:00.000Z",
    }];
    snapshot.updatedAt = new Date().toISOString();
    window.localStorage.setItem("yova.preview.v1", JSON.stringify(snapshot));
  });
}



test("approved capacity move lands on a fixed class and a zero-availability day", async ({page})=>{
  await seedCalendarAuthority(page);
  await addManual(page,"Mandatory lab","2026-09-03T18:00","60","class");
  await page.evaluate(()=>{
    const key="yova.calendar.prototype.v1";
    const envelope=JSON.parse(localStorage.getItem(key)!);
    const account=Object.values(envelope.accounts)[0] as {manualEvents:Array<{fixed:boolean}>, availabilityOverrides:unknown[]};
    account.manualEvents[0].fixed=true;
    account.availabilityOverrides=[{dateKey:"2026-09-03",availableMinutes:0,reason:"No time on Thursday",updatedAt:new Date().toISOString()}];
    localStorage.setItem(key,JSON.stringify(envelope));
  });
  await page.reload();await openCalendarTab(page);
  const adjustment=page.locator(".agenda-adjustment-tools");
  await adjustment.locator("summary").click();
  await adjustment.getByLabel("Minutes available today").fill("0");
  await adjustment.getByRole("button",{name:"Review options"}).click();
  const preview=await adjustment.locator(".agenda-capacity-options").innerText();
  await evidence(page,"capacity-before",{preview});
  await adjustment.getByRole("button",{name:"Approve change"}).click();
  await expect(page.locator(".calendar-issue").filter({hasText:"conflicts with"})).toHaveCount(1);
  const after=await page.locator(".calendar-attention").innerText();
  const state=await page.evaluate(()=>JSON.parse(localStorage.getItem("yova.preview.v1")!).plans.map((p:{title:string,sessions:unknown})=>({title:p.title,sessions:p.sessions})));
  await evidence(page,"capacity-after",{preview,after,state});
});

test("availability planner excludes visible manual workload",async({page})=>{
  await addManual(page,"Essay writing","2026-09-02T18:00","90");
  const adjustment=page.locator(".agenda-adjustment-tools");
  await adjustment.locator("summary").click();
  await adjustment.getByLabel("Minutes available today").fill("30");
  await adjustment.getByRole("button",{name:"Review options"}).click();
  const preview=await adjustment.locator(".agenda-capacity-options").innerText();
  const attention=await page.locator(".calendar-attention").innerText();
  expect(preview).toContain("Nothing is scheduled today");
  expect(attention).toContain("90 minutes are planned");
  await evidence(page,"manual-capacity",{preview,attention});
});
