import { expect, test, type Page } from "@playwright/test";
import { addManual, closeDetail, FIXED_NOW, openCalendar, openPreviewCalendar, quickDraft, showWeek } from "./helpers/calendar";

test.use({ timezoneId: "Europe/London" });
test.beforeEach(async ({ page }) => openPreviewCalendar(page));
const description = "I have a class on communications from 11:30 to 12 every Monday and Wednesday";
async function saveClass(page: Page) {
  const draft = await quickDraft(page, description);
  await draft.getByRole("button", { name: "Save to calendar", exact: true }).click();
  await expect(page.locator(".calendar-block-detail h2")).toHaveText("Communications Class");
}
async function savedSeries(page: Page) {
  return page.evaluate(() => {
    const envelope = JSON.parse(localStorage.getItem("yova.calendar.prototype.v1")!);
    return (Object.values(envelope.accounts)[0] as { manualEvents: Array<{title: string; recurrence: {frequency: string; interval: number; weekdays: number[]; count: number | null}; recurrenceExceptions?: unknown[]}> }).manualEvents;
  });
}

test("Add recognizes the communications timetable and saves a lasting Monday/Wednesday series", async ({ page }, testInfo) => {
  await page.getByRole("button", { name: "Add to YOVA", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "What would you like to add?" })).toBeVisible();
  await page.getByRole("textbox", { name: "Describe what you want to add" }).fill(description);
  await page.getByRole("button", { name: "Organize this" }).click();
  const draft = page.getByRole("dialog", { name: "Confirm quick add" });
  await expect(draft).toBeInViewport();
  await expect(draft.getByRole("heading", { name: "Confirm what YOVA understood" })).toBeFocused();
  await expect(draft.getByRole("button", {name: "Save to calendar", exact: true})).toBeInViewport();
  const saveBounds = await draft.getByRole("button", {name: "Save to calendar", exact: true}).boundingBox();
  const dialogBounds = await draft.boundingBox();
  expect(saveBounds!.y + saveBounds!.height).toBeLessThanOrEqual(dialogBounds!.y + dialogBounds!.height - 1);
  await page.screenshot({path: `docs/audits/2026-09-06-calendar/evidence/${testInfo.project.name}-recurring-form.png`, animations: "disabled"});
  await expect(draft.getByLabel("Title", {exact: true})).toHaveValue("Communications Class");
  await expect(draft.getByLabel("Calendar time", {exact: true})).toHaveValue("2026-09-02T11:30");
  await expect(draft.getByLabel("Duration", {exact: true})).toHaveValue("30");
  await expect(draft.getByRole("checkbox", { name: "Monday", exact: true })).toBeChecked();
  await expect(draft.getByRole("checkbox", { name: "Wednesday", exact: true })).toBeChecked();
  await expect(draft.getByRole("checkbox", { name: "Tuesday", exact: true })).not.toBeChecked();
  await expect(draft.getByRole("region", { name: "Recurring schedule preview" })).toContainText("Mon 7 Sept, 11:30");
  await draft.getByRole("region", { name: "Recurring schedule preview" }).scrollIntoViewIfNeeded();
  await page.screenshot({path: `docs/audits/2026-09-06-calendar/evidence/${testInfo.project.name}-recurring-preview.png`, animations: "disabled"});
  await draft.getByRole("button", { name: "Save to calendar", exact: true }).click();
  await expect(page.locator(".calendar-block-detail h2")).toHaveText("Communications Class");
  expect(await savedSeries(page)).toMatchObject([{recurrence: { frequency: "weekly", interval: 1, weekdays: [1, 3] }}]);
  await closeDetail(page); await showWeek(page);
  await page.getByLabel("Jump to date").fill("2028-09-04");
  await expect(page.locator("#calendar-board-title")).toContainText("September 4");
  await expect(page.locator(".calendar-week").getByRole("button", { name: /^Communications Class, / })).toHaveCount(2);
  await page.reload(); await openCalendar(page, true);
  await expect(page.locator(".calendar-week").getByRole("button", { name: /^Communications Class, / })).toHaveCount(2);
  expect(await savedSeries(page)).toHaveLength(1);
});

