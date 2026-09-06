import { expect, test } from "@playwright/test";
import { addManual, closeDetail, FIXED_NOW, openCalendar, openPreviewCalendar, quickDraft, seedCalendarAuthority, seedMovableCalendarState, storedManualEvents, showWeek } from "./helpers/calendar";

test.use({ timezoneId: "Europe/London" });
test.beforeEach(async ({ page }) => openPreviewCalendar(page));

test("two simultaneous tabs preserve both new events and each tab refreshes", async ({ page, context }) => {
  const second = await context.newPage();
  await second.clock.setFixedTime(FIXED_NOW);
  await second.goto("/?qa=preview");
  await openCalendar(second);
  await Promise.all([
    addManual(page, "Read lab notes", "2026-09-03T11:00"),
    addManual(second, "Meet study group", "2026-09-03T15:00"),
  ]);
  await expect.poll(async () => (await storedManualEvents(page)).map((event) => event.title).sort()).toEqual(["Meet study group", "Read lab notes"]);
  await page.reload(); await openCalendar(page);
  await expect(page.getByRole("button", { name: /^Read lab notes, / })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Meet study group, / })).toBeVisible();
  await second.close();
});

test("a stale event edit cannot overwrite the other tab and the draft remains available", async ({ page, context }) => {
  await addManual(page, "Study group", "2026-09-03T15:00");
  const second = await context.newPage();
  await second.clock.setFixedTime(FIXED_NOW);
  await second.goto("/?qa=preview"); await openCalendar(second);
  await second.getByRole("button", { name: /^Study group, / }).click();
  for (const tab of [page, second]) await tab.locator(".calendar-block-detail").getByRole("button", { name: "Edit", exact: true }).click();
  const firstEditor = page.getByRole("form", { name: "Edit calendar item" });
  const secondEditor = second.getByRole("form", { name: "Edit calendar item" });
  await firstEditor.getByLabel("Title", { exact: true }).fill("Study group with Maya");
  await secondEditor.getByLabel("Title", { exact: true }).fill("My unsaved draft");
  await firstEditor.getByRole("button", { name: "Save changes" }).click();
  await expect(page.locator(".calendar-block-detail h2")).toHaveText("Study group with Maya");
  await secondEditor.getByRole("button", { name: "Save changes" }).click();
  await expect(second.locator(".calendar-inspector").getByRole("alert")).toContainText("changed in another tab");
  await expect(secondEditor.getByLabel("Title", { exact: true })).toHaveValue("My unsaved draft");
  expect((await storedManualEvents(second))[0].title).toBe("Study group with Maya");
  await second.close();
});

test("Quick Add preserves weekdays, explicit dates and exam clocks", async ({ page }) => {
  const cases = [
    ["Chemistry class Friday at 2pm for 60 minutes", "2026-09-04T14:00", null],
    ["Meet tutor next Monday at 10am", "2026-09-07T10:00", null],
    ["Review biology September 10 at 6pm for 45 minutes", "2026-09-10T18:00", null],
    ["Biology exam due Friday at 2pm", "2026-09-04T14:00", "2026-09-04T14:00"],
  ] as const;
  for (const [phrase, time, due] of cases) {
    const dialog = await quickDraft(page, phrase);
    await expect(dialog.getByLabel("Calendar time")).toHaveValue(time);
    if (due) await expect(dialog.getByLabel("Due time")).toHaveValue(due);
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  }
});

test("a deadline can be saved without inventing a study block and corrected later", async ({ page }) => {
  const dialog = await quickDraft(page, "History essay due Friday");
  await expect(dialog.getByLabel("Calendar time")).toHaveValue("");
  await dialog.getByRole("button", { name: "Save to calendar" }).click();
  const detail = page.locator(".calendar-block-detail");
  await expect(detail).toContainText("Due Fri, Sep 4");
  await detail.getByRole("button", { name: "Edit", exact: true }).click();
  const editor = page.getByRole("form", { name: "Edit calendar item" });
  await editor.getByLabel("Due time").fill("2026-09-05T16:00");
  await editor.getByRole("button", { name: "Save changes" }).click();
  await closeDetail(page);
  await showWeek(page);
  await expect(page.locator(".calendar-block")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Inspect History Essay, due Sat/ })).toHaveCount(1);
  await page.reload(); await openCalendar(page, true);
  await expect(page.getByRole("button", { name: /^Inspect History Essay, due Sat/ })).toHaveCount(1);
});

