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

test("weekday quick-add interpretation", async ({page}) => {
  const observations = [];
  for (const phrase of ["Chemistry class Friday at 2pm for 60 minutes", "Meet tutor next Monday at 10am", "Review biology September 10 at 6pm for 45 minutes", "Biology exam due Friday at 2pm"]) {
    const dialog = await quickDraft(page, phrase);
    observations.push({phrase, title: await dialog.getByLabel("Title", {exact:true}).inputValue(), calendarTime: await dialog.getByLabel("Calendar time").inputValue(), dueTime: await dialog.getByLabel("Due time").count() ? await dialog.getByLabel("Due time").inputValue() : null});
    await dialog.getByRole("button", {name:"Cancel", exact:true}).click();
  }
  expect(observations[0].calendarTime).toBe("2026-09-02T14:00");
  await evidence(page, "weekday-parsing", observations);
});

test("capture a deadline without allocating study time", async ({page}) => {
  const dialog = await quickDraft(page, "History essay due Friday");
  const result = {calendarTime: await dialog.getByLabel("Calendar time").inputValue(), dueTime: await dialog.getByLabel("Due time").inputValue(), saveDisabled: await dialog.getByRole("button", {name:"Save to calendar"}).isDisabled(), buildDisabled: await dialog.getByRole("button", {name:"Save and build plan"}).isDisabled(), explanation: await dialog.innerText()};
  expect(result.saveDisabled).toBe(true);
  expect(result.dueTime).not.toBe("");
  await evidence(page, "deadline-only", result);
});

test("correct a saved class and recover a deleted one", async ({page}) => {
  await addManual(page, "Chemistry lecture", "2026-09-03T14:00", "60", "class");
  const detail = page.locator(".calendar-block-detail");
  const actions = await detail.getByRole("button").allTextContents();
  expect(await detail.getByRole("button", {name: "Edit", exact: true}).count()).toBe(0);
  expect(await detail.locator('input[type="number"]').count()).toBe(0);
  await evidence(page, "manual-edit", {actions, detail:await detail.innerText()});
  await detail.getByRole("button", {name:"Delete", exact:true}).click();
  const changes = page.locator(".calendar-change-log");
  await changes.locator("summary").click();
  await changes.getByRole("button", {name:"Undo latest change"}).click();
  expect((await storedManualEvents(page)).map(event=>event.title)).toContain("Chemistry lecture");
});

test("two tabs can overwrite a saved calendar event", async ({page, context}) => {
  const other = await context.newPage();
  await other.clock.setFixedTime(FIXED_NOW);
  await other.goto("/?qa=preview");
  await openCalendarTab(other);
  await addManual(page, "Read lab notes", "2026-09-03T11:00");
  const firstSaved = await storedManualEvents(page);
  await addManual(other, "Meet study group", "2026-09-03T15:00");
  const afterSecondTab = await storedManualEvents(other);
  await page.reload();
  await openCalendarTab(page);
  const afterReload = await storedManualEvents(page);
  expect(firstSaved.map(event=>event.title)).toContain("Read lab notes");
  expect(afterReload.map(event=>event.title)).not.toContain("Read lab notes");
  await evidence(page, "two-tab-loss", {firstSaved, afterSecondTab, afterReload});
  await other.close();
});

test("phone selection opens details outside the viewport", async ({page}) => {
  await addManual(page, "Afternoon study group", "2026-09-03T14:00", "60");
  await page.getByRole("button", {name:"Close calendar detail"}).click();
  await page.evaluate(()=>window.scrollTo(0,0));
  const initial = await page.locator(".calendar-board").evaluate(el=>({top:el.getBoundingClientRect().top, viewport:innerHeight, pageHeight:document.documentElement.scrollHeight}));
  const block = page.getByRole("button", {name:/^Afternoon study group, /});
  await block.click();
  const afterSelect = await page.locator(".calendar-block-detail").evaluate(el=>{const r=el.getBoundingClientRect();return {top:r.top,bottom:r.bottom,viewport:innerHeight,focusInDetails:el.contains(document.activeElement),scrollY};});
  await evidence(page,"select-visibility",{initial,afterSelect});
});

test("overlapping personal commitments are stacked without a conflict", async ({page}) => {
  await addManual(page, "Doctor appointment", "2026-09-03T14:00", "60");
  await addManual(page, "Study group", "2026-09-03T14:00", "60");
  await page.getByRole("button",{name:"Close calendar detail"}).click();
  const first=page.getByRole("button",{name:/^Doctor appointment, /});
  const second=page.getByRole("button",{name:/^Study group, /});
  await second.scrollIntoViewIfNeeded();
  const rectangles = {first:await first.boundingBox(),second:await second.boundingBox()};
  const issues=await page.locator(".calendar-attention").innerText();
  const clickResult=await first.click({trial:true,timeout:2000}).then(()=>"clickable",()=>"blocked by overlapping event");
  expect(issues).not.toContain("conflicts with");
  await evidence(page,"overlap",{rectangles,issues,clickResult});
  expect(rectangles.first?.x).toBe(rectangles.second?.x);
  expect(rectangles.first?.width).toBe(rectangles.second?.width);
});