test("every two days supports a finite occurrence count and stops on the right date", async ({ page }) => {
  const draft = await quickDraft(page, "Review vocabulary every two days starting tomorrow at 6pm for 20 minutes for 3 occurrences");
  await expect(draft.getByLabel("Repeat every (days)")).toHaveValue("2");
  await expect(draft.getByLabel("Number of occurrences", {exact: true})).toHaveValue("3");
  await draft.getByRole("button", { name: "Save to calendar", exact: true }).click();
  await expect(page.locator(".calendar-block-detail h2")).toHaveText("Review Vocabulary");
  await closeDetail(page); await showWeek(page);
  await expect(page.locator(".calendar-week").getByRole("button", { name: /^Review Vocabulary, / })).toHaveCount(2);
  await page.getByLabel("Jump to date").fill("2026-09-07");
  await expect(page.locator(".calendar-week").getByRole("button", { name: /^Review Vocabulary, / })).toHaveCount(1);
  await page.getByLabel("Jump to date").fill("2026-09-14");
  await expect(page.locator(".calendar-week").getByRole("button", { name: /^Review Vocabulary, / })).toHaveCount(0);
});

test("one occurrence can move, be cancelled and be restored without changing the series", async ({ page }) => {
  await saveClass(page);
  let detail = page.locator(".calendar-block-detail");
  await detail.getByRole("button", { name: "Move", exact: true }).click();
  await detail.getByLabel("New time").fill("2026-09-04T13:00");
  await detail.getByRole("button", { name: "Save new time" }).click();
  await expect(detail).toContainText("Fri, Sep 4, 1:00 PM");
  await page.reload(); await openCalendar(page, true);
  await page.getByRole("button", { name: /^Communications Class, 1:00 PM/ }).click();
  detail = page.locator(".calendar-block-detail");
  await detail.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.locator(".calendar-week").getByRole("button", { name: /^Communications Class, / })).toHaveCount(0);
  await page.getByRole("button", { name: "Undo calendar change" }).click();
  await expect(page.getByRole("button", { name: /^Communications Class, 1:00 PM/ })).toHaveCount(1);
  await page.getByLabel("Jump to date").fill("2026-09-07");
  await expect(page.locator(".calendar-week").getByRole("button", { name: /^Communications Class, 11:30 AM/ })).toHaveCount(2);
  expect(await savedSeries(page)).toHaveLength(1);
});

test("the whole series can be edited and deleted with one undoable action", async ({ page }) => {
  await saveClass(page);
  await page.locator(".calendar-block-detail").getByRole("button", { name: "Edit", exact: true }).click();
  const editor = page.getByRole("form", { name: "Edit calendar item" });
  await editor.getByLabel("Apply changes to").selectOption("series");
  await editor.getByLabel("Title", {exact:true}).fill("Communications workshop");
  await editor.getByLabel("Calendar time", {exact:true}).fill("2026-09-02T13:00");
  await editor.getByLabel("Duration (minutes)").fill("45");
  await editor.getByLabel("Series ends").selectOption("date");
  await editor.getByLabel("Last repeat date").fill("2026-09-09");
  await editor.getByRole("button", { name: "Save changes" }).click();
  await expect(page.locator(".calendar-block-detail h2")).toHaveText("Communications workshop");
  await closeDetail(page); await showWeek(page);
  await page.getByLabel("Jump to date").fill("2026-09-07");
  const blocks = page.locator(".calendar-week").getByRole("button", { name: /^Communications workshop, 1:00 PM/ });
  await expect(blocks).toHaveCount(2);
  await blocks.first().click();
  await page.getByLabel("Delete applies to").selectOption("series");
  await page.locator(".calendar-block-detail").getByRole("button", { name: "Delete", exact:true }).click();
  await expect.poll(() => savedSeries(page)).toHaveLength(0);
  await page.getByRole("button", { name: "Undo calendar change" }).click();
  await expect(blocks).toHaveCount(2);
  await page.getByLabel("Jump to date").fill("2026-09-14");
  await expect(blocks).toHaveCount(0);
});