test("manual events support full keyboard-editable fields and immediate undo", async ({ page }) => {
  await addManual(page, "Chemistry lecture", "2026-09-03T14:00", "60", "class");
  await page.locator(".calendar-block-detail").getByRole("button", { name: "Edit", exact: true }).click();
  const editor = page.getByRole("form", { name: "Edit calendar item" });
  await editor.getByLabel("Title", { exact: true }).fill("Chemistry workshop");
  await editor.getByRole("combobox", { name: "Type" }).selectOption("personal");
  await editor.getByLabel("Calendar time").fill("2026-09-03T15:00");
  await editor.getByLabel("Duration (minutes)").fill("90");
  await editor.getByLabel("Course", { exact: true }).fill("CHEM101");
  await editor.getByLabel("Fixed time").uncheck();
  await editor.getByRole("button", { name: "Save changes" }).click();
  await expect(page.locator(".calendar-block-detail h2")).toHaveText("Chemistry workshop");
  expect((await storedManualEvents(page))[0]).toMatchObject({ title: "Chemistry workshop", durationMinutes: 90, eventType: "personal", fixed: false });
  await page.locator(".calendar-block-detail").getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByRole("button", { name: "Undo calendar change" }).click();
  await expect.poll(async () => (await storedManualEvents(page)).length).toBe(1);
  await page.reload(); await openCalendar(page);
  await page.getByRole("button", { name: /^Chemistry workshop, / }).click();
  await expect(page.locator(".calendar-block-detail")).toContainText("90 min");
  await expect(page.locator(".calendar-block-detail")).toContainText("CHEM101");
});

test("details stay visible and focused, and Escape returns focus to the selected block", async ({ page, isMobile }) => {
  if (isMobile) await expect(page.getByRole("button", { name: "Agenda", exact: true })).toHaveAttribute("aria-pressed", "true");
  await addManual(page, "Afternoon study group", "2026-09-03T14:00", "60");
  await closeDetail(page);
  const block = page.getByRole("button", { name: /^Afternoon study group, / });
  await block.click();
  const title = page.locator(".calendar-block-detail h2");
  await expect(title).toBeFocused();
  await expect(title).toBeInViewport();
  await expect(page.locator(".calendar-block-detail").getByRole("button", { name: "Edit", exact: true })).toBeInViewport();
  await page.keyboard.press("Escape");
  await expect(page.locator(".calendar-inspector")).toHaveCount(0);
  await expect(block).toBeFocused();
});

test("overlapping commitments have distinct clickable lanes and a named conflict", async ({ page }) => {
  await addManual(page, "Doctor appointment", "2026-09-03T14:00", "60");
  await addManual(page, "Study group", "2026-09-03T14:00", "60");
  await closeDetail(page);
  await showWeek(page);
  const first = page.getByRole("button", { name: /^Doctor appointment, / });
  const second = page.getByRole("button", { name: /^Study group, / });
  const a = await first.boundingBox(); const b = await second.boundingBox();
  expect(a!.x).not.toBe(b!.x);
  expect(Math.min(a!.x + a!.width, b!.x + b!.width)).toBeLessThanOrEqual(Math.max(a!.x, b!.x));
  for (const block of [first, second]) { await block.click(); await expect(page.locator(".calendar-block-detail")).toBeVisible(); await closeDetail(page); }
  await expect(page.locator(".calendar-issue").filter({ hasText: "conflicts with" })).toHaveCount(1);
});

test("full-day grid includes early, late and overnight work on the correct days", async ({ page }) => {
  await addManual(page, "Early commute", "2026-09-03T06:30", "45");
  await addManual(page, "Late revision", "2026-09-03T23:00", "45");
  await addManual(page, "Night project", "2026-09-03T23:30", "120");
  await closeDetail(page); await showWeek(page);
  const early = page.getByRole("button", { name: /^Early commute, / });
  const late = page.getByRole("button", { name: /^Late revision, / });
  expect(await early.evaluate((element) => element.style.getPropertyValue("--calendar-block-top"))).toBe(`${390 / 1440 * 100}%`);
  expect(await late.evaluate((element) => element.style.getPropertyValue("--calendar-block-top"))).toBe(`${1380 / 1440 * 100}%`);
  const overnight = page.getByRole("button", { name: /^Night project, / });
  await expect(overnight).toHaveCount(2);
  await overnight.nth(1).click();
  await expect(page.locator(".calendar-block-detail h2")).toHaveText("Night project");
});