test("early and late commitments have clamped grid positions", async ({page}) => {
  await addManual(page,"Early commute","2026-09-03T06:30","45");
  await addManual(page,"Late revision","2026-09-03T23:00","45");
  await page.getByRole("button",{name:"Close calendar detail"}).click();
  await page.locator(".calendar-board").scrollIntoViewIfNeeded();
  const blocks=await page.locator(".calendar-block").evaluateAll(els=>els.map(el=>({label:el.getAttribute("aria-label"),style:el.getAttribute("style"),height:el.getBoundingClientRect().height,top:el.getBoundingClientRect().top-(el.parentElement?.getBoundingClientRect().top??0)})));
  await evidence(page,"outside-hours",blocks);
  expect(blocks.find(b=>b.label?.startsWith("Early commute"))?.style).toContain("--calendar-block-top: 0%");
  expect(blocks.find(b=>b.label?.startsWith("Late revision"))?.style).toContain("--calendar-block-top: 98%");
});

test("coming-up overview stops after five outcomes", async ({page}) => {
  for(let i=1;i<=7;i++) await addManual(page,`Course ${i} assignment`,`2026-09-${String(7+i).padStart(2,"0")}T17:00`,"30","deadline",`2026-09-${String(7+i).padStart(2,"0")}T23:00`);
  await page.getByRole("button",{name:"Close calendar detail"}).click();
  const outcomes=page.locator(".calendar-outcomes");
  const result={stored:(await storedManualEvents(page)).length,rows:await outcomes.locator(".calendar-outcome-row").count(),text:await outcomes.innerText(),buttons:await outcomes.getByRole("button").allTextContents()};
  expect(result.stored).toBe(7);expect(result.rows).toBe(5);
  await outcomes.scrollIntoViewIfNeeded();
  await evidence(page,"outcome-overview",result);
});

test("suggestion Move in Your Day does not reveal a move editor", async ({page}) => {
  await seedMovableCalendarState(page);
  await page.evaluate(()=>{
    const key="yova.calendar.prototype.v1";
    const envelope=JSON.parse(localStorage.getItem(key)!);
    const account=Object.values(envelope.accounts)[0] as {suggestions:Array<{startsAt:string}>};
    account.suggestions[0].startsAt=new Date(2026,8,2,17).toISOString();
    localStorage.setItem(key,JSON.stringify(envelope));
  });
  await page.reload();await openCalendarTab(page);
  const row=page.locator(".calendar-day-item").filter({hasText:"Suggested source review"});
  await row.getByRole("button",{name:"Move",exact:true}).click();
  expect(await page.getByLabel("New time",{exact:true}).count()).toBe(0);
  await evidence(page,"suggestion-move",{editors:await page.getByLabel("New time",{exact:true}).count(),row:await row.innerText()});
});
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

async function storedManualEvents(page: Page) {
  return page.evaluate(() => {
    const raw = window.localStorage.getItem("yova.calendar.prototype.v1");
    if (!raw) return [];
    const envelope = JSON.parse(raw) as {
      accounts: Record<string, {
        manualEvents: Array<{
          title: string;
          eventType: string;
          startsAt: string;
          endsAt: string;
          fixed: boolean;
          done: boolean;
        }>;
      }>;
    };
    return Object.values(envelope.accounts).flatMap((account) => account.manualEvents.map((event) => ({
      ...event,
      durationMinutes: (Date.parse(event.endsAt) - Date.parse(event.startsAt)) / 60_000,
    })));
  });
}


async function seedMovableCalendarState(page: Page) {
  await page.evaluate(() => {
    const raw = window.localStorage.getItem("yova.calendar.prototype.v1");
    if (!raw) throw new Error("Expected account-scoped Calendar storage.");
    const envelope = JSON.parse(raw) as {
      accounts: Record<string, {
        manualEvents: unknown[];
        suggestions: unknown[];
        updatedAt: string;
      }>;
    };
    const account = Object.values(envelope.accounts)[0];
    if (!account) throw new Error("Expected a Calendar account bucket.");
    const localDate = (day: number, hour: number, minute = 0) => (
      new Date(2026, 8, day, hour, minute, 0, 0).toISOString()
    );
    account.manualEvents = [{
      id: "editable-study-block",
      title: "Editable study block",
      eventType: "personal",
      startsAt: localDate(2, 10),
      endsAt: localDate(2, 10, 30),
      dueAt: null,
      fixed: false,
      done: false,
      courseId: null,
      courseLabel: "International Relations",
      outcomeId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }];
    account.suggestions = [{
      id: "suggested-source-review",
      title: "Suggested source review",
      startsAt: localDate(3, 17),
      durationMinutes: 25,
      planId: null,
      planSessionId: null,
      courseId: null,
      outcomeId: null,
      status: "pending",
      flexibility: "movable",
      reason: {
        text: "This open period avoids the fixed class while keeping the source review optional.",
        source: "suggestion",
        evidenceRefs: ["learner-visible-suggestion"],
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }];
    account.updatedAt = new Date().toISOString();
    window.localStorage.setItem("yova.calendar.prototype.v1", JSON.stringify(envelope));
  });
}