test("missing times and unsupported patterns stay editable instead of saving a guessed schedule", async ({ page }) => {
  let draft = await quickDraft(page, "Read vocabulary every two days");
  await expect(draft.getByLabel("Calendar time", {exact:true})).toHaveValue("");
  await expect(draft.getByRole("button", { name: "Save to calendar", exact:true })).toBeDisabled();
  await draft.getByLabel("Calendar time", {exact:true}).fill("2026-09-03T18:00");
  await draft.getByRole("button", { name: "Save to calendar", exact:true }).click();
  await expect(page.locator(".calendar-block-detail h2")).toHaveText("Read Vocabulary");
  draft = await quickDraft(page, "Class on the first Monday of every month at 11am");
  await expect(draft.getByRole("alert")).toContainText("could not interpret");
  await expect(draft.getByRole("button", { name: "Save to calendar", exact:true })).toBeDisabled();
});

test("the class keeps 11:30 local time after daylight saving ends", async ({ page }) => {
  await saveClass(page); await closeDetail(page); await showWeek(page);
  for (const week of ["2026-10-19", "2026-10-26"]) {
    await page.getByLabel("Jump to date").fill(week);
    await expect(page.locator(".calendar-week").getByRole("button", { name: /^Communications Class, 11:30 AM/ })).toHaveCount(2);
  }
});

test("moving an occurrence to a different month keeps its details in view", async ({ page }) => {
  await saveClass(page);
  const detail = page.locator(".calendar-block-detail");
  await detail.getByRole("button", {name: "Move", exact: true}).click();
  await detail.getByLabel("New time").fill("2026-12-01T13:00");
  await detail.getByRole("button", {name: "Save new time"}).click();
  await expect(detail).toContainText("Tue, Dec 1, 1:00 PM");
  await closeDetail(page); await showWeek(page);
  await expect(page.locator(".calendar-week").getByRole("button", {name: /^Communications Class, 1:00 PM/})).toHaveCount(1);
  await page.getByLabel("Jump to date").fill("2026-09-07");
  await expect(page.locator(".calendar-week").getByRole("button", {name: /^Communications Class, 11:30 AM/})).toHaveCount(2);
});

test("moving an item into a future recurring class detects the conflict beyond the current week", async ({ page }) => {
  await saveClass(page);
  await addManual(page, "Study group", "2026-09-03T14:00");
  const detail = page.locator(".calendar-block-detail");
  await detail.getByRole("button", {name: "Move", exact: true}).click();
  await detail.getByLabel("New time").fill("2028-09-04T11:30");
  await detail.getByRole("button", {name: "Save new time"}).click();
  await expect(detail.getByRole("alert")).toContainText("overlaps Communications Class");
  await expect(detail.getByLabel("New time")).toHaveValue("2028-09-04T11:30");
});

test("concurrent edits to a recurring series preserve the second tab's unsaved draft", async ({ page, context }) => {
  await saveClass(page);
  const other = await context.newPage(); await other.clock.setFixedTime(FIXED_NOW);
  await other.goto("/?qa=preview"); await openCalendar(other, true);
  await other.getByRole("button", { name: /^Communications Class, / }).click();
  for (const tab of [page, other]) {
    await tab.locator(".calendar-block-detail").getByRole("button", { name: "Edit", exact: true }).click();
    await tab.getByLabel("Apply changes to").selectOption("series");
  }
  await page.getByRole("form", { name: "Edit calendar item" }).getByLabel("Title", {exact:true}).fill("Communications A");
  await other.getByRole("form", { name: "Edit calendar item" }).getByLabel("Title", {exact:true}).fill("My draft title");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.locator(".calendar-block-detail h2")).toHaveText("Communications A");
  await other.getByRole("button", { name: "Save changes" }).click();
  await expect(other.locator(".calendar-inspector").getByRole("alert")).toContainText("changed in another tab");
  await expect(other.getByRole("form", { name: "Edit calendar item" }).getByLabel("Title", {exact:true})).toHaveValue("My draft title");
  await other.close();
});