test("all deadlines can be searched, inspected and reached beyond the visible week", async ({ page }) => {
  for (let i = 1; i <= 7; i++) await addManual(page, `Course ${i} assignment`, `2026-09-${String(7 + i).padStart(2, "0")}T17:00`, "30", "deadline", `2026-09-${String(7 + i).padStart(2, "0")}T23:00`);
  await closeDetail(page);
  const outcomes = page.locator(".calendar-outcomes");
  await outcomes.getByRole("button", { name: "View all 7 deadlines" }).click();
  await expect(outcomes.locator(".calendar-outcome-row")).toHaveCount(7);
  await outcomes.getByLabel("Search deadlines").fill("Course 7");
  await expect(outcomes.locator(".calendar-outcome-row")).toHaveCount(1);
  await outcomes.getByRole("button", { name: "Course 7 assignment", exact: true }).click();
  await expect(page.locator(".calendar-block-detail h2")).toHaveText("Course 7 assignment");
  await closeDetail(page);
  await page.getByLabel("Jump to date").fill("2026-09-14");
  await expect(page.locator("#calendar-board-title")).toContainText("September 14");
});

test("the inline suggestion Move action opens its editor", async ({ page }) => {
  await seedMovableCalendarState(page);
  await page.evaluate(() => {
    const key = "yova.calendar.prototype.v1";
    const envelope = JSON.parse(localStorage.getItem(key)!);
    const account = Object.values(envelope.accounts)[0] as { suggestions: Array<{ startsAt: string }> };
    account.suggestions[0].startsAt = new Date(2026, 8, 2, 17).toISOString();
    localStorage.setItem(key, JSON.stringify(envelope));
  });
  await page.reload(); await openCalendar(page);
  await page.locator(".calendar-day-item").filter({ hasText: "Suggested source review" }).getByRole("button", { name: "Move", exact: true }).click();
  await expect(page.getByLabel("New time")).toBeVisible();
  await expect(page.getByLabel("New time")).toHaveValue("2026-09-02T17:00");
});

test("approved adjustments respect zero capacity and fixed commitments and disclose their destination", async ({ page }) => {
  await seedCalendarAuthority(page);
  await addManual(page, "Mandatory lab", "2026-09-03T18:00", "60", "class");
  await closeDetail(page);
  await page.evaluate(() => {
    const key = "yova.calendar.prototype.v1";
    const envelope = JSON.parse(localStorage.getItem(key)!);
    const account = Object.values(envelope.accounts)[0] as { availabilityOverrides: unknown[] };
    account.availabilityOverrides = [{ dateKey: "2026-09-03", availableMinutes: 0, reason: "No time on Thursday", updatedAt: new Date().toISOString() }];
    localStorage.setItem(key, JSON.stringify(envelope));
  });
  await page.reload(); await openCalendar(page);
  const adjustment = page.locator(".agenda-adjustment-tools");
  await adjustment.locator("summary").click();
  await adjustment.getByLabel("Minutes available today").fill("0");
  await adjustment.getByRole("button", { name: "Review options" }).click();
  await expect(adjustment).toContainText("0 minutes available");
  await expect(adjustment).toContainText("To: Fri, Sep 4, 6:00 PM");
  await adjustment.getByRole("button", { name: "Approve change" }).click();
  await expect(adjustment.locator(".agenda-capacity-options")).toHaveCount(0);
  await expect(page.locator(".calendar-issue").filter({ hasText: "conflicts with" })).toHaveCount(0);
  const schedule = await page.evaluate(() => JSON.parse(localStorage.getItem("yova.preview.v1")!).plans[0].sessions[0].scheduledFor);
  expect(schedule).toBe("2026-09-04T17:00:00.000Z");
});

test("manual workload is included in adjustment totals and has a useful Move action", async ({ page }) => {
  await addManual(page, "Essay writing", "2026-09-02T18:00", "90");
  await closeDetail(page);
  const adjustment = page.locator(".agenda-adjustment-tools");
  await adjustment.locator("summary").click();
  await adjustment.getByLabel("Minutes available today").fill("30");
  await adjustment.getByRole("button", { name: "Review options" }).click();
  await expect(adjustment).toContainText("90 minutes planned · 30 minutes available");
  await expect(adjustment).not.toContainText("Nothing is scheduled");
  await adjustment.getByRole("button", { name: "Move Essay writing" }).click();
  await expect(page.getByLabel("New time")).toBeVisible();
});
